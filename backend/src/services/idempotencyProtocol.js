/**
 * Idempotency-key primitives (P4-3). The held-queue endpoints hand-rolled
 * this protocol three times with three DIFFERENT orderings — and those
 * orderings are deliberate concurrency contracts, so they are NOT flattened
 * into one wrapper:
 *
 *   releaseHeldProspect     replay-check upfront, record on completion
 *                           (concurrent same-key calls may both run; last
 *                           record wins — acceptable for its no-op-on-retry
 *                           status machine)
 *   reassignProspectExternal CLAIM-first (unique insert; loser replays the
 *                           winner or reports in_progress) — this one charges
 *                           credits and dispatches, so double-run must be
 *                           impossible
 *   returnProspectToHeld    replay-check upfront, record INSIDE the outcome
 *                           transaction (claim races surface at commit)
 *
 * What WAS triplicated — the lookups, the record shapes and the 24h TTL
 * literal — lives here once; each call site composes these primitives in its
 * own order.
 */

export const IDEMP_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * How long an UNFINISHED claim may sit before another caller may take it over
 * (P2-13).
 *
 * claimOrReplay inserts a null-body row, runs the operation, then fills the
 * result. A crash in between left that null row for the full 24h replay TTL,
 * and every retry got `in_progress` forever — the key was poisoned by a
 * process that no longer exists. No held-queue operation legitimately runs for
 * minutes, so a claim older than this is an abandoned one, not a live one. A
 * COMPLETED record still keeps the full 24h: that one is a real answer worth
 * replaying.
 */
export const CLAIM_STALE_MS = 5 * 60 * 1000;

export function makeIdempotencyOps(IdempotencyKey) {
  /** Non-claiming replay: the stored result iff present, unexpired and complete. */
  async function replayIfDone(scope, key) {
    if (!key) return null;
    const existing = await IdempotencyKey.findOne({ where: { key, scope } });
    if (existing && existing.expiresAt > new Date() && existing.responseBody) {
      return existing.responseBody;
    }
    return null;
  }

  /**
   * Claim-first: insert a null-body claim; on a unique-key race return the
   * winner's stored result (or in_progress when the winner hasn't finished).
   * Returns { claimed: true } when this caller owns the key, else
   * { claimed: false, replay } with the response to hand back.
   */
  async function claimOrReplay(scope, key) {
    if (!key) return { claimed: true };
    const existing = await IdempotencyKey.findOne({ where: { key, scope } });
    if (existing) {
      const now = Date.now();
      const unexpired = existing.expiresAt > new Date(now);
      if (existing.responseBody && unexpired) {
        return { claimed: false, replay: existing.responseBody };
      }
      // An unfinished claim is only authoritative while it could still be
      // running. The claim instant is derivable from the TTL the claim wrote,
      // so this needs no extra column.
      const claimedAt = new Date(existing.expiresAt).getTime() - IDEMP_TTL_MS;
      const abandoned = !existing.responseBody && now - claimedAt > CLAIM_STALE_MS;
      if (!existing.responseBody && !abandoned) {
        return { claimed: false, replay: { status: 'error', error: 'in_progress' } };
      }
      // Expired result, or a claim whose owner never came back: take it over.
      // Guarded on the row we READ, so two reclaimers cannot both win.
      const [reclaimed] = await IdempotencyKey.update(
        { responseBody: null, responseCode: null, expiresAt: new Date(now + IDEMP_TTL_MS) },
        { where: { key, scope, expiresAt: existing.expiresAt } },
      );
      if (reclaimed === 1) return { claimed: true };
      const winner = await IdempotencyKey.findOne({ where: { key, scope } });
      return { claimed: false, replay: winner?.responseBody ?? { status: 'error', error: 'in_progress' } };
    }
    try {
      await IdempotencyKey.create({
        key, scope, responseBody: null, responseCode: null,
        expiresAt: new Date(Date.now() + IDEMP_TTL_MS),
      });
      return { claimed: true };
    } catch (err) {
      if (err?.name === 'SequelizeUniqueConstraintError' || err?.original?.code === '23505') {
        const winner = await IdempotencyKey.findOne({ where: { key, scope } });
        return { claimed: false, replay: winner?.responseBody ?? { status: 'error', error: 'in_progress' } };
      }
      throw err;
    }
  }

  /** Fill a previously claimed key's result (claim-first sites). Best-effort. */
  async function recordClaimed(scope, key, result) {
    if (!key) return result;
    await IdempotencyKey.update(
      { responseBody: result, responseCode: 200 },
      { where: { key, scope } },
    ).catch(() => {});
    return result;
  }

  /** Create the completed record outright (replay-then-record sites). */
  async function recordResult(scope, key, result, { transaction = null } = {}) {
    if (!key) return result;
    await IdempotencyKey.create({
      key, scope, responseBody: result, responseCode: 200,
      expiresAt: new Date(Date.now() + IDEMP_TTL_MS),
    }, transaction ? { transaction } : {});
    return result;
  }

  /** The unique-race fallback shared by the record paths. */
  async function replayOnUniqueRace(scope, key, err) {
    if (key && (err?.name === 'SequelizeUniqueConstraintError' || err?.original?.code === '23505')) {
      const winner = await IdempotencyKey.findOne({ where: { key, scope } });
      if (winner?.responseBody) return winner.responseBody;
    }
    return null;
  }

  return { replayIfDone, claimOrReplay, recordClaimed, recordResult, replayOnUniqueRace };
}
