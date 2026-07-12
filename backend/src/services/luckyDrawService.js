import crypto from 'crypto';
import { Op } from 'sequelize';
import {
  Draw, DrawEntry, DrawAttempt, DrawBoostReview,
  Campaign, Prospect, Activation, RewardEntitlement, RedemptionEvent,
  sequelize,
} from '../models/index.js';
import { AppError } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';
import { sgtDayEndExclusiveMs } from '../utils/sgtTime.js';

/**
 * Lucky-draw lifecycle (docs/plans/lucky-draw-10x.md §4.2–§4.3).
 *
 *   create → freeze (1× pool snapshot at closesAt) → [review agent_button
 *   boosts] → seal (chances + poolHash committed) → draw (witnessed seeded
 *   pick; redraws = further attempts) → published / claimed; void anywhere
 *   before published.
 *
 * Fairness spine:
 *  - Every transition is a CONDITIONAL UPDATE (`WHERE status = <from>`), so
 *    concurrent/replayed operations lose cleanly instead of double-running.
 *  - The pool is committed (poolHash) at seal, BEFORE any seed exists; the
 *    seed is minted at the witnessed pick (commit/reveal — the winner is not
 *    predictable before the witnessed moment).
 *  - The pick is a pure function of (seed, ordered eligible entries) — see
 *    pickWinner(). Each attempt stores seed + totalChances + eligibleHash, so
 *    verifyDraw() re-derives every pick and DETECTS post-hoc changes.
 *  - ×N evidence is the append-only redemption_events 'unlocked' row (a later
 *    entitlement cancellation can't erase an earned boost), scoped to the
 *    draw's designated activation, excluding manual issuance
 *    (issuedVia='manual' fabricates the OTP stamp), inside boostClosesAt.
 *    agent_scan boosts automatically; agent_button requires an approved
 *    DrawBoostReview (§8.1).
 */

const CLAIM_WINDOW_DAYS = 14; // the public /winners promise
const ATTEMPT_REASONS = new Set(['initial', 'unclaimed', 'unreachable', 'ineligible', 'declined']);
const OUTCOMES = new Set(['claimed', 'unclaimed', 'unreachable', 'ineligible', 'declined']);

