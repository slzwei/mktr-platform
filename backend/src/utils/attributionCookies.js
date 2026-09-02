import { isSandbox } from './deployEnv.js';

/**
 * Attribution cookie NAMES, namespaced per deployment.
 *
 * `sandbox.mktr.sg` sits under `mktr.sg`, and production sets `sid`/`atk` with
 * `Domain=.mktr.sg` — so a browser that has visited mktr.sg sends production's
 * `sid` to the sandbox, where it would silently bind sandbox evidence to a
 * production session id (and vice versa on the way back). Renaming the sandbox
 * cookies removes the collision entirely; the sandbox also uses its own
 * ATTRIB_SECRET and IP_HASH_SALT, so a leaked value from one side is inert on
 * the other. See docs/plans/mktr-production-sandbox.md §6.3.
 *
 * Auth cookies are NOT namespaced — `mktr_token` is already host-only and
 * SameSite=Strict, so it never crosses hosts in either direction.
 */

export function sidCookieName() {
  return isSandbox() ? 'sbx_sid' : 'sid';
}

export function atkCookieName() {
  return isSandbox() ? 'sbx_atk' : 'atk';
}

/** Read this deployment's sid cookie (raw — callers still validate the shape). */
export function readSidCookie(req) {
  return req?.cookies?.[sidCookieName()];
}

/** Read this deployment's attribution-token cookie. */
export function readAtkCookie(req) {
  return req?.cookies?.[atkCookieName()];
}

export default { sidCookieName, atkCookieName, readSidCookie, readAtkCookie };
