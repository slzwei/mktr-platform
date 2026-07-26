import { createHash, randomUUID } from 'crypto';
import { Transaction } from 'sequelize';
import { sequelize, Consumer, Prospect, RewardEntitlement, DrawEntry } from '../models/index.js';
import { logger } from '../utils/logger.js';
import { escapeLike } from '../utils/escapeLike.js';
import { emailNormKey } from './repeatSignup.js';
import { normalizePhone } from './prospectHelpers.js';
// Enrichment input bumps on relink (consumer-profile-enrichment plan §6.3,
// Codex R4-era #2): a moved prospect changes BOTH people's resolved facts.
// Leaf import (models only) — no cycle.
import { bumpManyEnrichmentInputsTx } from './enrichmentFence.js';
import { markLeadsDirtyTx } from './leadScoreDirty.js';

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

/**
 * The instant the server began PERSISTING OTP proof onto a prospect (the
 * prospectService §2.0 stamp, shipped in 059bb1c on 2026-07-09). Signups
 * captured before this could never carry `phoneVerifiedAt` no matter how the
 * lead behaved: the public form has hard-gated submit on
 * `otpState !== 'verified'` since 2025-09-03, so on an older row a missing
 * stamp is MISSING EVIDENCE, not evidence of a missing verification.
 *
 * Dated a clear day past the deploy — no real signup lands in the gap (the
 * capture wave ended 1 Jul, the next signup was 20 Jul), so the exact hour is
 * inconsequential for existing data and honest for anything backfilled later.
 */
export const PHONE_VERIFICATION_STAMP_EPOCH = new Date('2026-07-10T00:00:00Z');

/**
 * Tri-state verification evidence — 'verified' | 'unrecorded' | 'unverified'.
 *
 * The boolean `phoneVerificationIsCurrent` conflates "we know this phone was
 * NOT verified" with "we never wrote down whether it was", and every surface
 * that rendered it told operators the first when the truth was the second.
 * Anything reporting verification TO A HUMAN must use this; anything gating
 * reward value must keep using the strict boolean (absent proof is still
 * absent proof — see entitlementService's anti-farming precondition).
 */
