import { sequelize, Consumer, Prospect, ConsumerProfile } from '../models/index.js';
import { logger } from '../utils/logger.js';

/**
 * The enrichment write fence + input-version bump
 * (docs/plans/consumer-profile-enrichment.md §9, §6.3).
 *
 * WHY (Codex R2 #3): observation ownership is resolved through the MUTABLE
 * prospects.consumerId link, and the spine reconciler relinks prospects
 * without locking either consumer. A consumer-lock alone therefore fences
 * nothing: mapper reads owner A → reconciler moves the prospect to B → B is
 * erased → mapper locks A and inserts, resurrecting enrichment on an erased
 * person. The fence closes this by re-verifying ownership AFTER locking:
 *
 *   read owner → lock that Consumer FOR UPDATE → reject erased →
 *   lock + reload the Prospect → owner unchanged? → write
 *
 * Owner moved ⇒ release (rollback) and retry against the new owner.
 * Erasure itself locks consumer-first (erasureService.js), so a writer that
 * holds the consumer lock cannot interleave with an erasure of that person.
 */

export class ErasedConsumerError extends Error {
  constructor(consumerId) {
    super(`consumer ${consumerId} is erased`);
    this.name = 'ErasedConsumerError';
    this.code = 'CONSUMER_ERASED';
  }
}

/**
 * Transactionally bump a consumer's enrichment input version — an UPSERT so
 * first-time consumers can never lose bumps (Codex R4-era #2). Call from
 * EVERY writer that feeds the synthesis DTO or the score, in the SAME
 * transaction as the mutation. No-op when consumerId is null (unlinked
 * prospects surface later via the repair scan).
 */
export async function bumpEnrichmentInputTx(t, consumerId) {
  if (!consumerId) return;
  // INSERT…SELECT guarded on the live consumer: a bump must never mint a
  // profile row for an erased (or vanished) person — erasure deletes the
  // profile and this would quietly resurrect it.
  await sequelize.query(
    `INSERT INTO consumer_profiles ("consumerId", "inputVersion", "syncedInputVersion", "createdAt", "updatedAt")
     SELECT c.id, 1, 0, now(), now()
       FROM consumers c
      WHERE c.id = :cid AND c."erasedAt" IS NULL
     ON CONFLICT ("consumerId")
     DO UPDATE SET "inputVersion" = consumer_profiles."inputVersion" + 1, "updatedAt" = now()`,
    { replacements: { cid: consumerId }, transaction: t }
  );
}

/** Bump a set of consumer ids (dedup + null-safe) in one transaction. */
export async function bumpManyEnrichmentInputsTx(t, consumerIds) {
  const unique = [...new Set((consumerIds || []).filter(Boolean))];
  for (const cid of unique) {
    await bumpEnrichmentInputTx(t, cid);
  }
}

/**
 * Run `fn(t, { prospect, consumer })` under the relink-aware fence.
 *
 * - `consumer` is null for unlinked prospects (call_bot / cleared phone):
 *   the write proceeds prospect-anchored with no bump.
 * - Erased owner ⇒ throws ErasedConsumerError (callers translate to a
 *   skip/cancel, never a write).
 * - Owner moved between the unlocked read and the locked reload ⇒ retry
 *   (fresh transaction) against the new owner, up to `maxRetries`.
 *
 * fn runs INSIDE the transaction; do all writes on `t` and call
 * bumpEnrichmentInputTx(t, consumer?.id) alongside them.
 */
export async function withConsumerFence(prospectId, fn, { maxRetries = 3 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await sequelize.transaction(async (t) => {
        const unlocked = await Prospect.findByPk(prospectId, {
          attributes: ['id', 'consumerId'],
          transaction: t,
        });
        if (!unlocked) return { skipped: 'prospect_gone' };

        let consumer = null;
        if (unlocked.consumerId) {
          consumer = await Consumer.findByPk(unlocked.consumerId, {
            transaction: t,
            lock: t.LOCK.UPDATE,
          });
          if (!consumer) return { skipped: 'consumer_gone' };
          if (consumer.erasedAt) throw new ErasedConsumerError(consumer.id);
        }

        const prospect = await Prospect.findByPk(prospectId, {
          transaction: t,
          lock: t.LOCK.UPDATE,
        });
        if (!prospect) return { skipped: 'prospect_gone' };

        if ((prospect.consumerId || null) !== (unlocked.consumerId || null)) {
          // Owner moved under us — retry the whole fence against the new owner.
          const moved = new Error('fence_owner_moved');
          moved.code = 'FENCE_OWNER_MOVED';
          throw moved;
        }

        return await fn(t, { prospect, consumer });
      });
    } catch (err) {
      if (err?.code === 'FENCE_OWNER_MOVED' && attempt < maxRetries) {
        lastErr = err;
        continue;
      }
      throw err;
    }
  }
  logger.error('[enrichmentFence] owner kept moving — giving up', { prospectId });
  throw lastErr;
}

/**
 * Manual/consumer-anchored variant: lock the consumer directly (no prospect
 * leg). Used by manual facts, retraction, and synthesis completion (PR 2).
 */
export async function withConsumerLock(consumerId, fn) {
  return sequelize.transaction(async (t) => {
    const consumer = await Consumer.findByPk(consumerId, {
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!consumer) return { skipped: 'consumer_gone' };
    if (consumer.erasedAt) throw new ErasedConsumerError(consumer.id);
    return fn(t, { consumer });
  });
}

export { ConsumerProfile };
