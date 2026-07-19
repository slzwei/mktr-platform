import { createHash, randomUUID } from 'crypto';
import { sequelize, Consumer, Prospect, RewardEntitlement } from '../models/index.js';
import { logger } from '../utils/logger.js';
import { emailNormKey } from './repeatSignup.js';
import { normalizePhone } from './prospectHelpers.js';

/**
 * Consumer spine (docs/plans/consumer-spine-and-consent-ledger.md §2).
 *
 * `consumers` is a REBUILDABLE PROJECTION of `prospects`, keyed by E.164
 * phone. Three invariants every writer here preserves:
 *
 *  1. Capture is sacred — the resolver runs inside a SAVEPOINT and returns
 *     null on ANY failure; a lead is never lost to spine trouble. (A plain
 *     catch inside the outer transaction would be useless: Postgres poisons
 *     the whole txn on the first error — the savepoint is what makes
 *     "non-blocking" real. Codex R1 #2.)
 *  2. call_bot (Retell) rows never link: prospect.phone is the call's
 *     to_number — for inbound calls that is MKTR's own DDI, and linking would
 *     merge strangers onto one consumer (retellService.js DNC note, R1 #4).
 *  3. Counters are ASSIGNED by recompute/reconcile, only ever incremented by
 *     the capture resolver — drift always heals toward the row-derived truth.
 */

export const E164_RE = /^\+[1-9]\d{9,14}$/;

/** sha256 hex — same recipe as sourceMetadata.phoneVerifiedFor (prospectService §2.0). */
export function phoneHashOf(phone) {
  return createHash('sha256').update(String(phone)).digest('hex');
}

/**
 * Is the prospect's OTP verification stamp valid for its CURRENT phone?
 * `phoneVerifiedFor` binds the stamp to the number it was earned for — a staff
 * phone edit must not inherit verified status (Codex R1 #6). Legacy stamps
 * without the binding stay valid (they predate it).
 */
export function phoneVerificationIsCurrent(prospect) {
  const sm = prospect?.sourceMetadata;
  if (!sm?.phoneVerifiedAt) return false;
  if (!sm.phoneVerifiedFor) return true;
  return sm.phoneVerifiedFor === phoneHashOf(String(prospect.phone || ''));
}

/** Trimmed real email for consumer attributes; null for missing/synthetic. */
function displayEmailOf(email) {
  return emailNormKey(email) ? String(email).trim() : null;
}

const defaultDeps = { sequelize, Consumer, Prospect, RewardEntitlement, logger };