export function phoneVerificationEvidence(prospect) {
  if (phoneVerificationIsCurrent(prospect)) return 'verified';
  // A stamp that exists but no longer binds to the current number is a REAL
  // signal (staff edited the phone after verification) — never soften it.
  if (prospect?.sourceMetadata?.phoneVerifiedAt) return 'unverified';
  const createdAt = prospect?.createdAt ? new Date(prospect.createdAt) : null;
  if (createdAt && !Number.isNaN(createdAt.getTime()) && createdAt < PHONE_VERIFICATION_STAMP_EPOCH) {
    return 'unrecorded';
  }
  return 'unverified';
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
        // Self-join reads the PRE-update row so RETURNING can surface the old
        // owner — both sides of a relink go enrichment-dirty (plan §6.3).
        const [moved] = await d.sequelize.query(
          `UPDATE prospects p SET "consumerId" = c.id
             FROM consumers c, prospects oldp
            WHERE c.phone = :phone AND p.phone = :phone
              AND oldp.id = p.id
              AND p."leadSource" <> 'call_bot'
              AND p."consumerId" IS DISTINCT FROM c.id
          RETURNING oldp."consumerId" AS old_cid, c.id AS new_cid`,
          { replacements: { phone }, transaction }
        );
        if (moved?.length) {
          await bumpManyEnrichmentInputsTx(
            transaction,
            moved.flatMap((r) => [r.old_cid, r.new_cid])
          );
        }
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
        // Self-join surfaces the pre-update owner: relinks dirty BOTH sides'
        // enrichment inputs (plan §6.3 — a moved signup changes two people).
        const [movedRows, meta] = await d.sequelize.query(
          `UPDATE prospects AS p SET "consumerId" = v.cid
             FROM (VALUES ${values}) AS v(pid, cid), prospects AS oldp
            WHERE p.id = v.pid AND oldp.id = p.id
              AND p."consumerId" IS DISTINCT FROM v.cid
          RETURNING oldp."consumerId" AS old_cid, v.cid AS new_cid`,
          { replacements: repl, transaction: t }
        );
        stats.prospectsLinked += meta?.rowCount ?? 0;
        if (movedRows?.length) {
          await bumpManyEnrichmentInputsTx(t, movedRows.flatMap((r) => [r.old_cid, r.new_cid]));
        }
      }

      const [cbMoved, cbMeta] = await d.sequelize.query(
        `UPDATE prospects p SET "consumerId" = NULL
           FROM prospects oldp
          WHERE oldp.id = p.id
            AND p."leadSource" = 'call_bot' AND p."consumerId" IS NOT NULL
        RETURNING p.id AS pid, oldp."consumerId" AS old_cid`,
        { transaction: t }
      );
      stats.callBotUnlinked = cbMeta?.rowCount ?? 0;
      if (cbMoved?.length) {
        await bumpManyEnrichmentInputsTx(t, cbMoved.map((r) => r.old_cid));
        // The unlinked lead itself must be dirtied BY ID: it now has no
        // consumerId, so the consumer-keyed dirtying inside the bump above
        // cannot reach it — and losing the person is exactly the kind of
        // change that moves its score (every person-wide capability term
        // vanishes with the link).
        await markLeadsDirtyTx(t, cbMoved.map((r) => r.pid));
      }

      // A phone cleared to null/empty (PUT-to-blank) takes its link with it
      // (Codex R2 #4). Invalid-but-present phones are NOT touched: those are
      // capture-linked raw-format rows (Meta) whose links are healed above.
      const [epMoved, epMeta] = await d.sequelize.query(
        `UPDATE prospects p SET "consumerId" = NULL
           FROM prospects oldp
          WHERE oldp.id = p.id
            AND p."consumerId" IS NOT NULL AND (p.phone IS NULL OR p.phone = '')
        RETURNING p.id AS pid, oldp."consumerId" AS old_cid`,
        { transaction: t }
      );
      stats.emptyPhoneUnlinked = epMeta?.rowCount ?? 0;
      if (epMoved?.length) {
        await bumpManyEnrichmentInputsTx(t, epMoved.map((r) => r.old_cid));
        await markLeadsDirtyTx(t, epMoved.map((r) => r.pid));
      }

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
   *
   * `includeRaw` (Lead Profile page only): attaches the raw signup rows as
   * `_rawSignups` for leadProfileService.enrichJourneyProfile, which consumes
   * and strips them — the underscore key never reaches a response. Without it
   * the payload is byte-identical to before the option existed.
   */
  async function getConsumerJourney(consumerId, { includeRaw = false } = {}) {
    const consumer = await d.Consumer.findByPk(consumerId);
    if (!consumer) return null;

    const [signups, entitlements] = await Promise.all([
      d.Prospect.findAll({
        where: { consumerId },
        attributes: [
          'id', 'firstName', 'lastName', 'phone', 'campaignId', 'leadStatus', 'leadSource',
          'createdAt', 'conversionDate', 'quarantinedAt', 'quarantineReason', 'sourceMetadata',
          'externalAgentId',
          // consentMetadata carries the pinned draw-terms acceptance the draw
          // eligibility preview reads — profile mode only.
          ...(includeRaw ? ['consentMetadata'] : []),
        ],
        include: [
          { association: 'campaign', attributes: ['id', 'name', 'status'] },
          // Per-signup routing for the Lead Profile page (design handoff: the
          // campaign row's AGENT segment + the assign menu's sub-line).
          { association: 'assignedAgent', attributes: ['id', 'firstName', 'lastName'] },
        ],
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

    const result = {
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
        // Tri-state companion to `verified` — lets the console distinguish "we
        // know it wasn't verified" from "this signup predates the stamp".
        verificationEvidence: phoneVerificationEvidence(s),
        agentName: s.assignedAgent
          ? `${s.assignedAgent.firstName || ''} ${s.assignedAgent.lastName || ''}`.trim() || null
          : null,
        externalBuyer: Boolean(s.externalAgentId),
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
    if (includeRaw) result._rawSignups = signups;
    return result;
  }

  /**
   * The People directory page (admin-people-directory §4.1). Membership is
   * ROW EXISTENCE — a consumer is listed iff a prospect links to it — never
   * the signupCount counter (invariant 3: counters are a best-effort
   * projection whose recompute failures are swallowed; rows are the truth).
   * The page query's inner JOIN LATERAL enforces existence AND yields
   * latestProspectId in one pass; the count query states it as EXISTS.
   *
   * Erased consumers pass the filter while their prospect skeletons remain,
   * but never match a search — their identity columns are all null, which is
   * the PDPA-correct asymmetry (browsable, not look-up-able).
   */
  async function listConsumers({ q = '', page = 1, limit = 25, sort = '-lastSeenAt' } = {}) {
    // Strict positive int: parseInt would accept '2junk'/'2.5'/'1e2' (R2 #7).
    const posInt = (v, fallback, min, max) => {
      const s = String(v ?? '');
      if (!/^\d+$/.test(s)) return fallback;
      const n = Number(s);
      if (!Number.isSafeInteger(n)) return fallback;
      return Math.min(max, Math.max(min, n));
    };
    const lim = posInt(limit, 25, 1, 100);
    const pg = posInt(page, 1, 1, 10_000);

    const SORTS = {
      '-lastSeenAt': 'c."lastSeenAt" DESC',
      lastSeenAt: 'c."lastSeenAt" ASC',
      '-signupCount': 'c."signupCount" DESC',
      signupCount: 'c."signupCount" ASC',
      '-firstSeenAt': 'c."firstSeenAt" DESC',
      firstSeenAt: 'c."firstSeenAt" ASC',
      // NULLS LAST both directions: DESC defaults to NULLS FIRST, which would
      // float erased (all-null-name) rows to the top (R1 #13).
      name: 'c."lastName" ASC NULLS LAST, c."firstName" ASC NULLS LAST',
      '-name': 'c."lastName" DESC NULLS LAST, c."firstName" DESC NULLS LAST',
      // MEET × BUY (consumer-profile-enrichment §8). NULLS LAST in BOTH
      // directions for the same reason as name: an unscoreable person renders
      // "—" and must never lead a score-ordered page — ascending by Buy should
      // surface the lowest real score, not the 129 people we can't score.
      '-meetScore': 'cp."meetScore" DESC NULLS LAST',
      meetScore: 'cp."meetScore" ASC NULLS LAST',
      '-buyScore': 'cp."buyScore" DESC NULLS LAST',
      buyScore: 'cp."buyScore" ASC NULLS LAST',
      '-consumerScore': 'cp."consumerScore" DESC NULLS LAST',
      consumerScore: 'cp."consumerScore" ASC NULLS LAST',
    };
    const orderBy = SORTS[sort] || SORTS['-lastSeenAt'];

    const like = escapeLike(q);
    const digits = String(q ?? '').replace(/\D/g, '');
    const parts = [];
    if (like) {
      parts.push(
        `c."firstName" ILIKE :like ESCAPE '\\'`,
        `c."lastName" ILIKE :like ESCAPE '\\'`,
        `concat_ws(' ', c."firstName", c."lastName") ILIKE :like ESCAPE '\\'`,
        `c.email ILIKE :like ESCAPE '\\'`
      );
    }
    if (digits.length >= 4) parts.push('c.phone LIKE :digitsLike');
    const qClause = parts.length ? `AND (${parts.join(' OR ')})` : '';
    const replacements = { like: `%${like}%`, digitsLike: `%${digits}%` };

    // REPEATABLE READ so total and rows come from ONE snapshot — the
    // connection sets no default isolation and READ COMMITTED re-snapshots
    // per statement (R2 #1). Read-only, so no serialization retries needed.
    return d.sequelize.transaction(
      { isolationLevel: Transaction.ISOLATION_LEVELS.REPEATABLE_READ },
      async (t) => {
        const [countRows] = await d.sequelize.query(
          `SELECT count(*)::int AS total FROM consumers c
            WHERE EXISTS (SELECT 1 FROM prospects p WHERE p."consumerId" = c.id)
            ${qClause}`,
          { replacements, transaction: t }
        );
        const [rows] = await d.sequelize.query(
          // LEFT JOIN, never INNER: a person with no profile row (never swept,
          // or scoring has never been enabled) must still be listed — the
          // People directory is the person index, not the scored index.
          // scoredConfigVersion distinguishes "scored, unscoreable ⇒ —" from
          // "never scored", which the column renders identically but the
          // profile page does not.
          `SELECT c.id, c."firstName", c."lastName", c.email, c.phone,
                  c."signupCount", c."verifiedSignupCount",
                  c."firstSeenAt", c."lastSeenAt", c."erasedAt",
                  lp.id AS "latestProspectId",
                  cp."meetScore", cp."buyScore", cp."consumerScore",
                  cp."scoredConfigVersion"
             FROM consumers c
             JOIN LATERAL (
               SELECT p.id FROM prospects p
                WHERE p."consumerId" = c.id
                ORDER BY p."createdAt" DESC, p.id DESC
                LIMIT 1
             ) lp ON true
             LEFT JOIN consumer_profiles cp ON cp."consumerId" = c.id
            WHERE true ${qClause}
            ORDER BY ${orderBy}, c.id DESC
            LIMIT :limit OFFSET :offset`,
          {
            replacements: { ...replacements, limit: lim, offset: (pg - 1) * lim },
            transaction: t,
          }
        );
        return { total: countRows?.[0]?.total ?? 0, page: pg, limit: lim, rows };
      }
    );
  }

  return {
    resolveConsumerForCaptureTx,
    recomputeConsumersByPhone,
    reconcileConsumerSpine,
    getConsumerJourney,
    listConsumers,
  };
}

const _default = makeConsumerService();
export const resolveConsumerForCaptureTx = _default.resolveConsumerForCaptureTx;
export const recomputeConsumersByPhone = _default.recomputeConsumersByPhone;
export const reconcileConsumerSpine = _default.reconcileConsumerSpine;
export const getConsumerJourney = _default.getConsumerJourney;
export const listConsumers = _default.listConsumers;
