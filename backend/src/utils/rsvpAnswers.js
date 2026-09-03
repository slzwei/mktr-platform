/**
 * RSVP submission validation (docs/plans/rsvp-pages.md §5.4) — BACKEND ONLY
 * (Joi). The Joi schema is built from the EVENT'S OWN field defs, so an answer
 * for a field the event does not define is rejected, not stored, and every
 * type carries an explicit bound: capped strings, option membership, strict
 * calendar dates, finite bounded numbers, booleans only, unique capped arrays,
 * flat answers, `.unknown(false)` at both levels.
 */
import Joi from 'joi';
import { LIMITS, OPTION_FIELD_TYPES, sanitizeText, sanitizeMultiline } from './rsvpLayout.js';
import { cleanYmd } from './sgtTime.js';

/** Per-request ceiling on the public POST — the global 1mb parser is far too generous here. */
export const RSVP_BODY_MAX_BYTES = 32 * 1024;

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const PHONE_RE = /^\+?[0-9 ()-]{6,20}$/;

function fieldSchema(field) {
  const { type, required } = field;
  const options = Array.isArray(field.options) ? field.options : [];
  // Array and boolean branches finish their own schema — their required/
  // optional shapes differ from the scalar ones (and the union would not
  // typecheck a `.min()` past a BooleanSchema).
  if (type === 'multiselect') {
    const arr = Joi.array().items(Joi.string().valid(...options)).unique().max(LIMITS.multiselectMax);
    return required ? arr.min(1).required() : arr.optional();
  }
  if (type === 'checkbox') {
    return required ? Joi.boolean().strict().valid(true).required() : Joi.boolean().strict().optional();
  }
  let s;
  switch (type) {
    case 'textarea': s = Joi.string().trim().max(LIMITS.answerLong); break;
    case 'email': s = Joi.string().trim().email({ tlds: false }).max(254); break;
    case 'phone': s = Joi.string().trim().pattern(PHONE_RE); break;
    case 'number': s = Joi.number().min(-LIMITS.numberAbs).max(LIMITS.numberAbs); break;
    case 'date':
      s = Joi.string().trim().pattern(YMD_RE).custom((v, helpers) => (cleanYmd(v) ? v : helpers.error('any.invalid')));
      break;
    case 'select': s = Joi.string().valid(...options); break;
    case 'text':
    default: s = Joi.string().trim().max(LIMITS.answerShort); break;
  }
  if (required) return s.required();
  if (type === 'number') return s.optional().allow(null);
  return s.optional().allow('', null);
}

/** `{ [key]: schema }` for one event's fields — exactly those keys, nothing else. */
export function buildAnswersSchema(fields) {
  const keys = {};
  for (const f of Array.isArray(fields) ? fields : []) {
    if (!f || typeof f.key !== 'string') continue;
    keys[f.key] = fieldSchema(f);
  }
  return Joi.object(keys).unknown(false).required();
}

const utmValue = Joi.string().trim().max(100).allow('');
export const SOURCE_UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];

/** The whole POST body: answers + the consent tick + the honeypot + optional attribution. */
export function buildSubmissionSchema(fields) {
  return Joi.object({
    answers: buildAnswersSchema(fields),
    // The tick is required. The server stamps the era + the exact wording it
    // holds (§8.1); the ONLY client evidence accepted is the hash of the sentence
    // the page displayed, which the service compares against its current copy so
    // a submit against edited wording is refused and re-shown, never mis-stamped.
    consent: Joi.boolean().strict().valid(true).required(),
    consentHash: Joi.string().trim().lowercase().pattern(/^[0-9a-f]{64}$/).optional(),
    // Honeypot: real forms leave it empty; bots fill it. Accepted, then ignored.
    website: Joi.string().allow('').max(200).optional(),
    source: Joi.object(
      Object.fromEntries([...SOURCE_UTM_KEYS.map((k) => [k, utmValue]), ['referrer', Joi.string().trim().max(500).allow('')]])
    ).unknown(false).optional(),
  }).unknown(false).required();
}

/** Post-validation pass: strip control/bidi characters from every string answer. */
export function sanitizeAnswers(fields, answers) {
  const out = {};
  const byKey = new Map((Array.isArray(fields) ? fields : []).map((f) => [f.key, f]));
  for (const [key, value] of Object.entries(answers || {})) {
    const f = byKey.get(key);
    if (!f) continue;
    if (typeof value === 'string') {
      const max = f.type === 'textarea' ? LIMITS.answerLong : f.type === 'email' ? 254 : LIMITS.answerShort;
      out[key] = OPTION_FIELD_TYPES.includes(f.type) ? value : f.type === 'textarea' ? sanitizeMultiline(value, max) : sanitizeText(value, max);
    } else if (Array.isArray(value)) {
      out[key] = value.filter((v) => typeof v === 'string');
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * `closesAt` contract (§5.2): an explicit ISO instant is taken as-is; a bare
 * SGT wall time (`2026-10-04T14:00` / `…:00`) is anchored to +08:00 — never to
 * the server's zone. Returns null for null/'' (clear), a Date for a valid value,
 * and undefined for anything else (the caller 400s).
 */
export function parseClosesAt(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?$/.test(s)) return undefined;
  // Date.parse rolls 2026-02-31 into March — the calendar part must be real.
  if (!cleanYmd(s.slice(0, 10))) return undefined;
  const hasOffset = /(Z|[+-]\d{2}:\d{2})$/.test(s);
  const ms = Date.parse(hasOffset ? s : `${s}+08:00`);
  if (Number.isNaN(ms)) return undefined;
  return new Date(ms);
}

/** Referrer origin + path only — query strings carry tokens (§8.5). */
function referrerOriginPath(v) {
  if (typeof v !== 'string' || !v) return '';
  try {
    const u = new URL(v);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return `${u.origin}${u.pathname}`.slice(0, 300);
  } catch {
    return '';
  }
}

/** Persisted attribution: whitelisted, capped UTM keys + referrer origin/path. Nothing else. */
export function pickSourceMetadata(source, referrerHeader) {
  const out = {};
  const src = source && typeof source === 'object' ? source : {};
  for (const k of SOURCE_UTM_KEYS) {
    const s = sanitizeText(src[k], 100);
    if (s) out[k] = s;
  }
  const ref = referrerOriginPath(src.referrer) || referrerOriginPath(referrerHeader);
  if (ref) out.referrer = ref;
  return out;
}
