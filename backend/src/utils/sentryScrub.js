// Shared PII scrubbing for Sentry events. Mirrors `lyfe-sg/sentry.scrub.ts`
// and `lyfe-app/lib/sentry.ts` so the three apps redact identical key
// patterns. Substring-based, case-insensitive match on key names so
// `agentPhone`, `lead_email`, `staff_full_name`, etc. all get redacted.

import { maskTokenUrl } from './redactTokens.js';

const PII_KEY_PATTERN = /phone|email|nric|name|token|jwt|address|otp|password|signature|secret|private_?key|authorization/i;

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
  return event;
}

export function scrubBreadcrumb(breadcrumb) {
  if (!breadcrumb) return breadcrumb;
  if (breadcrumb.data) {
    breadcrumb.data = scrubObject(breadcrumb.data);
    if (typeof breadcrumb.data.url === 'string') breadcrumb.data.url = maskTokenUrl(breadcrumb.data.url);
  }
  if (typeof breadcrumb.message === 'string') breadcrumb.message = maskTokenUrl(breadcrumb.message);
  return breadcrumb;
}
