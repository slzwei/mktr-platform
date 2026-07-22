/**
 * Pure helpers for the Studio AI assist (PR 4) — the conditional-path gate
 * mirror and the CO-1 look composer. No imports beyond the pure
 * designConfigV2 constants (create-everything amendment: the draw-template
 * subset must stay single-sourced): this module is shared by the state
 * machine, the API layer and the panel, and stays trivially testable.
 */
import { DRAW_TEMPLATE_IDS } from '@/lib/designConfigV2';
import { marketplaceInheritEnabled } from '@/lib/listingDerivation';

const DRAW_TEMPLATE_ID_SET = new Set(DRAW_TEMPLATE_IDS);

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
 * apply time (F6). Full-coverage amendment: drop/marketplace copy has NO
 * publication-switch gate any more — filling those details BEFORE flipping
 * the switch is the point, and the canvas previews both surfaces. */
export function rowDisabledReason(doc, path) {
  if (!doc) return 'No document';
  switch (path) {
    // Single-door (plan §3B): derived listing copy has no writable home while
    // inheritance is on — receipt AND apply both refuse (Phase B finding 3).
    case 'distribution.featuredDrop.title':
    case 'distribution.marketplace.title':
    case 'distribution.marketplace.valueLine':
    case 'distribution.marketplace.imageAlt':
      return marketplaceInheritEnabled() ? 'Inherited from the campaign page' : null;
    case 'distribution.marketplace.inclusions':
      return marketplaceInheritEnabled() && doc.luckyDraw?.enabled === true
        ? 'Derived from the draw prize list'
        : null;
    case 'content.heroCtaLabel':
      return (doc.content?.media?.kind || 'none') !== 'none' ? null : 'No hero media on the page right now';
    case 'content.media.alt':
      return doc.content?.media?.kind === 'image' ? null : 'No hero image on the page right now';
    case 'quiz.intro.headline':
    case 'quiz.intro.subhead':
    case 'quiz.intro.ctaLabel':
    case 'quiz.reveal.gapTemplate':
    case 'quiz.reveal.valueExchange':
    case 'quiz.reveal.ctaSubtext':
      return quizOn(doc) ? null : 'The quiz is disabled or has no questions';
    case 'quiz.scoring.readiness.label':
      if (!quizOn(doc)) return 'The quiz is disabled or has no questions';
      return doc.quiz?.scoring?.readiness?.enabled === true ? null : 'The readiness meter is off';
    case 'template.params.express.trustLine':
      return (doc.template?.id || 'editorial') === 'express' ? null : 'Only the Express template shows the trust line';
    default:
      return null; // unconditional copy paths (incl. all distribution copy)
  }
}

/** Kind-aware current value for a review row: strings for copy/pick rows,
 * arrays for the inclusions list row ([] when unset), the RAW form.fields
 * array for fields rows (row pairing preserved so keep-mine restores it
 * exactly), and a {template, html} view for terms rows ('' when unset). */
export function rowCurrentValue(doc, row) {
  if (row?.kind === 'list') {
    const v = getAtPath(doc, row.path);
    return Array.isArray(v) ? v : [];
  }
  if (row?.kind === 'fields') {
    const v = getAtPath(doc, row.path);
    return Array.isArray(v) ? JSON.parse(JSON.stringify(v)) : [];
  }
  if (row?.kind === 'terms') {
    const v = getAtPath(doc, row.path);
    if (!v || typeof v !== 'object') return '';
    return { template: v.template || 'default', html: typeof v.html === 'string' ? v.html : '' };
  }
  // Gates read through the PROPOSAL's key set (never a local copy of the
  // server's AI_GATE_IDS): the row is the server's answer, so the shapes stay
  // aligned by construction — and dncCheck, which the AI never proposes, is
  // absent from both sides instead of showing up as a phantom "off".
  if (row?.kind === 'gates') {
    const v = getAtPath(doc, row.path);
    const cur = v && typeof v === 'object' ? v : {};
    return Object.fromEntries(Object.keys(row.value || {}).map((k) => [k, cur[k] === true]));
  }
  return currentValueAt(doc, row?.path || '');
}

/** True when the row's path holds NO value in the doc — rowCurrentValue
 * normalizes absence to ''/[], which keep-mine must not write back (Codex
 * #198-1: restoring ''/[] onto an absent key leaves the doc forever dirty
 * against baseline; restoring `undefined` keeps the getter behavior AND
 * JSON-serializes away, so dirty self-corrects). */
export function rowValueAbsent(doc, row) {
  return getAtPath(doc, row?.path || '') === undefined;
}

/** Fields arrays compare on {id, visible, required} only — `row` pairing is
 * layout state the AI never proposes (client applies row:null). */
const normalizeForEquality = (v) =>
  Array.isArray(v) && v.length && v.every((x) => x && typeof x === 'object' && typeof x.id === 'string')
    ? v.map((f) => ({ id: f.id, visible: f.visible !== false, required: f.required === true }))
    : v;

/** Structural equality across row value types (string | string[] | fields[] | terms{}). */
export function rowValuesEqual(a, b) {
  return JSON.stringify(normalizeForEquality(a)) === JSON.stringify(normalizeForEquality(b));
}

/** Why a look can't be picked against the CURRENT doc (re-checked at pick
 * time, F6) — the Spotlight↔quiz coupling, and draw templates on docs with
 * no enabled draw (stale-server belt: the API already gates them). */
export function lookBlockedReason(doc, look) {
  if (look?.template?.id === 'spotlight' && !quizOn(doc)) {
    return 'Spotlight needs the quiz enabled with at least one question';
  }
  if (DRAW_TEMPLATE_ID_SET.has(look?.template?.id) && doc?.luckyDraw?.enabled !== true) {
    return 'Draw templates need a lucky draw on this campaign';
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
      kind: 'copy', // uniform with the review-stream kinds (fields/terms/pick/list)
      old: currentValueAt(prevDoc, row.path),
      oldAbsent: getAtPath(prevDoc, row.path) === undefined,
      state: 'applied',
      disabledReason: null,
    }));
}
