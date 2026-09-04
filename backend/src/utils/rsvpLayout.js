/**
 * rsvp_layout v1 — the RSVP page designer document (docs/plans/rsvp-pages.md §4).
 *
 * BACKEND SOURCE OF TRUTH. src/lib/rsvpLayout.js is a byte-for-byte mirror
 * (header aside) so the designer, the public renderer and the server clamp
 * agree; src/lib/__tests__/rsvpLayout.lockstep.test.js imports BOTH and fails
 * the build on any divergence. Edit them together, backend first.
 *
 * Dependency-free on purpose: the frontend lockstep test loads this file
 * inside vitest, where backend packages are not installed. Theme vocabulary
 * is imported from the designConfigV2 twin (pure data) — presets, fonts and
 * radii are shared with the campaign Studio, the schema is not.
 *
 * Clamp policy is sanitize-never-reject, like designConfigV2Clamp: unknown
 * keys are dropped, strings capped, enums fall back to defaults, counts
 * capped. The invariants (§4):
 *   1. exactly one `form` block — undeletable, reorderable;
 *   2. `name` + `email` are locked (always present, always required);
 *   3. custom field keys match CUSTOM_FIELD_KEY_RE;
 *   4. once responses exist (`frozen` option) a field's key, type and options
 *      are immutable and the field cannot be deleted — label/help/required/
 *      order stay editable;
 *   5. public reads REBUILD the document (publicLayout), never dump the column.
 */

import { PRESET_IDS, FONT_IDS, THEME_RADIUS_IDS, sanitizeQuestionText } from './designConfigV2.js';

export const RSVP_LAYOUT_VERSION = 1;

/** Five block types, nine field types — the whole vocabulary. */
export const BLOCK_TYPES = ['hero', 'text', 'details', 'image', 'form'];
export const FIELD_TYPES = ['text', 'textarea', 'email', 'phone', 'number', 'date', 'select', 'multiselect', 'checkbox'];
export const OPTION_FIELD_TYPES = ['select', 'multiselect'];

/** Locked fields exist on every form: the confirmation email + dedupe key need them. */
export const LOCKED_FIELD_KEYS = ['name', 'email'];
/** Reserved keys → forced type. `phone` is reserved (it is a column) but deletable. */
export const BUILTIN_FIELD_TYPES = Object.freeze({ name: 'text', email: 'email', phone: 'phone' });
export const CUSTOM_FIELD_KEY_RE = /^f_[a-z0-9]{4,12}$/;
export const BLOCK_ID_RE = /^b_[a-z0-9]{4,12}$/;

/** Root-of-host slug (rsvp.redeem.sg/{slug}) — shorter than campaign slugs on purpose. */
export const RSVP_SLUG_RE = /^[a-z0-9-]{3,40}$/;
/**
 * The slug shares a namespace with every asset path on the host (§7). Kept
 * generous: a reserved word costs nothing, a shadowed asset costs the site.
 * Enforced server-side by isValidRsvpSlug; the designer only hints.
 */
export const RESERVED_ROOT_SLUGS = Object.freeze([
  'admin', 'api', 'assets', 'auth', 'c', 'email', 'explore', 'favicon.ico', 'flow', 'health',
  'index.html', 'leads', 'legal', 'login', 'logout', 'manifest.json', 'offers', 'p', 'preview',
  'public', 'robots.txt', 'rsvp', 'share', 'sitemap.xml', 'static', 't', 'uploads',
]);

export const LIMITS = Object.freeze({
  blocks: 12, fields: 20, options: 12, detailsRows: 8,
  title: 120, headline: 80, subheadline: 150, body: 2000, submitLabel: 40,
  detailsLabel: 40, detailsValue: 120, detailsLink: 500, mediaUrl: 500, mediaAlt: 120,
  label: 80, help: 160, option: 48,
  confirmationHeadline: 80, confirmationBody: 600,
  // The consent line under the form ('' = the server's default era wording).
  consentCopy: 700,
  // Answer bounds (utils/rsvpAnswers.js builds the Joi from these).
  answerShort: 200, answerLong: 2000, multiselectMax: 12, numberAbs: 1_000_000_000,
});

export const DEFAULT_PRESET_ID = 'warm-cream';
export const DEFAULT_SUBMIT_LABEL = 'RSVP';
export const DEFAULT_CONFIRMATION_HEADLINE = "You're in";

const DEFAULT_LABELS = Object.freeze({ name: 'Full name', email: 'Email', phone: 'Mobile' });

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const clone = (v) => JSON.parse(JSON.stringify(v));

/** Single-line owner copy + attendee text share one sanitizer (control/bidi strip, trim, cap). */
export const sanitizeText = sanitizeQuestionText;