export function makeConsumerService(overrides = {}) {
  const d = { ...defaultDeps, ...overrides };

  /**
   * Resolve-or-create the consumer for an (already-normalized) E.164 phone,
   * inside a SAVEPOINT on `outerTx`. One atomic upsert — no 23505 is ever
   * raised for the concurrent-capture race. Returns the consumer id, or null
   * (no/invalid phone, or any failure — logged; the reconciler heals).
   *
   * `verified` = the caller's single OTP-marker read (otpMarkerLive). Names
   * refresh on verified signups (or fill when empty); email only when real.
   */
  async function resolveConsumerForCaptureTx(outerTx, {
    phone, firstName, lastName, email, verified = false, at = new Date(),
  } = {}) {
    try {
      if (typeof phone !== 'string' || !E164_RE.test(phone)) return null;
      const fn = typeof firstName === 'string' && firstName.trim() ? firstName.trim() : null;
      const ln = typeof lastName === 'string' && lastName.trim() ? lastName.trim() : null;
      const cleanEmail = displayEmailOf(email);
      const isVerified = verified === true;

      const run = async (sp) => {
        const [rows] = await d.sequelize.query(
          `INSERT INTO consumers
             (id, phone, "phoneHash", "firstName", "lastName", email,
              "firstSeenAt", "lastSeenAt", "signupCount", "verifiedSignupCount",
              "createdAt", "updatedAt")
           VALUES
             (:id, :phone, :phoneHash, :firstName, :lastName, :email,
              :at, :at, 1, :verifiedInc, now(), now())
           ON CONFLICT (phone) WHERE phone IS NOT NULL DO UPDATE SET
             "firstSeenAt" = LEAST(consumers."firstSeenAt", EXCLUDED."firstSeenAt"),
             "lastSeenAt"  = GREATEST(consumers."lastSeenAt", EXCLUDED."lastSeenAt"),
             "signupCount" = consumers."signupCount" + 1,
             "verifiedSignupCount" = consumers."verifiedSignupCount" + :verifiedInc,
             "firstName" = CASE WHEN :firstName IS NOT NULL AND (:verified OR consumers."firstName" IS NULL)
                                THEN :firstName ELSE consumers."firstName" END,
             "lastName"  = CASE WHEN :firstName IS NOT NULL AND (:verified OR consumers."firstName" IS NULL)
                                THEN :lastName ELSE consumers."lastName" END,
             email       = CASE WHEN :email IS NOT NULL AND (:verified OR consumers.email IS NULL)
                                THEN :email ELSE consumers.email END,
             "updatedAt" = now()
           RETURNING id`,
          {
            replacements: {
              id: randomUUID(), phone, phoneHash: phoneHashOf(phone),
              firstName: fn, lastName: ln, email: cleanEmail,
              at, verified: isVerified, verifiedInc: isVerified ? 1 : 0,
            },
            transaction: sp,
          }
        );
        return rows?.[0]?.id || null;
      };

      // Nested managed transaction = SAVEPOINT when outerTx is present.
      return outerTx
        ? await d.sequelize.transaction({ transaction: outerTx }, run)
        : await d.sequelize.transaction(run);
    } catch (err) {
      d.logger.warn('[consumer] resolve failed (non-blocking — reconciler heals)', {
        error: err?.message || String(err),
      });
      return null;
    }
  }

  /**
   * Deterministic per-phone projection recompute — ASSIGNS the full projection
   * from prospect rows (never increments) and relinks rows on that phone.
   * Used after phone/email edits and deletes. Best-effort by design.
   *
   * Known limit: rows whose STORED phone isn't E.164 (Meta keeps the provider
   * raw value in this PR) are counted by the full reconciler (which
   * JS-normalizes) but not by this per-phone SQL aggregate.
   */
  async function recomputeConsumersByPhone(phones, { transaction = null } = {}) {
    try {
      const clean = [...new Set((phones || []).filter((p) => typeof p === 'string' && E164_RE.test(p)))];
      for (const phone of clean) {
        const [aggRows] = await d.sequelize.query(
          `SELECT MIN("createdAt") AS first, MAX("createdAt") AS last, COUNT(*)::int AS n,
                  COUNT(*) FILTER (WHERE "sourceMetadata"->>'phoneVerifiedAt' IS NOT NULL)::int AS v
             FROM prospects
            WHERE phone = :phone AND "leadSource" <> 'call_bot'`,
          { replacements: { phone }, transaction }
        );
        const agg = aggRows?.[0];
        if (!agg || Number(agg.n) === 0) {
          await d.sequelize.query(
            `UPDATE consumers SET "signupCount" = 0, "verifiedSignupCount" = 0, "updatedAt" = now()
              WHERE phone = :phone`,
            { replacements: { phone }, transaction }
          );
          continue;
        }
        const [latestRows] = await d.sequelize.query(
          `SELECT "firstName", "lastName", email FROM prospects
            WHERE phone = :phone AND "leadSource" <> 'call_bot'
            ORDER BY "createdAt" DESC, id DESC LIMIT 1`,
          { replacements: { phone }, transaction }
        );
        const latest = latestRows?.[0] || {};
        await d.sequelize.query(
          `INSERT INTO consumers
             (id, phone, "phoneHash", "firstName", "lastName", email,
              "firstSeenAt", "lastSeenAt", "signupCount", "verifiedSignupCount",
              "createdAt", "updatedAt")
           VALUES (:id, :phone, :phoneHash, :fn, :ln, :email, :first, :last, :n, :v, now(), now())
           ON CONFLICT (phone) WHERE phone IS NOT NULL DO UPDATE SET
             "firstSeenAt" = EXCLUDED."firstSeenAt",
             "lastSeenAt" = EXCLUDED."lastSeenAt",
             "signupCount" = EXCLUDED."signupCount",
             "verifiedSignupCount" = EXCLUDED."verifiedSignupCount",
             "firstName" = EXCLUDED."firstName",
             "lastName" = EXCLUDED."lastName",
             email = EXCLUDED.email,
             "updatedAt" = now()`,
          {
            replacements: {
              id: randomUUID(), phone, phoneHash: phoneHashOf(phone),
              fn: latest.firstName || null, ln: latest.lastName || null,
              email: displayEmailOf(latest.email),
              first: agg.first, last: agg.last, n: Number(agg.n), v: Number(agg.v),
            },
            transaction,
          }
        );
        await d.sequelize.query(
          `UPDATE prospects p SET "consumerId" = c.id
             FROM consumers c
            WHERE c.phone = :phone AND p.phone = :phone
              AND p."leadSource" <> 'call_bot'
              AND p."consumerId" IS DISTINCT FROM c.id`,
          { replacements: { phone }, transaction }
        );
      }
    } catch (err) {
      d.logger.warn('[consumer] recompute failed (reconciler heals)', {
        error: err?.message || String(err),
      });
    }
  }

  /**
   * Full spine reconcile — migration 079 + scripts/rebuild-consumer-spine.js.
   * JS-normalizes phones with the SAME normalizePhone as capture (raw-stored
   * Meta rows group correctly), ASSIGNS complete projections, heals wrong and
   * missing links, unlinks call_bot rows, links entitlements via prospect then
   * phoneKey, and zeroes consumers whose phone no longer has rows. Idempotent.
   */
  async function reconcileConsumerSpine({ transaction = null } = {}) {
    const runIn = async (t) => {
      const stats = {
        consumersUpserted: 0, prospectsLinked: 0, callBotUnlinked: 0,
        entitlementsViaProspect: 0, entitlementsViaPhoneKey: 0,
        consumersZeroed: 0, skippedInvalidPhone: 0,
      };

      const [rows] = await d.sequelize.query(
        `SELECT id, phone, "firstName", "lastName", email, "createdAt",
                ("sourceMetadata"->>'phoneVerifiedAt') IS NOT NULL AS verified
           FROM prospects
          WHERE phone IS NOT NULL AND phone <> '' AND "leadSource" <> 'call_bot'
          ORDER BY "createdAt" ASC, id ASC`,
        { transaction: t }
      );

      // Group by capture-normalized phone (exact same rule as the live path).
      const groups = new Map();
      for (const r of rows) {
        const norm = normalizePhone(r.phone);
        if (!E164_RE.test(norm)) { stats.skippedInvalidPhone += 1; continue; }
        if (!groups.has(norm)) groups.set(norm, []);
        groups.get(norm).push(r);
      }

      const linkPairs = []; // [prospectId, consumerId]
      for (const [phone, members] of groups) {
        const first = members[0];
        const latest = members[members.length - 1];
        const [ins] = await d.sequelize.query(
          `INSERT INTO consumers
             (id, phone, "phoneHash", "firstName", "lastName", email,
              "firstSeenAt", "lastSeenAt", "signupCount", "verifiedSignupCount",
              "createdAt", "updatedAt")
           VALUES (:id, :phone, :phoneHash, :fn, :ln, :email, :first, :last, :n, :v, now(), now())
           ON CONFLICT (phone) WHERE phone IS NOT NULL DO UPDATE SET
             "firstSeenAt" = EXCLUDED."firstSeenAt",
             "lastSeenAt" = EXCLUDED."lastSeenAt",
             "signupCount" = EXCLUDED."signupCount",
             "verifiedSignupCount" = EXCLUDED."verifiedSignupCount",
             "firstName" = EXCLUDED."firstName",
             "lastName" = EXCLUDED."lastName",
             email = EXCLUDED.email,
             "updatedAt" = now()
           RETURNING id`,
          {
            replacements: {
              id: randomUUID(), phone, phoneHash: phoneHashOf(phone),
              fn: latest.firstName || null, ln: latest.lastName || null,
              email: displayEmailOf(latest.email),
              first: first.createdAt, last: latest.createdAt,
              n: members.length, v: members.filter((m) => m.verified === true).length,
            },
            transaction: t,
          }
        );
        const consumerId = ins?.[0]?.id;
        stats.consumersUpserted += 1;
        for (const m of members) linkPairs.push([m.id, consumerId]);
      }

      // Relink in batches — fixes wrong links, not just nulls.
      const BATCH = 300;
      for (let i = 0; i < linkPairs.length; i += BATCH) {
        const slice = linkPairs.slice(i, i + BATCH);
        const values = slice.map((_, j) => `(:p${j}::uuid, :c${j}::uuid)`).join(',');
        const repl = {};
        slice.forEach(([pid, cid], j) => { repl[`p${j}`] = pid; repl[`c${j}`] = cid; });
        const [, meta] = await d.sequelize.query(
          `UPDATE prospects AS p SET "consumerId" = v.cid
             FROM (VALUES ${values}) AS v(pid, cid)
            WHERE p.id = v.pid AND p."consumerId" IS DISTINCT FROM v.cid`,
          { replacements: repl, transaction: t }
        );
        stats.prospectsLinked += meta?.rowCount ?? 0;
      }

      const [, cbMeta] = await d.sequelize.query(
        `UPDATE prospects SET "consumerId" = NULL
          WHERE "leadSource" = 'call_bot' AND "consumerId" IS NOT NULL`,
        { transaction: t }
      );
      stats.callBotUnlinked = cbMeta?.rowCount ?? 0;

      const [, reP] = await d.sequelize.query(
        `UPDATE reward_entitlements re SET "consumerId" = p."consumerId"
           FROM prospects p
          WHERE re."prospectId" = p.id AND p."consumerId" IS NOT NULL
            AND re."consumerId" IS DISTINCT FROM p."consumerId"`,
        { transaction: t }
      );
      stats.entitlementsViaProspect = reP?.rowCount ?? 0;

      // Legacy/unlinked entitlements: phoneKey is digits incl. country code,
      // consumers.phone is '+'+digits.
      const [, reK] = await d.sequelize.query(
        `UPDATE reward_entitlements re SET "consumerId" = c.id
           FROM consumers c
          WHERE (re."prospectId" IS NULL OR re."consumerId" IS NULL)
            AND re."phoneKey" IS NOT NULL
            AND c.phone = '+' || re."phoneKey"
            AND re."consumerId" IS DISTINCT FROM c.id`,
        { transaction: t }
      );
      stats.entitlementsViaPhoneKey = reK?.rowCount ?? 0;

      // A consumer whose phone no longer matches any live row (edits moved
      // them all away) keeps the row but drops to zero counts.
      const seen = [...groups.keys()];
      const [, zMeta] = await d.sequelize.query(
        seen.length
          ? `UPDATE consumers SET "signupCount" = 0, "verifiedSignupCount" = 0, "updatedAt" = now()
              WHERE phone IS NOT NULL AND "signupCount" <> 0 AND NOT (phone = ANY(ARRAY[:seen]::text[]))`
          : `UPDATE consumers SET "signupCount" = 0, "verifiedSignupCount" = 0, "updatedAt" = now()
              WHERE phone IS NOT NULL AND "signupCount" <> 0`,
        { replacements: seen.length ? { seen } : {}, transaction: t }
      );
      stats.consumersZeroed = zMeta?.rowCount ?? 0;

      return stats;
    };

    if (transaction) return runIn(transaction);
    return d.sequelize.transaction(runIn);
  }

  /**
   * One person's full history (admin journey view). Returns null when the
   * consumer doesn't exist. Deliberately returns DERIVED fields only — no raw
   * sourceMetadata (agents/admins get PII-heavy metadata elsewhere; this
   * endpoint aggregates cross-campaign and stays lean).
   */
  async function getConsumerJourney(consumerId) {
    const consumer = await d.Consumer.findByPk(consumerId);
    if (!consumer) return null;

    const [signups, entitlements] = await Promise.all([
      d.Prospect.findAll({
        where: { consumerId },
        attributes: [
          'id', 'firstName', 'lastName', 'phone', 'campaignId', 'leadStatus', 'leadSource',
          'createdAt', 'conversionDate', 'quarantinedAt', 'quarantineReason', 'sourceMetadata',
        ],
        include: [{ association: 'campaign', attributes: ['id', 'name', 'status'] }],
        order: [['createdAt', 'DESC'], ['id', 'DESC']],
      }),
      d.RewardEntitlement.findAll({
        where: { consumerId },
        attributes: ['id', 'status', 'createdAt', 'unlockedAt', 'expiresAt'],
        include: [
          { association: 'rewardOffer', attributes: ['id', 'title', 'publicTitle'] },
          { association: 'activation', attributes: ['id', 'campaignId', 'campaignNameSnapshot'] },
          { association: 'redemption', attributes: ['id', 'redeemedAt', 'status'] },
        ],
        order: [['createdAt', 'DESC'], ['id', 'DESC']],
      }),
    ]);

    return {
      consumer: {
        id: consumer.id,
        phone: consumer.phone,
        firstName: consumer.firstName,
        lastName: consumer.lastName,
        email: consumer.email,
        firstSeenAt: consumer.firstSeenAt,
        lastSeenAt: consumer.lastSeenAt,
        signupCount: consumer.signupCount,
        verifiedSignupCount: consumer.verifiedSignupCount,
        erasedAt: consumer.erasedAt,
      },
      signups: signups.map((s) => ({
        prospectId: s.id,
        firstName: s.firstName,
        lastName: s.lastName,
        campaign: s.campaign ? { id: s.campaign.id, name: s.campaign.name, status: s.campaign.status } : null,
        leadStatus: s.leadStatus,
        leadSource: s.leadSource,
        createdAt: s.createdAt,
        conversionDate: s.conversionDate,
        held: !!s.quarantinedAt,
        heldReason: s.quarantineReason || null,
        verified: phoneVerificationIsCurrent(s),
      })),
      entitlements: entitlements.map((e) => ({
        id: e.id,
        status: e.status,
        createdAt: e.createdAt,
        unlockedAt: e.unlockedAt,
        expiresAt: e.expiresAt,
        rewardTitle: e.rewardOffer ? (e.rewardOffer.publicTitle || e.rewardOffer.title) : null,
        campaignName: e.activation?.campaignNameSnapshot || null,
        campaignId: e.activation?.campaignId || null,
        redeemedAt: e.redemption?.redeemedAt || null,
      })),
    };
  }

  return {
    resolveConsumerForCaptureTx,
    recomputeConsumersByPhone,
    reconcileConsumerSpine,
    getConsumerJourney,
  };
}

const _default = makeConsumerService();
export const resolveConsumerForCaptureTx = _default.resolveConsumerForCaptureTx;
export const recomputeConsumersByPhone = _default.recomputeConsumersByPhone;
export const reconcileConsumerSpine = _default.reconcileConsumerSpine;
export const getConsumerJourney = _default.getConsumerJourney;
