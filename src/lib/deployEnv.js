// Frontend deployment identity — the build-time twin of
// backend/src/utils/deployEnv.js.
//
// A sandbox build is a PRODUCTION Vite build (import.meta.env.PROD is true), so
// nothing Vite exposes can distinguish it. VITE_DEPLOY_ENV is that distinction,
// and it drives the banner, the robots/canonical behaviour and the Sentry
// environment tag.
//
// See docs/plans/mktr-production-sandbox.md §4 and §6.4.

const RAW = (import.meta.env.VITE_DEPLOY_ENV || '').trim().toLowerCase();

export const DEPLOY_ENV = RAW || (import.meta.env.PROD ? 'production' : 'development');

/** True only for the exact sandbox build — a typo can never turn this on. */
export const IS_SANDBOX = DEPLOY_ENV === 'sandbox';

/** Environment label for Sentry and any client-side telemetry. */
export function observabilityEnvironment() {
  return import.meta.env.VITE_SENTRY_ENVIRONMENT || DEPLOY_ENV;
}

export default { DEPLOY_ENV, IS_SANDBOX, observabilityEnvironment };