function sha256Hex(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

/** "Sarah Tan" → "Sarah T." — pre-masked display identity, safe to publish. */
function maskName(firstName, lastName) {
  const first = (firstName || '').trim();
  const lastInitial = (lastName || '').trim().charAt(0);
  return [first, lastInitial ? `${lastInitial.toUpperCase()}.` : ''].filter(Boolean).join(' ') || 'Entrant';
}

function maskPhoneLast4(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.slice(-4) || null;
}

/**
 * Canonical pool commitment: sha256 over the ordered entry tuples. Includes
 * every outcome-affecting field (weights, identity hash, boost evidence), so
 * the hash pins the WEIGHTED pool, not just membership.
 */
export function computePoolHash(entries) {
  const lines = [...entries]
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
    .map((e) => `${e.id}|${e.prospectId || ''}|${e.phoneHash}|${e.chances}|${e.boostVia || ''}`);
  return sha256Hex(lines.join('\n'));
}

/** Commitment to the exact eligible set an attempt's seed was applied to. */
export function computeEligibleHash(eligibleEntries) {
  const lines = eligibleEntries.map((e) => `${e.id}|${e.chances}`);
  return sha256Hex(lines.join('\n'));
}

/**
 * Deterministic weighted pick: entries ordered by id ASC, expanded by
 * `chances`; winner index = sha256(seed) as a 256-bit integer mod
 * totalChances. Modulo bias is ≤ totalChances/2^256 — immeasurably small for
 * any real pool — accepted in exchange for a pick anyone can re-derive with
 * one hash. Returns the winning entry.
 */
export function pickWinner(seedHex, eligibleEntries) {
  const total = eligibleEntries.reduce((n, e) => n + e.chances, 0);
  if (total <= 0) throw new AppError('No eligible entries to draw from', 409);
  const value = BigInt(`0x${sha256Hex(seedHex)}`) % BigInt(total);
  let cumulative = 0n;
  for (const entry of eligibleEntries) {
    cumulative += BigInt(entry.chances);
    if (value < cumulative) return entry;
  }
  // Unreachable: value < total by construction.
  throw new AppError('Pick walked past the pool — invariant broken', 500);
}

/** Entries ordered by id ASC — the ONE canonical order every hash/pick uses. */
function orderedEntries(entries) {
  return [...entries].sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

export function makeLuckyDrawService(overrides = {}) {
  const d = {
    Draw, DrawEntry, DrawAttempt, DrawBoostReview,
    Campaign, Prospect, Activation, RewardEntitlement, RedemptionEvent,
    sequelize, logger,
    now: () => new Date(),
    mintSeed: () => crypto.randomBytes(32).toString('hex'),
    ...overrides,
  };

  /** Conditional status transition — the concurrency guard for every step. */
  async function transition(drawId, from, to, extra = {}, t = null) {
    const [count] = await d.Draw.update(
      { status: to, ...extra },
      { where: { id: drawId, status: from }, ...(t ? { transaction: t } : {}) }
    );
    if (count === 0) {
      throw new AppError(`Draw is not in '${from}' state (concurrent change?)`, 409);
    }
  }

  async function getDrawOr404(drawId) {
    const draw = await d.Draw.findByPk(drawId);
    if (!draw) throw new AppError('Draw not found', 404);
    return draw;
  }

  /**
   * Create the draw row from the campaign's luckyDraw config. Dates become
   * fixed UTC instants HERE (SGT end-of-day exclusive) — later steps compare
   * against the stored instants, never against config or wall-clock choices.
   */
  async function createDraw({ campaignId }, user) {
    const campaign = await d.Campaign.findByPk(campaignId);
    if (!campaign) throw new AppError('Campaign not found', 404);
    const ld = campaign.design_config?.luckyDraw;
    if (ld?.enabled !== true) {
      throw new AppError('Campaign has no enabled luckyDraw config (designer → luckyDraw)', 422);
    }
    const closesAtMs = ld.closesAt ? sgtDayEndExclusiveMs(ld.closesAt) : null;
    if (closesAtMs === null) {
      throw new AppError('luckyDraw.closesAt (YYYY-MM-DD) is required to create a draw', 422);
    }
    const boostClosesAtMs = ld.boostClosesAt ? sgtDayEndExclusiveMs(ld.boostClosesAt) : null;
    if (boostClosesAtMs !== null && boostClosesAtMs < closesAtMs) {
      throw new AppError('boostClosesAt must not be before closesAt', 422);
    }

    let activationId = null;
    if (ld.activationId) {
      const activation = await d.Activation.findByPk(ld.activationId);
      if (!activation || String(activation.campaignId) !== String(campaignId)) {
        throw new AppError('luckyDraw.activationId does not belong to this campaign', 422);
      }
      activationId = activation.id;
    }

    try {
      const draw = await d.Draw.create({
        campaignId,
        activationId,
        termsVersionId: ld.termsVersionId || null,
        closesAt: new Date(closesAtMs),
        boostClosesAt: boostClosesAtMs !== null ? new Date(boostClosesAtMs) : null,
        multiplier: ld.multiplier || 10,
        status: 'open',
        createdBy: user.id,
      });
      return draw;
    } catch (err) {
      // uq_draws_live_campaign: one live draw per campaign.
      if (err?.name === 'SequelizeUniqueConstraintError' || /uq_draws_live_campaign/.test(err?.message || '')) {
        throw new AppError('This campaign already has a live draw', 409);
      }
      throw err;
    }
  }

  /**
   * Freeze the 1× pool. Runs any time AT/after closesAt; re-applies the
   * stored cutoff itself (`createdAt <= closesAt`), so a late freeze admits
   * nothing extra. Pool predicate (docs/plans/lucky-draw-10x.md §4.2): phone
   * present, verification stamp present AND bound to the CURRENT phone
   * (phoneVerifiedFor = sha256(phone) — a post-entry staff phone edit breaks
   * the bind), created inside the window. Quarantined prospects stay in
   * (quarantine restricts delivery, not entry validity).
   */
  async function freezeDraw(drawId, user) {
    const draw = await getDrawOr404(drawId);
    if (draw.status !== 'open') throw new AppError(`Draw is ${draw.status}, expected open`, 409);
    const now = d.now();
    if (now.getTime() < new Date(draw.closesAt).getTime()) {
      throw new AppError(`Entries close at ${new Date(draw.closesAt).toISOString()} — freeze after that`, 409);
    }

    const prospects = await d.Prospect.findAll({
      where: {
        campaignId: draw.campaignId,
        phone: { [Op.ne]: null },
        createdAt: { [Op.lte]: draw.closesAt },
      },
      attributes: ['id', 'firstName', 'lastName', 'phone', 'sourceMetadata', 'createdAt'],
    });

    const eligible = prospects.filter((p) => {
      const sm = p.sourceMetadata || {};
      return (
        typeof sm.phoneVerifiedAt === 'string' &&
        typeof sm.phoneVerifiedFor === 'string' &&
        sm.phoneVerifiedFor === sha256Hex(p.phone)
      );
    });

    const rows = eligible.map((p) => ({
      drawId: draw.id,
      prospectId: p.id,
      phoneHash: sha256Hex(p.phone),
      phoneLast4: maskPhoneLast4(p.phone),
      displayName: maskName(p.firstName, p.lastName),
      chances: 1,
      verifiedAtFreeze: new Date(p.sourceMetadata.phoneVerifiedAt),
    }));

    await d.sequelize.transaction(async (t) => {
      await transition(draw.id, 'open', 'frozen', {}, t);
      if (rows.length > 0) await d.DrawEntry.bulkCreate(rows, { transaction: t });
    });

    d.logger.info('lucky_draw.frozen', {
      drawId: draw.id, campaignId: draw.campaignId,
      candidates: prospects.length, entries: rows.length,
    });
    return { drawId: draw.id, candidates: prospects.length, entries: rows.length };
  }

  /**
   * The boost evidence for a draw: append-only 'unlocked' events on the
   * designated activation, non-manual issuance, inside boostClosesAt, for
   * prospects that hold a frozen entry. Two-step query (no association
   * dependency). Returns { byProspect, buttonEventsNeedingReview }.
   */
  async function collectBoostEvidence(draw, entries) {
    if (!draw.activationId) return { byProspect: new Map(), undecidedButtons: [] };
    const prospectIds = entries.map((e) => e.prospectId).filter(Boolean);
    if (prospectIds.length === 0) return { byProspect: new Map(), undecidedButtons: [] };

    const entitlements = await d.RewardEntitlement.findAll({
      where: {
        activationId: draw.activationId,
        prospectId: { [Op.in]: prospectIds },
        issuedVia: { [Op.ne]: 'manual' },
      },
      attributes: ['id', 'prospectId', 'issuedVia'],
    });
    if (entitlements.length === 0) return { byProspect: new Map(), undecidedButtons: [] };
    const entitlementById = new Map(entitlements.map((e) => [String(e.id), e]));

    const cutoff = draw.boostClosesAt || d.now();
    const events = await d.RedemptionEvent.findAll({
      where: {
        entitlementId: { [Op.in]: entitlements.map((e) => e.id) },
        type: 'unlocked',
        createdAt: { [Op.lte]: cutoff },
      },
      attributes: ['id', 'entitlementId', 'metadata', 'createdAt'],
      order: [['createdAt', 'ASC']],
    });

    const reviews = await d.DrawBoostReview.findAll({
      where: { drawId: draw.id },
      attributes: ['entitlementId', 'decision'],
    });
    const reviewByEntitlement = new Map(reviews.map((r) => [String(r.entitlementId), r.decision]));

    const byProspect = new Map(); // prospectId -> { via, eventId }
    const undecidedButtons = [];
    for (const ev of events) {
      const ent = entitlementById.get(String(ev.entitlementId));
      if (!ent) continue;
      const via = ev.metadata?.via === 'agent_button' ? 'agent_button' : 'agent_scan';
      const key = String(ent.prospectId);
      if (via === 'agent_scan') {
        // Scan is the strongest evidence — always wins for the prospect.
        byProspect.set(key, { via, eventId: ev.id });
      } else {
        const decision = reviewByEntitlement.get(String(ev.entitlementId));
        if (decision === 'approved') {
          if (!byProspect.has(key)) byProspect.set(key, { via, eventId: ev.id });
        } else if (decision !== 'rejected') {
          undecidedButtons.push({ entitlementId: ent.id, prospectId: ent.prospectId, eventId: ev.id });
        }
        // rejected → no boost, no block.
      }
    }
    return { byProspect, undecidedButtons };
  }

  /** Virtual (agent_button) unlocks awaiting a boost decision for this draw. */
  async function listPendingBoostReviews(drawId) {
    const draw = await getDrawOr404(drawId);
    const entries = await d.DrawEntry.findAll({ where: { drawId: draw.id } });
    const { undecidedButtons } = await collectBoostEvidence(draw, entries);
    return undecidedButtons;
  }

  /** Approve/reject one agent_button unlock for ×N weighting (voucher untouched). */
  async function reviewBoost({ drawId, entitlementId, decision, reason }, user) {
    if (!['approved', 'rejected'].includes(decision)) {
      throw new AppError("decision must be 'approved' or 'rejected'", 422);
    }
    const draw = await getDrawOr404(drawId);
    if (!['open', 'frozen'].includes(draw.status)) {
      throw new AppError(`Draw is ${draw.status} — boost reviews close at seal`, 409);
    }
    const entitlement = await d.RewardEntitlement.findByPk(entitlementId);
    if (!entitlement) throw new AppError('Entitlement not found', 404);
    try {
      return await d.DrawBoostReview.create({
        drawId: draw.id,
        entitlementId,
        prospectId: entitlement.prospectId || null,
        decision,
        reviewedByUserId: user.id,
        reason: reason || null,
      });
    } catch (err) {
      if (err?.name === 'SequelizeUniqueConstraintError' || /uq_dbr_draw_entitlement/.test(err?.message || '')) {
        throw new AppError('This unlock has already been reviewed for this draw', 409);
      }
      throw err;
    }
  }

  /**
   * Seal: write chances + boost evidence onto the frozen entries and commit
   * poolHash. Refuses while any agent_button unlock is undecided (the review
   * step cannot be silently skipped) and never runs before boostClosesAt.
   */
  async function sealDraw(drawId, user) {
    const draw = await getDrawOr404(drawId);
    if (draw.status !== 'frozen') throw new AppError(`Draw is ${draw.status}, expected frozen`, 409);
    const now = d.now();
    if (draw.boostClosesAt && now.getTime() < new Date(draw.boostClosesAt).getTime()) {
      throw new AppError(`Boost window closes at ${new Date(draw.boostClosesAt).toISOString()} — seal after that`, 409);
    }

    const entries = await d.DrawEntry.findAll({ where: { drawId: draw.id } });
    if (entries.length === 0) throw new AppError('Draw has no entries — nothing to seal', 409);

    const { byProspect, undecidedButtons } = await collectBoostEvidence(draw, entries);
    if (undecidedButtons.length > 0) {
      const err = new AppError(
        `${undecidedButtons.length} virtual (agent_button) unlock(s) await boost review — approve/reject them first`,
        409
      );
      err.data = { undecided: undecidedButtons };
      throw err;
    }

    const boosted = [];
    for (const entry of entries) {
      const boost = entry.prospectId ? byProspect.get(String(entry.prospectId)) : null;
      if (boost) {
        entry.chances = draw.multiplier;
        entry.boostVia = boost.via;
        entry.boostEventId = boost.eventId;
        boosted.push(entry);
      }
    }
    const poolHash = computePoolHash(entries);

    await d.sequelize.transaction(async (t) => {
      for (const entry of boosted) {
        await d.DrawEntry.update(
          { chances: entry.chances, boostVia: entry.boostVia, boostEventId: entry.boostEventId },
          { where: { id: entry.id }, transaction: t }
        );
      }
      await transition(draw.id, 'frozen', 'sealed', { poolHash }, t);
    });

    const totalChances = entries.reduce((n, e) => n + e.chances, 0);
    d.logger.info('lucky_draw.sealed', {
      drawId: draw.id, entries: entries.length, boosted: boosted.length, totalChances, poolHash,
    });
    return { drawId: draw.id, entries: entries.length, boosted: boosted.length, totalChances, poolHash };
  }

  /**
   * The witnessed pick. Eligible = entries minus ALL previously picked minus
   * erased entrants (prospectId NULL). The seed is minted NOW (commit/reveal:
   * poolHash predates it), recorded with totalChances + eligibleHash so the
   * pick is re-derivable forever. Redraws pass `reason` = the prior attempt's
   * failure mode and require that attempt to be closed out first.
   */
  async function runDrawAttempt(drawId, { witnessUserId = null, reason = 'initial' } = {}, user) {
    if (!ATTEMPT_REASONS.has(reason)) {
      throw new AppError(`reason must be one of: ${[...ATTEMPT_REASONS].join(', ')}`, 422);
    }
    const draw = await getDrawOr404(drawId);
    if (!['sealed', 'drawn'].includes(draw.status)) {
      throw new AppError(`Draw is ${draw.status}, expected sealed (or drawn, for a redraw)`, 409);
    }

    const priorAttempts = await d.DrawAttempt.findAll({
      where: { drawId: draw.id },
      order: [['attemptNo', 'ASC']],
    });
    const pending = priorAttempts.find((a) => a.outcome === 'pending');
    if (pending) {
      throw new AppError(`Attempt ${pending.attemptNo} is still pending — record its outcome before redrawing`, 409);
    }
    if (priorAttempts.some((a) => a.outcome === 'claimed')) {
      throw new AppError('This draw already has a claimed winner', 409);
    }
    if (priorAttempts.length > 0 && reason === 'initial') {
      throw new AppError("A redraw needs its reason (the prior attempt's outcome), not 'initial'", 422);
    }

    const pickedBefore = new Set(priorAttempts.map((a) => String(a.pickedEntryId)));
    const allEntries = await d.DrawEntry.findAll({ where: { drawId: draw.id } });
    const eligible = orderedEntries(allEntries).filter(
      (e) => e.prospectId != null && !pickedBefore.has(String(e.id))
    );
    if (eligible.length === 0) throw new AppError('No eligible entries left to draw from', 409);

    const totalChances = eligible.reduce((n, e) => n + e.chances, 0);
    const eligibleHash = computeEligibleHash(eligible);
    const seed = d.mintSeed();
    const picked = pickWinner(seed, eligible);
    const drawnAt = d.now();

    let attempt;
    await d.sequelize.transaction(async (t) => {
      attempt = await d.DrawAttempt.create(
        {
          drawId: draw.id,
          attemptNo: priorAttempts.length + 1,
          seed,
          totalChances,
          eligibleHash,
          pickedEntryId: picked.id,
          reason,
          drawnAt,
          witnessedByUserId: witnessUserId,
          claimDeadline: new Date(drawnAt.getTime() + CLAIM_WINDOW_DAYS * 24 * 3600 * 1000),
          outcome: 'pending',
        },
        { transaction: t }
      );
      if (draw.status === 'sealed') {
        await transition(draw.id, 'sealed', 'drawn', { witnessedByUserId: witnessUserId }, t);
      }
    });

    d.logger.info('lucky_draw.drawn', {
      drawId: draw.id, attemptNo: attempt.attemptNo, totalChances,
      pickedEntryId: picked.id, displayName: picked.displayName, phoneLast4: picked.phoneLast4,
    });
    return {
      attempt,
      picked: {
        entryId: picked.id,
        prospectId: picked.prospectId,
        displayName: picked.displayName,
        phoneLast4: picked.phoneLast4,
        chances: picked.chances,
        boostVia: picked.boostVia || null,
      },
    };
  }

  /** Close out an attempt: claimed | unclaimed | unreachable | ineligible | declined. */
  async function recordAttemptOutcome(attemptId, { outcome, contactedAt = null, claimedAt = null } = {}, user) {
    if (!OUTCOMES.has(outcome)) {
      throw new AppError(`outcome must be one of: ${[...OUTCOMES].join(', ')}`, 422);
    }
    const attempt = await d.DrawAttempt.findByPk(attemptId);
    if (!attempt) throw new AppError('Attempt not found', 404);

    const [count] = await d.DrawAttempt.update(
      {
        outcome,
        ...(contactedAt ? { contactedAt } : {}),
        ...(outcome === 'claimed' ? { claimedAt: claimedAt || d.now() } : {}),
      },
      { where: { id: attemptId, outcome: 'pending' } }
    );
    if (count === 0) throw new AppError(`Attempt already has outcome '${attempt.outcome}'`, 409);

    if (outcome === 'claimed') {
      await d.Draw.update(
        { status: 'claimed' },
        { where: { id: attempt.drawId, status: { [Op.in]: ['drawn', 'published'] } } }
      );
    }
    return d.DrawAttempt.findByPk(attemptId);
  }

  /**
   * Mark published AFTER the winners-wall deploy is verified live
   * (redeemWinnersContent.js edit + deploy + hash-flip check — CLAUDE.md).
   */
  async function markPublished(drawId, user) {
    const draw = await getDrawOr404(drawId);
    if (!['drawn', 'claimed'].includes(draw.status)) {
      throw new AppError(`Draw is ${draw.status}, expected drawn or claimed`, 409);
    }
    await transition(draw.id, draw.status, draw.status === 'claimed' ? 'claimed' : 'published');
    // A claimed draw stays 'claimed' (terminal-est state); publishing is
    // recorded in notes for that case.
    if (draw.status === 'claimed') {
      await d.Draw.update(
        { notes: `${draw.notes ? `${draw.notes}\n` : ''}Published ${d.now().toISOString()}` },
        { where: { id: draw.id } }
      );
    }
    return getDrawOr404(drawId);
  }

  /** Cancel a not-yet-published draw. Reason is mandatory and recorded. */
  async function voidDraw(drawId, reason, user) {
    if (!reason || !String(reason).trim()) throw new AppError('A reason is required to void a draw', 422);
    const draw = await getDrawOr404(drawId);
    if (['published', 'claimed'].includes(draw.status)) {
      throw new AppError('A published/claimed draw cannot be voided', 409);
    }
    await d.Draw.update(
      {
        status: 'void',
        notes: `${draw.notes ? `${draw.notes}\n` : ''}VOID (${d.now().toISOString()}, by ${user?.id || 'unknown'}): ${reason}`,
      },
      { where: { id: draw.id, status: draw.status } }
    );
    return getDrawOr404(drawId);
  }

  /**
   * Independent re-derivation of everything the fairness story rests on:
   * poolHash from the stored entries, and every attempt's pick from its seed
   * over its committed eligible set. Any mismatch (tamper, post-hoc erasure)
   * is reported, never absorbed.
   */
  async function verifyDraw(drawId) {
    const draw = await getDrawOr404(drawId);
    const entries = await d.DrawEntry.findAll({ where: { drawId: draw.id } });
    const attempts = await d.DrawAttempt.findAll({ where: { drawId: draw.id }, order: [['attemptNo', 'ASC']] });

    const report = { drawId: draw.id, status: draw.status, ok: true, checks: [] };

    if (draw.poolHash) {
      const recomputed = computePoolHash(entries);
      const ok = recomputed === draw.poolHash;
      report.checks.push({ check: 'poolHash', ok, expected: draw.poolHash, recomputed });
      if (!ok) report.ok = false;
    }

    const pickedBefore = new Set();
    for (const attempt of attempts) {
      const eligible = orderedEntries(entries).filter(
        (e) => e.prospectId != null && !pickedBefore.has(String(e.id))
      );
      const eligibleHash = computeEligibleHash(eligible);
      if (eligibleHash !== attempt.eligibleHash) {
        // The set changed since the pick (e.g. an erasure) — the committed
        // hash still proves what the seed was applied to; flag, don't guess.
        report.checks.push({
          check: `attempt#${attempt.attemptNo}.eligibleSet`, ok: false,
          note: 'eligible set differs from the committed one (post-attempt erasure?) — pick verified against stored commitment only',
        });
        report.ok = false;
      } else {
        const picked = pickWinner(attempt.seed, eligible);
        const ok = String(picked.id) === String(attempt.pickedEntryId);
        report.checks.push({ check: `attempt#${attempt.attemptNo}.pick`, ok });
        if (!ok) report.ok = false;
      }
      pickedBefore.add(String(attempt.pickedEntryId));
    }
    return report;
  }

  /** Masked full state for the CLI / future admin panel. */
  async function getDrawState(drawId) {
    const draw = await getDrawOr404(drawId);
    const entries = await d.DrawEntry.findAll({ where: { drawId: draw.id } });
    const attempts = await d.DrawAttempt.findAll({ where: { drawId: draw.id }, order: [['attemptNo', 'ASC']] });
    return {
      draw: {
        id: draw.id, campaignId: draw.campaignId, status: draw.status,
        closesAt: draw.closesAt, boostClosesAt: draw.boostClosesAt,
        multiplier: draw.multiplier, poolHash: draw.poolHash,
        activationId: draw.activationId, termsVersionId: draw.termsVersionId,
      },
      entries: {
        count: entries.length,
        totalChances: entries.reduce((n, e) => n + e.chances, 0),
        boosted: entries.filter((e) => e.boostVia).length,
        erased: entries.filter((e) => e.prospectId == null).length,
      },
      attempts: attempts.map((a) => ({
        attemptNo: a.attemptNo, reason: a.reason, outcome: a.outcome,
        drawnAt: a.drawnAt, claimDeadline: a.claimDeadline, claimedAt: a.claimedAt,
        pickedEntryId: a.pickedEntryId, seed: a.seed,
      })),
    };
  }

  return {
    createDraw, freezeDraw, listPendingBoostReviews, reviewBoost, sealDraw,
    runDrawAttempt, recordAttemptOutcome, markPublished, voidDraw,
    verifyDraw, getDrawState,
  };
}
