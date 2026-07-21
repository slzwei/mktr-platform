/**
 * verifiedPhoneStore — a short-lived, in-memory record of phones that just passed OTP
 * verification. It exists ONLY to bridge OTP verification → the DNC consent-gate check.
 *
 * Why it's needed (the oracle fix): POST /api/dnc/check must reveal a number's DNC status
 * ONLY after the caller proved control of that number via OTP — otherwise the endpoint is a
 * free "is X on Singapore's Do Not Call register?" lookup for any number. But
 * verificationService.checkVerificationCode DESTROYS the single-use Verification row on a
 * successful verify, so "was this phone just verified?" can no longer be answered from the
 * DB afterwards. So on a successful verify we stamp a marker here, and /api/dnc/check
 * requires a live marker for the phone.
 *
 * In-memory is sufficient and consistent with the rest of the DNC feature (dncService's
 * hourly budget guard + the /dnc/check result cache are also in-memory) because the backend
 * is single-instance. Losing the markers on restart is fail-open by design: no marker =>
 * /dnc/check returns registered:false => no consent gate shows => the create-path DNC scrub
 * still backstops. It is never a security downgrade — a missing marker only HIDES the gate,
 * it can never wrongly reveal a status.
 *
 * Keyed by the FULL phone (e.g. "+6591234567"), matching how both /verify/check and
 * /dnc/check assemble it (`${countryCode}${phone}`), so the two agree on the key.
 */

const verifiedPhones = new Map(); // fullPhone -> expiry epoch ms

const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 min — the gate check fires seconds after verify
const SWEEP_THRESHOLD = 5000; // opportunistic prune ceiling so the map can't grow unbounded

function ttlMs() {
  const v = Number(process.env.DNC_VERIFIED_MARKER_TTL_MS);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_TTL_MS;
}

/** Drop expired entries. Cheap (Map iteration); only invoked when the map gets large. */
function prune(now) {
  for (const [phone, exp] of verifiedPhones) {
    if (exp <= now) verifiedPhones.delete(phone);
  }
}

/**
 * Stamp `fullPhone` as recently verified. Called from verificationService on a successful
 * OTP check. No-op for a falsy phone.
 */
export function markPhoneVerified(fullPhone, now = Date.now()) {
  if (!fullPhone) return;
  // Bound memory: a non-DNC campaign never reads these back, so they'd otherwise linger
  // until expiry. Sweep when the map grows large rather than on every call.
  if (verifiedPhones.size >= SWEEP_THRESHOLD) prune(now);
  verifiedPhones.set(fullPhone, now + ttlMs());
}

/**
 * True iff `fullPhone` has a live (non-expired) verification marker. Self-prunes the entry
 * when it has expired.
 */
export function isPhoneRecentlyVerified(fullPhone, now = Date.now()) {
  if (!fullPhone) return false;
  const exp = verifiedPhones.get(fullPhone);
  if (!exp) return false;
  if (exp <= now) {
    verifiedPhones.delete(fullPhone);
    return false;
  }
  return true;
}

/** PR C erasure: drop one phone's marker immediately (post-commit eviction). */
export function evictVerifiedPhone(fullPhone) {
  if (fullPhone) verifiedPhones.delete(fullPhone);
}

/** Test helper — clear all markers. */
export function _resetVerifiedPhones() {
  verifiedPhones.clear();
}

export default { markPhoneVerified, isPhoneRecentlyVerified, evictVerifiedPhone, _resetVerifiedPhones };
