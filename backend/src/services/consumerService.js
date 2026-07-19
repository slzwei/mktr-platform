import { createHash, randomUUID } from 'crypto';
import { Transaction } from 'sequelize';
import { sequelize, Consumer, Prospect, RewardEntitlement, DrawEntry } from '../models/index.js';
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
 *  3. Counters and attributes are ASSIGNED by recompute/reconcile from one
 *     shared projection reducer, only ever incremented by the capture
 *     resolver — drift always heals toward the row-derived truth.
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

/**
 * The ONE projection reducer (Codex R2 #2) — recompute and reconcile both
 * derive a consumer row from its member prospects through this, so the two
 * rebuild paths can never disagree. Attributes are independent (R2 #1):
 * newest non-empty VERIFIED value per attribute, else newest non-empty value.
 * `verified` uses the binding-aware check, never the raw stamp.
 *
 * @param {Array} members - prospect rows ASC by (createdAt, id), each with
 *   firstName/lastName/email/phone/sourceMetadata/createdAt.
 */
function buildProjection(members) {
  let fn = null; let ln = null; let email = null;
  let vFn = null; let vLn = null; let vEmail = null;
  let verifiedCount = 0;
  for (const m of members) {
    const isVerified = phoneVerificationIsCurrent(m);
    if (isVerified) verifiedCount += 1;
    const first = typeof m.firstName === 'string' && m.firstName.trim() ? m.firstName.trim() : null;
    const last = typeof m.lastName === 'string' && m.lastName.trim() ? m.lastName.trim() : null;
    const em = displayEmailOf(m.email);
    if (first) { fn = first; if (isVerified) vFn = first; }
    if (last) { ln = last; if (isVerified) vLn = last; }
    if (em) { email = em; if (isVerified) vEmail = em; }
  }
  return {
    first: members[0].createdAt,
    last: members[members.length - 1].createdAt,
    n: members.length,
    v: verifiedCount,
    fn: vFn ?? fn,
    ln: vLn ?? ln,
    email: vEmail ?? email,
  };
}

const MEMBER_FIELDS = `id, phone, "firstName", "lastName", email, "createdAt", "sourceMetadata"`;

const defaultDeps = { sequelize, Consumer, Prospect, RewardEntitlement, DrawEntry, logger };

export function makeConsumerService(overrides = {}) {
  const d = { ...defaultDeps, ...overrides };

  /** Assign-upsert one consumer row from a reduced projection. */
  async function upsertProjection(phone, proj, transaction) {
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
          fn: proj.fn, ln: proj.ln, email: proj.email,
          first: proj.first, last: proj.last, n: proj.n, v: proj.v,
        },
        transaction,
      }
    );
  }

  /**
   * Resolve-or-create the consumer for an (already-normalized) E.164 phone,
   * inside a SAVEPOINT on `outerTx`. One atomic upsert — no 23505 is ever
   * raised for the concurrent-capture race. Returns the consumer id, or null
   * (no/invalid phone, or any failure — logged; the reconciler heals).
   *
   * `verified` = the caller's single OTP-marker read (otpMarkerLive). Each
   * attribute refreshes independently on verified signups (or fills when
   * empty); email only when real.
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
             "lastName"  = CASE WHEN :lastName IS NOT NULL AND (:verified OR consumers."lastName" IS NULL)
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
   * from prospect rows via the shared reducer (never increments) and relinks
   * rows on that phone. Used after phone/email edits and deletes. Best-effort
   * by design.
   *
   * Known limit: rows whose STORED phone isn't E.164 (Meta keeps the provider
   * raw value in this PR) are counted by the full reconciler (which
   * JS-normalizes) but not by this per-phone SQL match.
   */
  async function recomputeConsumersByPhone(phones, { transaction = null } = {}) {
    try {
      const clean = [...new Set((phones || []).filter((p) => typeof p === 'string' && E164_RE.test(p)))];
      for (const phone of clean) {
        const [rows] = await d.sequelize.query(
          `SELECT ${MEMBER_FIELDS} FROM prospects
            WHERE phone = :phone AND "leadSource" <> 'call_bot'
            ORDER BY "createdAt" ASC, id ASC`,
          { replacements: { phone }, transaction }
        );
        if (!rows.length) {
          await d.sequelize.query(
            `UPDATE consumers SET "signupCount" = 0, "verifiedSignupCount" = 0, "updatedAt" = now()
              WHERE phone = :phone`,
            { replacements: { phone }, transaction }
          );
          continue;
        }
        await upsertProjection(phone, buildProjection(rows), transaction);
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
   * Meta rows group correctly), reduces each group through buildProjection,
   * ASSIGNS complete projections, heals wrong/missing/stale links, unlinks
   * call_bot and empty-phone rows, links entitlements via prospect then
   * phoneKey, and zeroes consumers whose phone no longer has rows. Idempotent.
   *
   * Runs SERIALIZABLE with retry (Codex R2 #3): the snapshot-then-assign shape
   * would otherwise let a capture that commits mid-reconcile be overwritten
   * with a stale count — SSI aborts the reconcile instead, and we retry.
   */
  async function reconcileConsumerSpine({ transaction = null } = {}) {
    const runIn = async (t) => {
      const stats = {
        consumersUpserted: 0, prospectsLinked: 0, callBotUnlinked: 0,
        emptyPhoneUnlinked: 0, entitlementsViaProspect: 0, entitlementsViaPhoneKey: 0,
        consumersZeroed: 0, skippedInvalidPhone: 0,
      };

      const [rows] = await d.sequelize.query(
        `SELECT ${MEMBER_FIELDS} FROM prospects
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
        const proj = buildProjection(members);
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
              fn: proj.fn, ln: proj.ln, email: proj.email,
              first: proj.first, last: proj.last, n: proj.n, v: proj.v,
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

      // A phone cleared to null/empty (PUT-to-blank) takes its link with it
      // (Codex R2 #4). Invalid-but-present phones are NOT touched: those are
      // capture-linked raw-format rows (Meta) whose links are healed above.
      const [, epMeta] = await d.sequelize.query(
        `UPDATE prospects SET "consumerId" = NULL
          WHERE "consumerId" IS NOT NULL AND (phone IS NULL OR phone = '')`,
        { transaction: t }
      );
      stats.emptyPhoneUnlinked = epMeta?.rowCount ?? 0;

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

    // SERIALIZABLE + retry: a concurrent capture upsert conflicts with our
    // read-then-assign; PG aborts one side with 40001 and we re-derive from
    // the fresh state. Boot/script cadence makes retries cheap and rare.
    let lastErr = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await d.sequelize.transaction(
          { isolationLevel: Transaction.ISOLATION_LEVELS.SERIALIZABLE },
          runIn
        );
      } catch (err) {
        const code = err?.original?.code || err?.parent?.code;
        if (code !== '40001') throw err;
        lastErr = err;
        d.logger.warn('[consumer] reconcile serialization conflict — retrying', { attempt });
      }
    }
    throw lastErr;
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

    const drawEntries = signups.length
      ? await d.DrawEntry.count({ where: { prospectId: signups.map((s) => s.id) } })
      : 0;

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
      drawEntries,
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
