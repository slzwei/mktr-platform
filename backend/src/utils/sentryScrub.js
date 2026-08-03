// Shared PII scrubbing for Sentry events. Mirrors `lyfe-sg/sentry.scrub.ts`
// and `lyfe-app/lib/sentry.ts` so the three apps redact identical key
// patterns. Substring-based, case-insensitive match on key names so
// `agentPhone`, `lead_email`, `staff_full_name`, etc. all get redacted.

import { maskTokenUrl } from './redactTokens.js';

const PII_KEY_PATTERN = /phone|email|nric|name|token|jwt|address|otp|password|signature|secret|private_?key|authorization/i;

/**
 * VALUE-level PII, for free text where there is no key to match on (P2-11).
 *
 * scrubObject only ever looked at key NAMES, and scrubEvent never touched
 * event.message or event.exception at all — so `throw new Error(\`User
 * ${email} not found\`)` landed verbatim in Sentry, and the same string went
 * to pino, which sits OUTSIDE the PDPA erasure matrix. A key-based scrubber
 * cannot help here: the identifier is inside a sentence.
 *
 * Deliberately eager. An 8-digit number beginning 3/6/8/9 is an SG mobile, and
 * redacting the occasional row count or id that happens to look like one is a
 * trade we take: the stack trace still says WHERE, and privacy beats one line
 * of convenience. Keep these in step with lyfe-sg / lyfe-app if they gain a
 * value-level pass.
 */
/** @type {[RegExp, string][]} */
const PII_VALUE_PATTERNS = [
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]'],
  // SPACED display form first (`+65 9123 4567` — the format this platform
  // renders everywhere), else the contiguous patterns below eat its prefix and
  // leave the last four digits sitting in the log.
  [/\+?65[\s-]?[3689]\d{3}[\s-]\d{4}\b/g, '[phone]'],
  [/\+?65[\s-]?[3689]\d{7}\b/g, '[phone]'],
  [/\b[3689]\d{3}[\s-]\d{4}\b/g, '[phone]'],
  [/\b[3689]\d{7}\b/g, '[phone]'],
  [/\b[STFGM]\d{7}[A-Z]\b/gi, '[nric]'],
];

/**
 * Redact identifiers embedded in free text, then mask URL-borne credentials.
 * Non-strings pass through untouched.
 */
export function scrubText(text) {
  if (typeof text !== 'string' || text.length === 0) return text;
  let out = text;
  for (const [pattern, replacement] of PII_VALUE_PATTERNS) out = out.replace(pattern, replacement);
  return maskTokenUrl(out);
}

export function scrubObject(input) {
  if (input == null || typeof input !== 'object') return input;
  if (Array.isArray(input)) return input.map(scrubObject);
  const out = {};
  for (const [k, v] of Object.entries(input)) {
    if (PII_KEY_PATTERN.test(k)) {
      out[k] = '[redacted]';
    } else if (v && typeof v === 'object') {
      out[k] = scrubObject(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function scrubEvent(event) {
  if (!event) return event;
  if (event.extra) event.extra = scrubObject(event.extra);
  if (event.tags) event.tags = scrubObject(event.tags);
  if (event.contexts) event.contexts = scrubObject(event.contexts);
  if (event.request?.data) event.request.data = scrubObject(event.request.data);
  // Reward-claim URLs carry live bearer tokens — mask the path segment
  // (scrubObject only matches key NAMES; a token inside a `url` value slips by).
  if (typeof event.request?.url === 'string') event.request.url = maskTokenUrl(event.request.url);
  // Strip user PII — only id is allowed.
  if (event.user) event.user = { id: event.user.id };
  // The message and the thrown value are FREE TEXT — no key to match on, and
  // the most likely place a real identifier appears (P2-11).
  if (typeof event.message === 'string') event.message = scrubText(event.message);
  for (const entry of event.exception?.values || []) {
    if (typeof entry?.value === 'string') entry.value = scrubText(entry.value);
  }
  return event;
}

export function scrubBreadcrumb(breadcrumb) {
  if (!breadcrumb) return breadcrumb;
  if (breadcrumb.data) {
    breadcrumb.data = scrubObject(breadcrumb.data);
    if (typeof breadcrumb.data.url === 'string') breadcrumb.data.url = maskTokenUrl(breadcrumb.data.url);
  }
  if (typeof breadcrumb.message === 'string') breadcrumb.message = scrubText(breadcrumb.message);
  return breadcrumb;
}
