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
 * In-memory is sufficient FOR THAT JOB, and consistent with the rest of the DNC feature
 * (dncService's hourly budget guard + the /dnc/check result cache are also in-memory)
 * because the backend is single-instance. Losing the markers on restart is fail-open by
 * design: no marker => /dnc/check returns registered:false => no consent gate shows => the
 * create-path DNC scrub still backstops. It is never a security downgrade — a missing marker
 * only HIDES the gate, it can never wrongly reveal a status.
 *
 * ── The second job, and why half of this file is durable ──
 * prospectService later started reading these markers to decide whether to write
 * `sourceMetadata.phoneVerifiedAt`, and Redeem Ops issuance refuses to mint reward value
 * without that stamp. Fail-open stopped being harmless the moment a missing marker cost a
 * real person a real voucher: a redeploy between "verified" and "submit", or a lead who took
 * more than ten minutes over the rest of the form, left them permanently ineligible AND
 * labelled "phone unverified" in the console. So the reward-bearing question is answered by
 * `isPhoneVerifiedDurable` against PhoneVerificationMarker (hash-keyed, survives restarts),
 * with the Map kept in front of it as a no-round-trip fast path. The DNC oracle keeps using
 * the sync in-memory check — its fail-open is deliberate and its TTL is the right one.
 *
 * Keyed by the FULL phone (e.g. "+6591234567"), matching how both /verify/check and
 * /dnc/check assemble it (`${countryCode}${phone}`), so the two agree on the key; the
 * durable half hashes that same string.
 */

import { createHash } from 'crypto';
import { Op } from 'sequelize';
import PhoneVerificationMarker from '../models/PhoneVerificationMarker.js';
import { logger } from '../utils/logger.js';

const verifiedPhones = new Map(); // fullPhone -> expiry epoch ms

const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 min — the gate check fires seconds after verify
const SWEEP_THRESHOLD = 5000; // opportunistic prune ceiling so the map can't grow unbounded

// The DURABLE window (below) is a different question from the DNC gate's. That
// one asks "did this check fire seconds after a verify?"; this one asks "did
// this person prove control of this number during the session they are
// submitting from?" — and has to absorb a redeploy plus a slow form-filler. A
// day is generous on purpose and costs nothing: it is NOT the anti-farming
// control (per-activation phoneKey de-dup is), it only decides whether we can
// honestly say the proof exists.
const DEFAULT_DURABLE_TTL_MS = 24 * 60 * 60 * 1000;

function ttlMs() {
  const v = Number(process.env.DNC_VERIFIED_MARKER_TTL_MS);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_TTL_MS;
}

function durableTtlMs() {
  const v = Number(process.env.PHONE_VERIFICATION_DURABLE_TTL_MS);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_DURABLE_TTL_MS;
}

/** sha256 hex of the full E.164 phone — the marker table's key. */
export function phoneMarkerHash(fullPhone) {
  return createHash('sha256').update(String(fullPhone)).digest('hex');
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

/**
 * Commit the durable proof (see PhoneVerificationMarker). Upserts, so
 * re-verifying refreshes the window. NEVER throws and never blocks: a marker
 * we failed to persist costs a reward stamp, but an OTP check that 500s
 * because the marker table hiccuped costs the whole lead.
 */
export async function persistPhoneVerification(fullPhone, now = Date.now(), deps = {}) {
  if (!fullPhone) return false;
  const Marker = deps.PhoneVerificationMarker || PhoneVerificationMarker;
  try {
    await Marker.upsert({ phoneHash: phoneMarkerHash(fullPhone), verifiedAt: new Date(now) });
  } catch (err) {
    (deps.logger || logger).warn({ err: err?.message }, 'phone_verification.marker_persist_failed');
    return false;
  }
  // Retention: a marker past the durable window can never answer `true` again,
  // so keeping it is pure liability. Swept here rather than on a cron because
  // OTP verifies are the only thing that grows this table (tens per month) and
  // the DELETE is one indexed range scan. Detached: retention must never
  // delay, or fail, the verify it rides on.
  Promise.resolve(pruneExpiredMarkers(now, deps)).catch(() => {});
  return true;
}

/** Drop markers past the durable window. Never throws. */
export async function pruneExpiredMarkers(now = Date.now(), deps = {}) {
  const Marker = deps.PhoneVerificationMarker || PhoneVerificationMarker;
  try {
    return await Marker.destroy({
      where: { verifiedAt: { [Op.lt]: new Date(now - durableTtlMs()) } },
    });
  } catch (err) {
    (deps.logger || logger).warn({ err: err?.message }, 'phone_verification.marker_prune_failed');
    return 0;
  }
}

/**
 * True iff this phone proved control within the durable window — the in-memory
 * marker first (the overwhelmingly common case, no DB round-trip), then the
 * persisted row, which is what survives a restart.
 *
 * Fail-CLOSED on a read error: the only thing downstream does with a `true` is
 * write a permanent "this phone was verified" stamp that reward issuance
 * trusts, and a DB wobble must never be able to mint one. A `false` here is
 * exactly today's behaviour, and never blocks lead capture.
 */
export async function isPhoneVerifiedDurable(fullPhone, now = Date.now(), deps = {}) {
  if (!fullPhone) return false;
  if (isPhoneRecentlyVerified(fullPhone, now)) return true;
  const Marker = deps.PhoneVerificationMarker || PhoneVerificationMarker;
  try {
    const row = await Marker.findByPk(phoneMarkerHash(fullPhone), { attributes: ['verifiedAt'] });
    const at = row?.verifiedAt ? new Date(row.verifiedAt).getTime() : NaN;
    if (!Number.isFinite(at)) return false;
    return now - at < durableTtlMs();
  } catch (err) {
    (deps.logger || logger).warn({ err: err?.message }, 'phone_verification.marker_read_failed');
    return false;
  }
}

/** PR C erasure: drop one phone's marker immediately (post-commit eviction). */
export function evictVerifiedPhone(fullPhone) {
  if (fullPhone) verifiedPhones.delete(fullPhone);
}

/**
 * PDPA erasure, durable half — the persisted proof is personal data and must
 * go with the in-memory marker. Never throws: erasure of the prospect itself
 * has already committed by the time this runs.
 */
export async function forgetPhoneVerification(fullPhone, deps = {}) {
  if (!fullPhone) return false;
  const Marker = deps.PhoneVerificationMarker || PhoneVerificationMarker;
  try {
    await Marker.destroy({ where: { phoneHash: phoneMarkerHash(fullPhone) } });
    return true;
  } catch (err) {
    (deps.logger || logger).warn({ err: err?.message }, 'phone_verification.marker_erase_failed');
    return false;
  }
}

/** Test helper — clear all markers. */
export function _resetVerifiedPhones() {
  verifiedPhones.clear();
}

export default {
  markPhoneVerified, isPhoneRecentlyVerified, evictVerifiedPhone, _resetVerifiedPhones,
  persistPhoneVerification, isPhoneVerifiedDurable, forgetPhoneVerification, phoneMarkerHash,
  pruneExpiredMarkers,
};
