import crypto from 'crypto';
import { Op } from 'sequelize';
import {
  Draw, DrawEntry, DrawAttempt, DrawBoostReview,
  Campaign, Prospect, Activation, RewardEntitlement, RedemptionEvent,
  DrawTermsVersion,
  sequelize,
} from '../models/index.js';
import { AppError } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';
import { sgtDayEndExclusiveMs } from '../utils/sgtTime.js';
import { normalizeLuckyDraw, totalPrizeQuantity } from '../utils/luckyDraw.js';
import { getSystemAgentId } from './systemAgent.js';

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
 * the hash pins the WEIGHTED pool, not just membership. prospectId is
 * deliberately EXCLUDED — it is a live pointer that goes NULL on erasure, and
 * an erasure must not read as pool tampering (Codex finding #5); identity is
 * committed via phoneHash, and erasure-at-pick-time is separately visible
 * through each attempt's eligibleHash.
 */
export function computePoolHash(entries) {
  const lines = [...entries]
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
    .map((e) => `${e.id}|${e.phoneHash}|${e.chances}|${e.boostVia || ''}`);
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

/**
 * THE pool-entry predicate, shared by freezeDraw and the admin read path
 * (getProspectDrawStatus) so the page can never disagree with the engine
 * about who a freeze would admit. Deliberately stricter than
 * phoneVerificationIsCurrent: freeze requires BOTH stamp fields present and
 * bound to the current phone (legacy unbounded stamps don't enter a draw).
 */
export function entryEligibility(prospect, validVersionIds) {
  const sm = prospect?.sourceMetadata || {};
  const verified =
    typeof sm.phoneVerifiedAt === 'string' &&
    typeof sm.phoneVerifiedFor === 'string' &&
    sm.phoneVerifiedFor === sha256Hex(String(prospect?.phone || ''));
  const dt = prospect?.consentMetadata?.drawTerms;
  const hasTerms =
    typeof dt?.termsVersionId === 'string' &&
    validVersionIds.has(dt.termsVersionId.toLowerCase());
  return { verified, hasTerms, eligible: verified && hasTerms };
}

export function makeLuckyDrawService(overrides = {}) {
  const d = {
    Draw, DrawEntry, DrawAttempt, DrawBoostReview,
    Campaign, Prospect, Activation, RewardEntitlement, RedemptionEvent,
    DrawTermsVersion,
    sequelize, logger,
    getSystemAgentId,
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
  async function createDraw({ campaignId, allowNoBoost = false }, user) {
    const campaign = await d.Campaign.findByPk(campaignId);
    if (!campaign) throw new AppError('Campaign not found', 404);
    const ld = campaign.design_config?.luckyDraw;
    if (ld?.enabled !== true) {
      throw new AppError('Campaign has no enabled luckyDraw config (designer → luckyDraw)', 422);
    }
    // Fail-closed until the multi-winner engine ships: this engine resolves
    // exactly ONE claimed winner per draw (a claimed attempt is terminal), so
    // a multi-prize config must not mint a record it cannot deliver.
    const totalPrizes = totalPrizeQuantity(normalizeLuckyDraw(ld));
    if (totalPrizes > 1) {
      const err = new AppError(
        `This draw promises ${totalPrizes} prizes, but multi-winner draw execution isn't live yet.`,
        422
      );
      err.data = { code: 'DRAW_MULTI_PRIZE_UNSUPPORTED' };
      throw err;
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
    } else {
      // Stamp-absent fallback (PR-2, old-plan F3 / Codex R1 CX6): the stamp is
      // save-fragile (any pre-provisioning editor tab can wipe it), so the
      // draw record resolves the campaign's ACTIVE rail itself — the draw row
      // is the snapshot seal reads, and it must not be born blind. A live
      // wrong-policy rail is a 422 (auto_on_capture never boosts); NO rail is
      // a 422 unless the operator explicitly runs the CLI with
      // --allow-no-boost (emergency: a 1×-only draw, every entrant equal).
      const active = await d.Activation.findOne({
        where: { campaignId, status: 'active' },
        order: [['createdAt', 'ASC']],
      });
      if (active) {
        if (active.unlockPolicy !== 'agent_unlock') {
          const err = new AppError(
            `The campaign's active activation (${active.id}) has unlockPolicy='${active.unlockPolicy}' — its issuance never counts as boost evidence. Fix the rail before creating the draw.`,
            422
          );
          err.data = { code: 'DRAW_BOOST_RAIL_CONFLICT' };
          throw err;
        }
        activationId = active.id;
      } else if (!allowNoBoost) {
        const err = new AppError(
          'No boost rail: the campaign has no luckyDraw.activationId stamp and no active activation. Launch the campaign (auto-provisions the rail) or pass --allow-no-boost to run a 1×-only draw.',
          422
        );
        err.data = { code: 'DRAW_BOOST_RAIL_MISSING' };
        throw err;
      }
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

    // The snapshot read happens INSIDE the transaction, AFTER the transition
    // claims the draw (Codex finding #2): any entrant commit that this read
    // cannot see lands after the frozen boundary and is excluded by design,
    // rather than being silently missable by a pre-transaction read.
    // createdAt < closesAt — the boundary instant is exclusive (sgtTime.js).
    let candidates = 0;
    let rows = [];
    let termsCohorts = {};
    let excludedNoConsent = 0;
    await d.sequelize.transaction(async (t) => {
      await transition(draw.id, 'open', 'frozen', {}, t);

      const prospects = await d.Prospect.findAll({
        where: {
          campaignId: draw.campaignId,
          phone: { [Op.ne]: null },
          createdAt: { [Op.lt]: draw.closesAt },
        },
        attributes: ['id', 'firstName', 'lastName', 'phone', 'sourceMetadata', 'consentMetadata', 'createdAt'],
        transaction: t,
      });
      candidates = prospects.length;

      // Draw-terms consent gate (PR-2, Codex R1 CX18): an entrant is in the
      // pool ONLY with pinned acceptance evidence of one of THIS campaign's
      // terms versions (consentMetadata.drawTerms, written by the capture
      // gate). Verified-but-consentless prospects (e.g. captured before the
      // draw was enabled) are excluded and counted — they never accepted any
      // draw terms, so they cannot be in a draw run under them.
      const versionRows = await d.DrawTermsVersion.findAll({
        where: { campaignId: draw.campaignId },
        attributes: ['id'],
        transaction: t,
      });
      const validVersionIds = new Set(versionRows.map((v) => String(v.id).toLowerCase()));

      const eligible = prospects.filter((p) => entryEligibility(p, validVersionIds).eligible);

      // Version-cohort audit (CX18): entrants may have accepted DIFFERENT
      // pinned versions (terms were corrected mid-flight). Surfaced, never
      // silently absorbed — ops decides whether a materially-different cohort
      // needs re-consent before seal.
      termsCohorts = {};
      for (const p of eligible) {
        const v = String(p.consentMetadata.drawTerms.termsVersionId).toLowerCase();
        termsCohorts[v] = (termsCohorts[v] || 0) + 1;
      }
      excludedNoConsent = prospects.filter((p) => {
        const e = entryEligibility(p, validVersionIds);
        return e.verified && !e.hasTerms;
      }).length;

      rows = eligible.map((p) => ({
        drawId: draw.id,
        prospectId: p.id,
        phoneHash: sha256Hex(p.phone),
        phoneLast4: maskPhoneLast4(p.phone),
        displayName: maskName(p.firstName, p.lastName),
        chances: 1,
        verifiedAtFreeze: new Date(p.sourceMetadata.phoneVerifiedAt),
      }));
      if (rows.length > 0) await d.DrawEntry.bulkCreate(rows, { transaction: t });
    });

    // Terms drift warning (Codex finding #7): the draw pinned a terms version
    // at create; if the campaign's live version moved since, entrants accepted
    // different terms — surface it, don't silently absorb it.
    const campaign = await d.Campaign.findByPk(draw.campaignId, { attributes: ['design_config'] });
    const liveTermsVersionId = campaign?.design_config?.luckyDraw?.termsVersionId || null;
    const termsDrift = Boolean(
      draw.termsVersionId && liveTermsVersionId && String(liveTermsVersionId) !== String(draw.termsVersionId)
    );
    if (termsDrift) {
      d.logger.warn('lucky_draw.terms_drift', {
        drawId: draw.id, pinned: draw.termsVersionId, live: liveTermsVersionId,
      });
    }

    const cohortCount = Object.keys(termsCohorts).length;
    if (excludedNoConsent > 0 || cohortCount > 1) {
      d.logger.warn('lucky_draw.terms_cohorts', {
        drawId: draw.id, excludedNoConsent, termsCohorts,
      });
    }
    d.logger.info('lucky_draw.frozen', {
      drawId: draw.id, campaignId: draw.campaignId,
      candidates, entries: rows.length, excludedNoConsent,
    });
    return { drawId: draw.id, candidates, entries: rows.length, termsDrift, termsCohorts, excludedNoConsent };
  }

  /**
   * The boost evidence for a draw: append-only 'unlocked' events on the
   * designated activation, non-manual issuance, inside boostClosesAt, for
   * prospects that hold a frozen entry. Two-step query (no association
   * dependency). Returns { byProspect, undecidedButtons }.
   *
   * via WHITELIST (Codex finding #1): ONLY `agent_scan` boosts automatically —
   * it is the token-backed evidence the routes derive server-side.
   * `agent_button` (consultant assertion) and `manual` (admin/support unlock,
   * no meeting evidence at all) both require an explicit approved review.
   * `auto_on_capture` (voucher issued without any meeting) NEVER boosts.
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

    // Exclusive boundary: an event AT the boundary instant is past the window.
    // CX17 (PR-3): a boost-less record defaults its evidence window to the
    // ENTRY cutoff — the terms template words the deadline as closesAt when
    // boostClosesAt is unset, and the old seal-time fallback silently widened
    // the window past what entrants were told.
    const cutoff = draw.boostClosesAt || draw.closesAt;
    const allEvents = await d.RedemptionEvent.findAll({
      where: {
        entitlementId: { [Op.in]: entitlements.map((e) => e.id) },
        type: { [Op.in]: ['unlocked', 'unlock_reversed'] },
        createdAt: { [Op.lt]: cutoff },
      },
      attributes: ['id', 'entitlementId', 'type', 'metadata', 'createdAt'],
      order: [['createdAt', 'ASC']],
    });
    // Undo (PR-4, Codex R1 CX23): an `unlock_reversed` event kills EXACTLY the
    // unlock it supersedes (explicit causal ref, never timestamp guessing); a
    // later genuine re-scan is a fresh unlocked event and boosts again. Undo
    // refuses at/after the cutoff and seal only runs at/after it, so every
    // reversal is inside this window by construction.
    const reversedEventIds = new Set(
      allEvents
        .filter((e) => e.type === 'unlock_reversed' && e.metadata?.supersedesEventId)
        .map((e) => String(e.metadata.supersedesEventId))
    );
    const events = allEvents.filter((e) => e.type === 'unlocked' && !reversedEventIds.has(String(e.id)));

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
      const via = ev.metadata?.via;
      const key = String(ent.prospectId);
      if (via === 'agent_scan') {
        // Token-backed scan — the strongest evidence; always wins for the prospect.
        byProspect.set(key, { via, eventId: ev.id, at: ev.createdAt });
      } else if (via === 'agent_button' || via === 'manual') {
        const decision = reviewByEntitlement.get(String(ev.entitlementId));
        if (decision === 'approved') {
          if (!byProspect.has(key)) byProspect.set(key, { via: 'agent_button', eventId: ev.id, at: ev.createdAt });
        } else if (decision !== 'rejected') {
          undecidedButtons.push({ entitlementId: ent.id, prospectId: ent.prospectId, eventId: ev.id, via });
        }
        // rejected → no boost, no block.
      }
      // Any other via (auto_on_capture, unknown) → never session evidence.
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
    // Writer-race note: unlike freeze, seal's evidence reads can stay outside
    // the transaction — seal only runs at/after boostClosesAt, so any unlock
    // event still committing NOW is out-of-window (createdAt >= boostClosesAt)
    // by construction; the conditional transition below serializes sealers.
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
    if (priorAttempts.length > 0) {
      // The redraw reason IS the prior attempt's recorded outcome — the audit
      // ledger must not be able to say "unclaimed" about a declined winner
      // (Codex finding #10).
      const prior = priorAttempts[priorAttempts.length - 1];
      if (reason !== prior.outcome) {
        throw new AppError(
          `Redraw reason must match the prior attempt's outcome ('${prior.outcome}'), got '${reason}'`,
          422
        );
      }
    } else if (reason !== 'initial') {
      throw new AppError("The first attempt's reason must be 'initial'", 422);
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

  /**
   * Close out an attempt: claimed | unclaimed | unreachable | ineligible | declined.
   * 'unclaimed' is the DEADLINE LAPSE outcome and cannot be recorded early —
   * the public promise is 14 days, and an operator must not be able to lapse a
   * winner before it (a winner who actively says no is 'declined'). A claimed
   * outcome requires the draw to still be live (drawn/published) — not void —
   * and both writes happen in one transaction (Codex finding #4).
   */
  async function recordAttemptOutcome(attemptId, { outcome, contactedAt = null, claimedAt = null } = {}, user) {
    if (!OUTCOMES.has(outcome)) {
      throw new AppError(`outcome must be one of: ${[...OUTCOMES].join(', ')}`, 422);
    }
    const attempt = await d.DrawAttempt.findByPk(attemptId);
    if (!attempt) throw new AppError('Attempt not found', 404);

    if (
      outcome === 'unclaimed' &&
      attempt.claimDeadline &&
      d.now().getTime() < new Date(attempt.claimDeadline).getTime()
    ) {
      throw new AppError(
        `The claim window runs until ${new Date(attempt.claimDeadline).toISOString()} — a winner cannot lapse early (use 'declined' if they said no)`,
        409
      );
    }

    await d.sequelize.transaction(async (t) => {
      const [count] = await d.DrawAttempt.update(
        {
          outcome,
          ...(contactedAt ? { contactedAt } : {}),
          ...(outcome === 'claimed' ? { claimedAt: claimedAt || d.now() } : {}),
        },
        { where: { id: attemptId, outcome: 'pending' }, transaction: t }
      );
      if (count === 0) throw new AppError(`Attempt already has outcome '${attempt.outcome}'`, 409);

      if (outcome === 'claimed') {
        const [drawCount] = await d.Draw.update(
          { status: 'claimed' },
          { where: { id: attempt.drawId, status: { [Op.in]: ['drawn', 'published'] } }, transaction: t }
        );
        if (drawCount === 0) {
          throw new AppError('Draw is no longer live (voided or reset?) — cannot record a claim', 409);
        }
      }
    });
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

  /**
   * Admin READ path for the Lead Profile page (docs/plans/admin-lead-profile-page.md
   * §4): per-prospect draw standing, batched across campaigns. Never writes.
   *
   * Three lifecycle branches — because freeze WRITES the pool:
   *  - open:   nothing is persisted yet; derive a PROVISIONAL preview from the
   *            live prospect via the same entryEligibility predicate freeze
   *            will apply, plus provisional boost evidence.
   *  - frozen: membership comes ONLY from the persisted DrawEntry rows (a
   *            post-freeze phone/consent edit must not make this view disagree
   *            with the actual pool); boost weighting stays provisional until
   *            seal replaces chances with the multiplier.
   *  - sealed+: stored truth — DrawEntry.chances/boostVia and the DrawAttempt
   *            redraw ledger ("Winner" is only ever the claimed attempt).
   *
   * Draw selection is deterministic: the campaign's single live draw
   * (open|frozen|sealed|drawn — uq_draws_live_campaign) if one exists, else
   * the newest terminal draw; older terminal draws return as drawHistory[].
   *
   * Bounded queries: 1 draws + ≤1 campaigns + ≤1 terms + ≤1 entries + ≤1
   * attempts + 3 per DISTINCT open/frozen draw (collectBoostEvidence) + 1
   * status re-read. Lifecycle consistency: statuses are re-read after the
   * collection pass and the whole read retries ONCE on any flip, so a
   * freeze/seal landing mid-read can't mix provisional and frozen data.
   *
   * Returns Map<prospectId(string), drawBlock|null> — null when the campaign
   * has no draw and no enabled luckyDraw config.
   */
  async function getProspectDrawStatus(prospects, { erased = false } = {}) {
    const LIVE_STATUSES = ['open', 'frozen', 'sealed', 'drawn'];
    const ENTRY_STATUSES = ['frozen', 'sealed', 'drawn', 'published', 'claimed'];
    const ATTEMPT_STATUSES = ['sealed', 'drawn', 'published', 'claimed'];

    const list = (prospects || []).filter((p) => p && p.id && p.campaignId);
    const out = new Map();
    if (list.length === 0) return out;
    const campaignIds = [...new Set(list.map((p) => String(p.campaignId)))];
    const prospectIds = list.map((p) => String(p.id));

    const collect = async () => {
      const draws = await d.Draw.findAll({
        where: { campaignId: { [Op.in]: campaignIds } },
        order: [['createdAt', 'DESC'], ['id', 'DESC']],
      });
      const byCampaign = new Map();
      for (const dr of draws) {
        const k = String(dr.campaignId);
        if (!byCampaign.has(k)) byCampaign.set(k, []);
        byCampaign.get(k).push(dr);
      }
      const selected = new Map(); // campaignId -> { draw, history[] }
      for (const [k, rows] of byCampaign) {
        const live = rows.find((r) => LIVE_STATUSES.includes(r.status));
        const chosen = live || rows[0]; // rows are newest-first
        selected.set(k, {
          draw: chosen,
          history: rows
            .filter((r) => String(r.id) !== String(chosen.id))
            .map((r) => ({ drawId: r.id, drawStatus: r.status, closesAt: r.closesAt })),
        });
      }

      // Campaigns with no draw row at all: enabled config = readiness drift.
      const configEnabled = new Set();
      const noDrawCampaigns = campaignIds.filter((k) => !selected.has(k));
      if (noDrawCampaigns.length > 0) {
        const campaigns = await d.Campaign.findAll({
          where: { id: { [Op.in]: noDrawCampaigns } },
          attributes: ['id', 'design_config'],
        });
        for (const c of campaigns) {
          if (c.design_config?.luckyDraw?.enabled === true) configEnabled.add(String(c.id));
        }
      }

      const selectedDraws = [...selected.values()].map((s) => s.draw);
      const openDraws = selectedDraws.filter((dr) => dr.status === 'open');
      const entryDraws = selectedDraws.filter((dr) => ENTRY_STATUSES.includes(dr.status));
      const attemptDraws = selectedDraws.filter((dr) => ATTEMPT_STATUSES.includes(dr.status));

      const termsByCampaign = new Map(); // campaignId -> Set(lowercased version ids)
      if (openDraws.length > 0) {
        const versionRows = await d.DrawTermsVersion.findAll({
          where: { campaignId: { [Op.in]: openDraws.map((dr) => dr.campaignId) } },
          attributes: ['id', 'campaignId'],
        });
        for (const v of versionRows) {
          const k = String(v.campaignId);
          if (!termsByCampaign.has(k)) termsByCampaign.set(k, new Set());
          termsByCampaign.get(k).add(String(v.id).toLowerCase());
        }
      }

      const entryByDrawProspect = new Map(); // `${drawId}:${prospectId}` -> entry
      if (entryDraws.length > 0) {
        const entryRows = await d.DrawEntry.findAll({
          where: {
            drawId: { [Op.in]: entryDraws.map((dr) => dr.id) },
            prospectId: { [Op.in]: prospectIds },
          },
        });
        for (const e of entryRows) {
          entryByDrawProspect.set(`${e.drawId}:${e.prospectId}`, e);
        }
      }

      const attemptsByDraw = new Map(); // drawId -> attempts ASC by attemptNo
      if (attemptDraws.length > 0) {
        const attemptRows = await d.DrawAttempt.findAll({
          where: { drawId: { [Op.in]: attemptDraws.map((dr) => dr.id) } },
          order: [['attemptNo', 'ASC']],
        });
        for (const a of attemptRows) {
          const k = String(a.drawId);
          if (!attemptsByDraw.has(k)) attemptsByDraw.set(k, []);
          attemptsByDraw.get(k).push(a);
        }
      }

      // Provisional boost evidence — open draws over the live prospects,
      // frozen draws over their FROZEN entries only (engine parity).
      const evidenceByDraw = new Map();
      for (const dr of selectedDraws) {
        if (dr.status !== 'open' && dr.status !== 'frozen') continue;
        const campProspects = list.filter((p) => String(p.campaignId) === String(dr.campaignId));
        const entryLike = dr.status === 'frozen'
          ? campProspects
            .filter((p) => entryByDrawProspect.has(`${dr.id}:${p.id}`))
            .map((p) => ({ prospectId: p.id }))
          : campProspects.map((p) => ({ prospectId: p.id }));
        evidenceByDraw.set(String(dr.id), await collectBoostEvidence(dr, entryLike));
      }

      return { selected, configEnabled, termsByCampaign, entryByDrawProspect, attemptsByDraw, evidenceByDraw };
    };

    let data = await collect();
    // One consistency retry: a freeze/seal that landed mid-collection flips
    // the status — re-collect once from the fresh lifecycle state.
    const selectedIds = [...data.selected.values()].map((s) => String(s.draw.id));
    if (selectedIds.length > 0) {
      const fresh = await d.Draw.findAll({
        where: { id: { [Op.in]: selectedIds } },
        attributes: ['id', 'status'],
      });
      const statusNow = new Map(fresh.map((f) => [String(f.id), f.status]));
      const flipped = [...data.selected.values()].some(
        (s) => statusNow.has(String(s.draw.id)) && statusNow.get(String(s.draw.id)) !== s.draw.status
      );
      if (flipped) data = await collect();
    }

    for (const p of list) {
      const pid = String(p.id);
      const sel = data.selected.get(String(p.campaignId));
      if (!sel) {
        out.set(pid, data.configEnabled.has(String(p.campaignId)) ? { state: 'no_draw_record' } : null);
        continue;
      }
      const dr = sel.draw;
      const block = {
        drawId: dr.id,
        drawStatus: dr.status,
        activationId: dr.activationId || null,
        multiplier: dr.multiplier,
        closesAt: dr.closesAt,
        boostClosesAt: dr.boostClosesAt,
        provisional: dr.status === 'open' || dr.status === 'frozen',
        chances: 0,
        boosted: false,
        boostVia: null,
        boostedAt: null,
        boostReviewPending: false,
        notEligibleReason: null,
        outcome: null,
        drawHistory: sel.history,
      };

      const isErased = erased || p.sourceMetadata?.erased === true;
      if (isErased) {
        // Erasure nulls DrawEntry.prospectId and sentinels the phone hash —
        // the entry is unjoinable BY DESIGN. Saying "not eligible"/"no entry"
        // would rewrite history; say the truth instead.
        out.set(pid, { ...block, state: 'erased_draw_unavailable' });
        continue;
      }
      if (dr.status === 'void') {
        out.set(pid, { ...block, state: 'void' });
        continue;
      }

      if (dr.status === 'open') {
        const versions = data.termsByCampaign.get(String(dr.campaignId)) || new Set();
        const elig = entryEligibility(p, versions);
        const inWindow = new Date(p.createdAt).getTime() < new Date(dr.closesAt).getTime();
        let notEligibleReason = null;
        if (!p.phone) notEligibleReason = 'no_phone';
        else if (!elig.verified) notEligibleReason = 'phone_unverified';
        else if (!elig.hasTerms) notEligibleReason = 'terms_not_pinned';
        else if (!inWindow) notEligibleReason = 'signed_up_after_close';

        const evidence = data.evidenceByDraw.get(String(dr.id));
        const boost = evidence?.byProspect.get(pid) || null;
        const pendingReview = (evidence?.undecidedButtons || []).some((u) => String(u.prospectId) === pid);
        out.set(pid, {
          ...block,
          state: notEligibleReason ? 'provisional_out' : 'provisional_in',
          chances: notEligibleReason ? 0 : (boost ? dr.multiplier : 1),
          boosted: !notEligibleReason && Boolean(boost),
          boostVia: boost?.via || null,
          boostedAt: boost?.at || null,
          boostReviewPending: pendingReview && !boost,
          notEligibleReason,
        });
        continue;
      }

      const entry = data.entryByDrawProspect.get(`${dr.id}:${p.id}`);
      if (!entry) {
        out.set(pid, { ...block, state: 'excluded_at_freeze' });
        continue;
      }

      if (dr.status === 'frozen') {
        const evidence = data.evidenceByDraw.get(String(dr.id));
        const boost = evidence?.byProspect.get(pid) || null;
        const pendingReview = (evidence?.undecidedButtons || []).some((u) => String(u.prospectId) === pid);
        out.set(pid, {
          ...block,
          state: 'frozen_in',
          chances: entry.chances, // 1 until seal applies the multiplier
          boosted: Boolean(boost), // provisional — applies at seal
          boostVia: boost?.via || null,
          boostedAt: boost?.at || null,
          boostReviewPending: pendingReview && !boost,
        });
        continue;
      }

      // sealed | drawn | published | claimed — stored truth + redraw ledger.
      const attempts = data.attemptsByDraw.get(String(dr.id)) || [];
      const mine = attempts.filter((a) => String(a.pickedEntryId) === String(entry.id));
      const anyClaimed = dr.status === 'claimed' || attempts.some((a) => a.outcome === 'claimed');
      let outcome = null;
      if (mine.length > 0) {
        const last = mine[mine.length - 1];
        outcome = {
          status: last.outcome === 'pending' ? 'selected_pending' : `selected_${last.outcome}`,
          attemptNo: last.attemptNo,
          claimDeadline: last.claimDeadline || null,
          claimedAt: last.claimedAt || null,
        };
      } else if (attempts.length > 0) {
        outcome = { status: anyClaimed ? 'not_selected_final' : 'not_selected_yet' };
      }
      out.set(pid, {
        ...block,
        state: 'sealed',
        chances: entry.chances,
        boosted: Boolean(entry.boostVia),
        boostVia: entry.boostVia || null,
        outcome,
      });
    }
    return out;
  }

  /**
   * Seamless draw-record ensure — the record used to be a manual CLI step
   * (run-lucky-draw.js create) that every launched draw campaign needed an
   * operator to remember; forgetting it left "Draw configured — no draw
   * record yet" on every lead. Called from the SAME campaignService choke
   * points that arm the boost rail, plus the boot/interval reconciler below.
   *
   * BEST-EFFORT by design, unlike the rail ensure: a missing record loses
   * nothing (entry evidence and boost events accrue independently and count
   * retroactively at freeze/seal), so record trouble must never block a
   * launch — it logs, campaign readiness keeps complaining, and the
   * reconciler retries. Fairness validation is NOT duplicated here: creation
   * goes through createDraw, which fail-closes on multi-prize, missing
   * closesAt, and rail conflicts. Never throws.
   */
  async function ensureDrawRecord({ campaignId, user = null } = {}) {
    if (String(process.env.DRAW_RECORD_AUTOCREATE_ENABLED ?? 'true').toLowerCase() === 'false') {
      return { created: false, reason: 'disabled' };
    }
    if (!campaignId) return { created: false, reason: 'no_campaign' };
    const live = { [Op.in]: ['open', 'frozen', 'sealed', 'drawn'] };
    try {
      const existing = await d.Draw.findOne({ where: { campaignId, status: live } });
      if (existing) return { created: false, reason: 'exists', drawId: existing.id };
      const actorId = user?.id || await d.getSystemAgentId();
      const draw = await createDraw({ campaignId }, { id: actorId });
      d.logger.info('lucky_draw.record_auto_created', { drawId: draw.id, campaignId, actorId });
      return { created: true, drawId: draw.id };
    } catch (err) {
      // Concurrent ensure lost the uq_draws_live_campaign race — adopt the winner.
      if (err?.statusCode === 409 || /already has a live draw/i.test(err?.message || '')) {
        const winner = await d.Draw.findOne({ where: { campaignId, status: live } }).catch(() => null);
        return { created: false, reason: 'exists', drawId: winner?.id || null };
      }
      d.logger.warn('lucky_draw.record_auto_create_failed', { campaignId, error: err?.message });
      return { created: false, reason: 'failed', error: err?.message };
    }
  }

  /**
   * Reconciler: every ACTIVE draw campaign whose configured entry window is
   * still open gets its record ensured. Heals campaigns launched before
   * auto-creation existed and any launch whose ensure failed transiently.
   * Campaigns whose configured closesAt already passed are left to the CLI —
   * minting a record for an already-closed window is an operator decision.
   */
  async function sweepDrawRecords() {
    const campaigns = await d.Campaign.findAll({
      where: { is_active: true },
      attributes: ['id', 'design_config'],
    });
    const results = { checked: 0, created: 0, failed: 0 };
    const nowMs = d.now().getTime();
    for (const c of campaigns) {
      const ld = c.design_config?.luckyDraw;
      if (ld?.enabled !== true) continue;
      const closesAtMs = ld.closesAt ? sgtDayEndExclusiveMs(ld.closesAt) : null;
      if (!Number.isFinite(closesAtMs) || closesAtMs <= nowMs) continue;
      results.checked += 1;
      const r = await ensureDrawRecord({ campaignId: c.id });
      if (r.created) results.created += 1;
      else if (r.reason === 'failed') results.failed += 1;
    }
    if (results.created > 0 || results.failed > 0) {
      d.logger.info('lucky_draw.record_sweep', results);
    }
    return results;
  }

  return {
    createDraw, freezeDraw, listPendingBoostReviews, reviewBoost, sealDraw,
    runDrawAttempt, recordAttemptOutcome, markPublished, voidDraw,
    verifyDraw, getDrawState, getProspectDrawStatus,
    ensureDrawRecord, sweepDrawRecords,
  };
}

// Default instance for the launch hooks (campaignService) and the bootstrap
// reconciler — construction is deps-only, no I/O. The CLI keeps building its
// own instance; tests inject overrides via makeLuckyDrawService.
const _default = makeLuckyDrawService();
export const ensureDrawRecord = (args) => _default.ensureDrawRecord(args);
export const sweepDrawRecords = () => _default.sweepDrawRecords();
