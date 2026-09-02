/**
 * Deployment identity — the ONE thing that says which environment this process is.
 *
 * `NODE_ENV` cannot carry this: the sandbox deliberately runs `NODE_ENV=production`
 * so every production security behaviour (secure cookies, trust proxy, rate limits,
 * no swagger) stays active. A second, explicit variable therefore names the
 * deployment: DEPLOY_ENV ∈ {production, sandbox, development, test}.
 *
 * Fail-closed rules encoded here:
 *   - An unknown/misspelled DEPLOY_ENV is NEVER silently treated as production.
 *     `deployEnv()` throws instead, and startup validation turns that into a
 *     refusal to boot.
 *   - `isSandbox()` is true only for the exact string 'sandbox'. Every outbound
 *     guard keys off it, so a typo can only ever make the guards STRICTER
 *     (unknown → throw), never looser.
 *
 * See docs/plans/mktr-production-sandbox.md §4.
 */

export const DEPLOY_ENVS = /** @type {const} */ (['production', 'sandbox', 'development', 'test']);

/** Default when DEPLOY_ENV is absent — derived from NODE_ENV, never guessed as sandbox. */
function fallbackFromNodeEnv() {
  const nodeEnv = String(process.env.NODE_ENV || '').toLowerCase();
  if (nodeEnv === 'test') return 'test';
  if (nodeEnv === 'production') return 'production';
  return 'development';
}

/**
 * The resolved deployment identity.
 * @returns {'production'|'sandbox'|'development'|'test'}
 * @throws when DEPLOY_ENV is set to something outside the enum.
 */
export function deployEnv() {
  const raw = process.env.DEPLOY_ENV;
  if (raw === undefined || raw === '') return fallbackFromNodeEnv();
  const value = String(raw).trim().toLowerCase();
  if (!DEPLOY_ENVS.includes(/** @type {any} */ (value))) {
    throw new Error(
      `FATAL: DEPLOY_ENV="${raw}" is not one of ${DEPLOY_ENVS.join(', ')} — refusing to guess an environment identity.`,
    );
  }
  return /** @type {any} */ (value);
}

/** True only for the exact sandbox deployment. */
export function isSandbox() {
  return deployEnv() === 'sandbox';
}

/** True only for the real production deployment. */
export function isProductionDeploy() {
  return deployEnv() === 'production';
}

/**
 * Environment label for Sentry, logs, metrics and audit rows. Deliberately the
 * DEPLOY_ENV value, not NODE_ENV — a sandbox event must never read "production".
 */
export function observabilityEnvironment() {
  return process.env.SENTRY_ENVIRONMENT || deployEnv();
}

/** Boolean env read that treats anything but the literal "true" as false. */
export function flagOn(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return String(raw).trim().toLowerCase() === 'true';
}

export default { DEPLOY_ENVS, deployEnv, isSandbox, isProductionDeploy, observabilityEnvironment, flagOn };