/**
 * Multi-line copy (text blocks, confirmation body, long-text answers): the
 * single-line sanitizer strips U+000A with the other controls, which collapsed
 * every paragraph into one line. This keeps newlines (CRLF normalised) and
 * strips everything else the single-line one does.
 */
export function sanitizeMultiline(v, max) {
  if (typeof v !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  const stripped = v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '');
  const trimmed = stripped.trim();
  if (typeof max === 'number' && max >= 0 && trimmed.length > max) return trimmed.slice(0, max).trimEnd();
  return trimmed;
}

function cleanUrl(v) {
  if (typeof v !== 'string') return '';
  const s = v.trim();
  if (!s || s.length > LIMITS.mediaUrl) return '';
  if (/^https:\/\/[^\s"'<>]+$/i.test(s)) return s;
  if (/^\/uploads\/[A-Za-z0-9_\-./]+$/.test(s)) return s;
  return '';
}

/** Outbound link on a details row (a Google Maps pin, a venue page): https only. */
function cleanLink(v) {
  if (typeof v !== 'string') return '';
  const s = v.trim();
  if (!s || s.length > LIMITS.detailsLink) return '';
  return /^https:\/\/[^\s"'<>]+$/i.test(s) ? s : '';
}

function cleanHex(v) {
  if (typeof v !== 'string') return '';
  const s = v.trim();
  return /^#[0-9a-fA-F]{6}$/.test(s) ? s : '';
}

function cleanOptions(raw) {
  const out = [];
  for (const o of Array.isArray(raw) ? raw : []) {
    const s = sanitizeText(o, LIMITS.option);
    if (!s || out.includes(s)) continue;
    out.push(s);
    if (out.length >= LIMITS.options) break;
  }
  return out;
}

/** Deterministic id minting (no randomness — the twins must clamp identically). */
function mintBlockId(seen) {
  let n = 1;
  while (seen.has(`b_${String(n).padStart(4, '0')}`)) n++;
  return `b_${String(n).padStart(4, '0')}`;
}

function cleanBlock(raw, id) {
  switch (raw.type) {
    case 'hero':
      return {
        id, type: 'hero',
        headline: sanitizeText(raw.headline, LIMITS.headline),
        subheadline: sanitizeText(raw.subheadline, LIMITS.subheadline),
        mediaUrl: cleanUrl(raw.mediaUrl),
        mediaAlt: sanitizeText(raw.mediaAlt, LIMITS.mediaAlt),
      };
    case 'text':
      return { id, type: 'text', body: sanitizeMultiline(raw.body, LIMITS.body) };
    case 'details': {
      const rows = [];
      for (const r of Array.isArray(raw.rows) ? raw.rows : []) {
        if (!isObj(r)) continue;
        const label = sanitizeText(r.label, LIMITS.detailsLabel);
        const value = sanitizeText(r.value, LIMITS.detailsValue);
        if (!label && !value) continue;
        // A link needs visible text to hang off — without a value it is dropped.
        const href = value ? cleanLink(r.href) : '';
        rows.push({ label, value, href });
        if (rows.length >= LIMITS.detailsRows) break;
      }
      return { id, type: 'details', rows };
    }
    case 'image':
      return { id, type: 'image', url: cleanUrl(raw.url), alt: sanitizeText(raw.alt, LIMITS.mediaAlt) };
    case 'form':
      return {
        id, type: 'form',
        headline: sanitizeText(raw.headline, LIMITS.headline),
        submitLabel: sanitizeText(raw.submitLabel, LIMITS.submitLabel) || DEFAULT_SUBMIT_LABEL,
        // Owner-authored consent sentence; may keep the {organiser} placeholder.
        consentCopy: sanitizeText(raw.consentCopy, LIMITS.consentCopy),
        // Require an SMS code for the mobile number before the RSVP is accepted.
        // DEFAULT ON: absent (every event written before this existed) reads as
        // true, so the guard is opt-OUT, never opt-in by omission.
        verifyPhone: raw.verifyPhone !== false,
      };
    default:
      return null;
  }
}

const validBlock = (b) => isObj(b) && BLOCK_TYPES.includes(b.type);

function clampBlocks(raw) {
  const list = Array.isArray(raw) ? raw : [];
  // Two passes so the form block survives the cap wherever it sits.
  const formRaw = list.find((b) => validBlock(b) && b.type === 'form') || null;
  const selected = [];
  let others = 0;
  for (const b of list) {
    if (b === formRaw) { selected.push(b); continue; }
    if (!validBlock(b) || b.type === 'form') continue;
    if (others >= LIMITS.blocks - 1) continue;
    selected.push(b);
    others++;
  }
  if (!formRaw) selected.push({ type: 'form' });

  const seen = new Set();
  const out = [];
  for (const b of selected) {
    const id = typeof b.id === 'string' && BLOCK_ID_RE.test(b.id) && !seen.has(b.id) ? b.id : mintBlockId(seen);
    seen.add(id);
    out.push(cleanBlock(b, id));
  }
  return out;
}

function cleanField(raw, key, frozenDef) {
  const locked = LOCKED_FIELD_KEYS.includes(key);
  const forcedType = BUILTIN_FIELD_TYPES[key] || (frozenDef ? frozenDef.type : null);
  const type = forcedType || (FIELD_TYPES.includes(raw.type) ? raw.type : 'text');
  const def = {
    key,
    type,
    label: sanitizeText(raw.label, LIMITS.label) || DEFAULT_LABELS[key] || 'Question',
    help: sanitizeText(raw.help, LIMITS.help),
    required: locked ? true : raw.required === true,
  };
  if (locked) def.locked = true;
  if (OPTION_FIELD_TYPES.includes(type)) {
    def.options = frozenDef && Array.isArray(frozenDef.options) ? [...frozenDef.options] : cleanOptions(raw.options);
  }
  return def;
}

/**
 * `frozen`: the STORED field defs once the event has responses. Their key/
 * type/options win over the incoming doc and a frozen field that the incoming
 * doc dropped is re-appended — deleting or re-typing a field would silently
 * rewrite what past attendees appear to have answered (§4 invariant 4).
 */
function clampFields(raw, frozen) {
  const frozenMap = new Map();
  for (const f of Array.isArray(frozen) ? frozen : []) {
    if (isObj(f) && typeof f.key === 'string') frozenMap.set(f.key, f);
  }
  const seen = new Set();
  const out = [];
  for (const f of Array.isArray(raw) ? raw : []) {
    if (!isObj(f) || typeof f.key !== 'string') continue;
    const key = f.key.trim();
    const builtin = Object.prototype.hasOwnProperty.call(BUILTIN_FIELD_TYPES, key);
    if (!builtin && !CUSTOM_FIELD_KEY_RE.test(key)) continue;
    if (seen.has(key)) continue;
    if (out.length >= LIMITS.fields) break;
    seen.add(key);
    out.push(cleanField(f, key, frozenMap.get(key)));
  }
  const evictable = (d) => !frozenMap.has(d.key) && !LOCKED_FIELD_KEYS.includes(d.key);
  const makeRoom = () => {
    if (out.length < LIMITS.fields) return true;
    for (let i = out.length - 1; i >= 0; i--) {
      if (evictable(out[i])) { out.splice(i, 1); return true; }
    }
    return false;
  };
  // Frozen fields the doc dropped come back (rule 4).
  for (const f of frozenMap.values()) {
    if (seen.has(f.key)) continue;
    if (!makeRoom()) break;
    seen.add(f.key);
    out.push(cleanField(f, f.key, f));
  }
  // Locked fields always exist, at the front, in LOCKED order.
  for (let i = LOCKED_FIELD_KEYS.length - 1; i >= 0; i--) {
    const key = LOCKED_FIELD_KEYS[i];
    if (seen.has(key)) continue;
    if (!makeRoom()) break;
    seen.add(key);
    out.unshift(cleanField({}, key, null));
  }
  return out;
}

function clampTheme(raw) {
  const t = isObj(raw) ? raw : {};
  return {
    preset: PRESET_IDS.includes(t.preset) ? t.preset : DEFAULT_PRESET_ID,
    accent: cleanHex(t.accent),
    font: FONT_IDS.includes(t.font) ? t.font : '',
    radius: THEME_RADIUS_IDS.includes(t.radius) ? t.radius : '',
  };
}

function clampConfirmation(raw) {
  const c = isObj(raw) ? raw : {};
  return {
    headline: sanitizeText(c.headline, LIMITS.confirmationHeadline) || DEFAULT_CONFIRMATION_HEADLINE,
    body: sanitizeMultiline(c.body, LIMITS.confirmationBody),
    emailEnabled: c.emailEnabled !== false,
  };
}

/** The seeded document a new event starts from. */
export function defaultLayout() {
  return clampLayout({
    version: RSVP_LAYOUT_VERSION,
    theme: { preset: DEFAULT_PRESET_ID },
    blocks: [
      { id: 'b_hero', type: 'hero', headline: '', subheadline: '' },
      { id: 'b_when', type: 'details', rows: [{ label: 'When', value: '' }, { label: 'Where', value: '' }] },
      { id: 'b_form', type: 'form', headline: 'Save your spot', submitLabel: DEFAULT_SUBMIT_LABEL },
    ],
    fields: [
      { key: 'name', type: 'text', label: 'Full name', required: true },
      { key: 'email', type: 'email', label: 'Email', required: true },
      { key: 'phone', type: 'phone', label: 'Mobile', required: false },
    ],
    confirmation: { headline: DEFAULT_CONFIRMATION_HEADLINE, body: '', emailEnabled: true },
  });
}

/**
 * Sanitize any input into a valid v1 document. Idempotent: clamp(clamp(x))
 * deep-equals clamp(x) — the public rebuild relies on it.
 */
export function clampLayout(raw, { frozen = null } = {}) {
  const doc = isObj(raw) ? raw : {};
  return {
    version: RSVP_LAYOUT_VERSION,
    theme: clampTheme(doc.theme),
    blocks: clampBlocks(doc.blocks),
    fields: clampFields(doc.fields, frozen),
    confirmation: clampConfirmation(doc.confirmation),
  };
}

/** Public DTO view: rebuilt from known keys, never the raw column (§4 rule 5). */
export function publicLayout(layout) {
  return clampLayout(clone(layout));
}

/**
 * Publish-guard problems for a (clamped) document. Empty = publishable.
 * Codes, not prose — the designer maps them to copy.
 */
export function layoutProblems(layout) {
  const doc = isObj(layout) ? layout : {};
  const blocks = Array.isArray(doc.blocks) ? doc.blocks : [];
  const fields = Array.isArray(doc.fields) ? doc.fields : [];
  const problems = [];
  if (blocks.filter((b) => isObj(b) && b.type === 'form').length !== 1) problems.push('form_block_missing');
  if (!blocks.some((b) => isObj(b) && b.type !== 'form')) problems.push('no_content');
  const seen = new Set();
  for (const f of fields) {
    if (!isObj(f) || typeof f.key !== 'string') continue;
    if (seen.has(f.key)) problems.push(`duplicate_key:${f.key}`);
    seen.add(f.key);
    if (OPTION_FIELD_TYPES.includes(f.type) && (!Array.isArray(f.options) || f.options.length < 2)) {
      problems.push(`options_too_few:${f.key}`);
    }
  }
  for (const key of LOCKED_FIELD_KEYS) {
    if (!seen.has(key)) problems.push(`locked_field_missing:${key}`);
  }
  return problems;
}

export const ORGANISER_PLACEHOLDER = '{organiser}';

/** The consent sentence as an attendee sees it: `{organiser}` → the organiser's name. Pure; the server renders the same way. */
export function renderConsentTemplate(template, organiserName) {
  if (typeof template !== 'string' || !template.trim()) return '';
  const name = typeof organiserName === 'string' && organiserName.trim() ? organiserName.trim() : 'the event organiser';
  return template.trim().split(ORGANISER_PLACEHOLDER).join(name);
}

/** The form block's own consent template ('' when the event uses the default). */
export function consentTemplateOf(layout) {
  const form = (Array.isArray(layout?.blocks) ? layout.blocks : []).find((b) => b && b.type === 'form');
  return typeof form?.consentCopy === 'string' ? form.consentCopy : '';
}

/**
 * The field the mobile-verification toggle governs: the first phone field on
 * the form. Usually the built-in `phone`, but an owner who deleted it and added
 * their own phone question gets the same protection.
 */
export function phoneFieldOf(layout) {
  return (layout?.fields || []).find((f) => f?.type === 'phone') || null;
}

/** Does this document actually ask for a mobile AND require it to be verified? */
export function requiresPhoneVerification(layout) {
  const form = (layout?.blocks || []).find((b) => b?.type === 'form');
  return Boolean(form && form.verifyPhone !== false && phoneFieldOf(layout));
}

/**
 * An 8-digit Singapore mobile, or '' when the input is not one. OTP is SG-only
 * (the SSIR-registered "MKTR" sender id), so anything else cannot be verified.
 */
export function normalizeSgMobile(value) {
  const digits = String(value ?? '').replace(/[^0-9]/g, '');
  const local = digits.length === 10 && digits.startsWith('65') ? digits.slice(2) : digits;
  return /^[89][0-9]{7}$/.test(local) ? local : '';
}

export function isValidRsvpSlug(slug) {
  return typeof slug === 'string' && RSVP_SLUG_RE.test(slug) && !RESERVED_ROOT_SLUGS.includes(slug);
}

/** Why a slug is unusable — 'invalid' | 'reserved' | null. Twin of the server check for the designer hint. */
export function slugProblem(slug) {
  if (typeof slug !== 'string' || !RSVP_SLUG_RE.test(slug)) return 'invalid';
  if (RESERVED_ROOT_SLUGS.includes(slug)) return 'reserved';
  return null;
}
