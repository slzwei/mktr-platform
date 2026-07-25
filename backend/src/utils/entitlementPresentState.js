/**
 * The ONE DB-status → UI-state mapper for reward entitlements. Extracted for
 * the Lead Profile page from routes/externalEntitlements.js (which keeps its
 * own copy for now — consolidating the HMAC surfaces is deliberately out of
 * this PR's blast radius; docs/plans/admin-lead-profile-page.md §4 B2).
 *
 * `<=` (not `<`) so presentation can never say "valid" for an instant the
 * unlock transaction's `expiresAt > now` predicate would reject. The status
 * column itself can hold 'expired' (sweep) — passed through.
 */
export function presentState(entitlement, now = new Date()) {
  const expired = entitlement.expiresAt && new Date(entitlement.expiresAt) <= now;
  if (entitlement.status === 'eligible') return expired ? 'expired' : 'reserved';
  if (entitlement.status === 'issued') return expired ? 'expired' : 'unlocked';
  return entitlement.status; // redeemed | expired | cancelled | blocked
}
