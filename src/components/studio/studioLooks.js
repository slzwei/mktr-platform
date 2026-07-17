/**
 * Pure helpers for the Studio AI assist (PR 4) — the conditional-path gate
 * mirror and the CO-1 look composer. No imports: this module is shared by the
 * state machine, the API layer and the panel, and stays trivially testable.
 */

/** Minimal dotted-path reader (local twin of useStudioDoc's getPath). */
export function getAtPath(obj, path) {
  return path.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), obj);
}

function setAtPath(obj, path, value) {
  const keys = path.split('.');
  let node = obj;
  for (let i = 0; i < keys.length - 1; i += 1) {
    const key = keys[i];
    if (node[key] == null || typeof node[key] !== 'object') node[key] = {};
    node = node[key];
  }
  node[keys[keys.length - 1]] = value;
}

/** Current doc value at a draft row's path ('' when unset). */
export function currentValueAt(doc, path) {
  const v = getAtPath(doc, path);
  return typeof v === 'string' ? v : '';
}

function quizOn(doc) {
  const quiz = doc?.quiz;
  const questions = Array.isArray(quiz?.steps) ? quiz.steps.flatMap((s) => s?.questions || []).length : 0;
  return quiz?.enabled === true && questions > 0;
}

/** Reasons mirror the server's conditional whitelist, evaluated on the
 * UNSAVED doc. Returns null (allowed) or the human reason it is not. The
 * server gates from the STORED doc; the panel re-checks at receipt AND at
 * apply time (F6 — accepting a drop title while the unsaved drop is disabled
 * would be a latent overwrite). */
export function rowDisabledReason(doc, path) {
  if (!doc) return 'No document';
  switch (path) {
    case 'content.heroCtaLabel':
      return (doc.content?.media?.kind || 'none') !== 'none' ? null : 'No hero media on the page right now';
    case 'quiz.intro.headline':
    case 'quiz.intro.subhead':
    case 'quiz.intro.ctaLabel':
      return quizOn(doc) ? null : 'The quiz is disabled or has no questions';
    case 'distribution.featuredDrop.title':
      return doc.distribution?.featuredDrop?.enabled === true ? null : 'The featured drop is off';
    case 'distribution.marketplace.valueLine':
      return doc.distribution?.marketplace?.listed === true ? null : 'The marketplace listing is off';
    case 'template.params.express.trustLine':
      return (doc.template?.id || 'editorial') === 'express' ? null : 'Only the Express template shows the trust line';
    default:
      return null; // unconditional copy paths
  }
}

/** Why a look can't be picked against the CURRENT doc (re-checked at pick
 * time, F6) — today only the Spotlight↔quiz coupling. */
export function lookBlockedReason(doc, look) {
  if (look?.template?.id === 'spotlight' && !quizOn(doc)) {
    return 'Spotlight needs the quiz enabled with at least one question';
  }
  return null;
}

const THEME_KEYS = ['preset', 'font', 'radius', 'background', 'accent'];

/**
 * Compose a whole document from a CO-1 look proposal.
 *
 *  - template (unless keep.template): switches template.id and merges the
 *    look's params into THAT template's bag, preserving every other bag
 *    (each template remembers its own params — F4);
 *  - theme (unless keep.theme): merges only the keys the look carries
 *    (server sanitation omits invalid ones so the base value survives);
 *    accent:null is meaningful — it clears a custom accent to the preset;
 *  - copy (unless keep.copy): applies draft rows, each re-gated against the
 *    document AS BUILT (template already applied — so the express trust line
 *    lands only when the EFFECTIVE template is express, quiz/drop/marketplace
 *    rows only when their surface is on);
 *  - media: NEVER touched (F7) — a look's {kind, note} is an art-direction
 *    hint chip, not a doc write; `src` isn't even in the DTO.
 */
export function buildLookDoc(base, look, keep = {}) {
  const doc = structuredClone(base);
  if (!keep.template && look?.template?.id) {
    doc.template = doc.template || {};
    doc.template.id = look.template.id;
    if (look.template.params && typeof look.template.params === 'object' && Object.keys(look.template.params).length) {
      doc.template.params = { ...(doc.template.params || {}) };
      doc.template.params[look.template.id] = {
        ...(doc.template.params[look.template.id] || {}),
        ...look.template.params,
      };
    }
  }
  if (!keep.theme && look?.theme && typeof look.theme === 'object') {
    const merged = { ...(doc.theme || {}) };
    for (const key of THEME_KEYS) {
      if (look.theme[key] !== undefined) merged[key] = look.theme[key];
    }
    doc.theme = merged;
  }
  if (!keep.copy) {
    for (const row of look?.draft || []) {
      if (typeof row?.path !== 'string' || typeof row?.value !== 'string') continue;
      if (rowDisabledReason(doc, row.path)) continue;
      setAtPath(doc, row.path, row.value);
    }
  }
  return doc;
}

/** The copy review rows an ADOPTED look yields (F8: adopt-generated rows start
 * `applied`; `old` reads from the pre-look doc so keep-mine can restore it).
 * Only rows that actually landed in the look doc qualify. */
export function adoptedCopyRows(look, prevDoc, lookDoc) {
  return (look?.draft || [])
    .filter((row) => typeof row?.path === 'string' && typeof row?.value === 'string')
    .filter((row) => currentValueAt(lookDoc, row.path) === row.value && !rowDisabledReason(lookDoc, row.path))
    .map((row) => ({
      ...row,
      old: currentValueAt(prevDoc, row.path),
      state: 'applied',
      disabledReason: null,
    }));
}
