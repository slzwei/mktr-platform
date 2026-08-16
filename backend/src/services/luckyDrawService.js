import crypto from 'crypto';
import { makeDrawStatusOps } from './luckyDrawStatusService.js';
import { Op, Transaction } from 'sequelize';
import {
  Draw, DrawEntry, DrawAttempt, DrawBoostReview,
  Campaign, Prospect, Activation, RewardEntitlement, RedemptionEvent,
  DrawTermsVersion,
  sequelize,
} from '../models/index.js';
import { AppError } from '../middleware/appError.js';
import { logger } from '../utils/logger.js';
import { sgtDayEndExclusiveMs } from '../utils/sgtTime.js';
import {
  normalizeLuckyDraw, assertPromiseIsDeliverable, expandPrizeUnits, totalPrizeQuantity,
} from '../utils/luckyDraw.js';
import {
  pickWinnerFor, pickWinnerV1, CURRENT_ALGORITHM_VERSION, ALGORITHM_V1_LEGACY_MOD,
} from '../utils/drawSelection.js';
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
 *    agent_scan and agent_button both count by default (veto model,
 *    2026-07-25 — superseded §8.1's approval queue); a DrawBoostReview
 *    'rejected' row strikes a button unlock before seal.
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
 * Legacy single-winner pick — `sha256(seed) mod totalChances`. Kept as a named
 * export because existing tests and the verifier's v1 replay path call it
 * directly; the implementation now lives in utils/drawSelection.js so the
 * ceremony and the verifier can never drift apart.
 *
 * NEW draws do not come through here — they use the v2 domain-separated
 * derivation (see selectForUnit below), because reusing one digest across N
 * picks is provably biased.
 */
export function pickWinner(seedHex, eligibleEntries) {
  const picked = pickWinnerV1(seedHex, eligibleEntries);
  if (!picked) throw new AppError('No eligible entries to draw from', 409);
  return picked;
}

/**
 * The ONE selection entry point for both the ceremony and the verifier.
 * Version-dispatched so a historical draw replays under the algorithm that
 * actually ran it.
 */
function selectForUnit(draw, seedHex, eligible, { unitIndex, attemptNo }) {
  const picked = pickWinnerFor(draw.algorithmVersion ?? ALGORITHM_V1_LEGACY_MOD, seedHex, eligible, {
    drawId: String(draw.id), unitIndex, attemptNo,
  });
  if (!picked) throw new AppError('No eligible entries to draw from', 409);
  return picked;
}

/**
 * Which prize unit an attempt awards. Legacy attempts predate the column and a
 * single-prize draw has exactly one unit, so absent/garbage reads as unit 0 —
 * never NaN, which would silently match no unit and skip every per-unit guard.
 */
function unitOf(attempt) {
  const n = Number(attempt?.prizeUnitIndex);
  return Number.isInteger(n) && n >= 0 ? n : 0;
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
  const { collectBoostEvidence, getProspectDrawStatus } = makeDrawStatusOps({ d, entryEligibility });

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
    // Structured multi-prize draws are fully supported (Phase 3). What is still
    // refused: an UNSTRUCTURED promise of several winners, which gives the
    // engine no unit list to award from — see assertPromiseIsDeliverable.
    const normalizedLd = normalizeLuckyDraw(ld);
    assertPromiseIsDeliverable(normalizedLd);
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

    // SNAPSHOT what this draw awards (Phase 3 §3.2). From here on the engine
    // reads the draw row, never the campaign — editing prizes must not change
    // an in-flight draw. Legacy/unstructured configs snapshot NULL + 1 unit,
    // which is byte-identical to how every historical draw behaves.
    const structuredPrizes = Array.isArray(normalizedLd?.prizes) && normalizedLd.prizes.length > 0
      ? normalizedLd.prizes
      : null;
    const winnersCount = structuredPrizes ? totalPrizeQuantity(normalizedLd) : 1;

    try {
      const draw = await d.Draw.create({
        campaignId,
        activationId,
        termsVersionId: ld.termsVersionId || null,
        closesAt: new Date(closesAtMs),
        boostClosesAt: boostClosesAtMs !== null ? new Date(boostClosesAtMs) : null,
        multiplier: ld.multiplier || 10,
        prizes: structuredPrizes,
        winnersCount,
        algorithmVersion: CURRENT_ALGORITHM_VERSION,
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
   * Button (agent_button/manual-via) unlocks with no review row — they COUNT
   * by default; this list exists so ops can veto one (reviewBoost 'rejected')
   * before seal. Purely informational, never blocking.
   */
  async function listPendingBoostReviews(drawId) {
    const draw = await getDrawOr404(drawId);
    const entries = await d.DrawEntry.findAll({ where: { drawId: draw.id } });
    const { undecidedButtons } = await collectBoostEvidence(draw, entries);
    return undecidedButtons;
  }

  /**
   * Record a decision on one button unlock's ×N weighting (voucher untouched).
   * Under the veto model 'rejected' is the operative verb — it strikes the
   * boost before seal; 'approved' is an optional recorded affirmation.
   */
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
   * poolHash. Never runs before boostClosesAt. Button unlocks count by
   * default (veto model) — unreviewed ones are logged for the audit trail,
   * never a blocker; a 'rejected' review before seal is the strike.
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
      d.logger.info('lucky_draw.sealing_with_unreviewed_buttons', {
        drawId: draw.id,
        count: undecidedButtons.length,
        entitlementIds: undecidedButtons.map((u) => String(u.entitlementId)),
      });
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
    // Commit-reveal (P2-8): the seed is minted HERE, inside the one-way
    // frozen→sealed transition, and only its hash is the commitment. Because
    // the pool is committed in the same statement, the winner is determined at
    // the seal instant — there is no later moment at which an operator can
    // re-roll and keep a favourable pick.
    const sealedSeed = d.mintSeed();
    const seedCommitment = sha256Hex(sealedSeed);

    await d.sequelize.transaction(async (t) => {
      for (const entry of boosted) {
        await d.DrawEntry.update(
          { chances: entry.chances, boostVia: entry.boostVia, boostEventId: entry.boostEventId },
          { where: { id: entry.id }, transaction: t }
        );
      }
      await transition(draw.id, 'frozen', 'sealed', { poolHash, seedCommitment, sealedSeed }, t);
    });

    const totalChances = entries.reduce((n, e) => n + e.chances, 0);
    d.logger.info('lucky_draw.sealed', {
      drawId: draw.id, entries: entries.length, boosted: boosted.length, totalChances, poolHash, seedCommitment,
    });
    return { drawId: draw.id, entries: entries.length, boosted: boosted.length, totalChances, poolHash, seedCommitment };
  }

  /** Prize name for a unit, from the draw's SNAPSHOT (never the campaign). */
  function unitPrizeName(draw, unitIndex) {
    const units = expandPrizeUnits(draw.prizes);
    return units[unitIndex]?.name || null;
  }

  /** The seed to draw with: REVEAL the sealed one, fail closed on mismatch. */
  function revealSeed(draw) {
    // A draw sealed before commit-reveal existed has no commitment; it keeps
    // the legacy mint so historical draws stay drawable, and verifyDraw reports
    // the gap rather than pretending.
    const seed = draw.sealedSeed || d.mintSeed();
    if (draw.seedCommitment && sha256Hex(seed) !== draw.seedCommitment) {
      // Fail CLOSED: a seed that doesn't match its commitment is the exact
      // substitution this mechanism exists to catch.
      throw new AppError('Sealed seed does not match its commitment — refusing to draw', 409);
    }
    return seed;
  }

  const publicPick = (entry) => ({
    entryId: entry.id,
    prospectId: entry.prospectId,
    displayName: entry.displayName,
    phoneLast4: entry.phoneLast4,
    chances: entry.chances,
    boostVia: entry.boostVia || null,
  });

  /**
   * THE CEREMONY (Phase 3 §3.3) — all N winners picked in ONE witnessed
   * transaction, sealed → drawn.
   *
   * This is not a convenience. The pinned T&C says "*N winners are drawn at
   * random from all verified entries after the entry period closes, in a
   * process witnessed by MKTR staff*". Picking units on separate days across
   * separate ceremonies would contradict the document every entrant accepted.
   *
   * Two invariants the loop enforces:
   *  - `pickedSoFar` is GLOBAL across units — "each verified mobile number can
   *    win at most one prize" is in the T&C. The per-entry partial unique index
   *    is the storage-level backstop for the same rule.
   *  - The draw row is locked FOR UPDATE first, and every read happens inside
   *    the transaction, so a concurrent erasure or redraw cannot interleave
   *    (blocker #9/#10). A failure anywhere rolls the whole ceremony back.
   *
   * Blocker #7: the ceremony HARD-STOPS unless at least `winnersCount` eligible
   * entries exist. The pinned terms promise N winners, not "up to N" — awarding
   * 3 of 5 silently would contradict them. An operator who genuinely wants a
   * short award must pass `allowPartialAward`, which is an explicit, logged
   * decision rather than a silent degradation.
   */
  async function runInitialDraw(drawId, { witnessUserId = null, allowPartialAward = false } = {}, user) {
    const drawnAt = d.now();
    const result = await d.sequelize.transaction(async (t) => {
      // Lock the draw row FIRST — one global lock order for every writer.
      const draw = await d.Draw.findByPk(drawId, { transaction: t, lock: Transaction.LOCK.UPDATE });
      if (!draw) throw new AppError('Draw not found', 404);
      if (draw.status !== 'sealed') {
        throw new AppError(`Draw is ${draw.status}, expected sealed`, 409);
      }

      const existing = await d.DrawAttempt.findAll({ where: { drawId: draw.id }, transaction: t });
      if (existing.length > 0) {
        throw new AppError('This draw has already been drawn — use a redraw for individual units', 409);
      }

      const winnersCount = Math.max(1, Number(draw.winnersCount) || 1);
      const allEntries = await d.DrawEntry.findAll({ where: { drawId: draw.id }, transaction: t });
      const available = orderedEntries(allEntries).filter((e) => e.prospectId != null);

      if (available.length === 0) throw new AppError('No eligible entries to draw from', 409);
      if (available.length < winnersCount && !allowPartialAward) {
        const err = new AppError(
          `This draw promises ${winnersCount} winners but only ${available.length} eligible entries remain. `
          + 'The pinned terms promise a fixed number of winners, so the ceremony will not silently award fewer — '
          + 're-run with allowPartialAward once the shortfall is an accepted, recorded decision.',
          409
        );
        err.data = { code: 'DRAW_INSUFFICIENT_ENTRIES', winnersCount, eligible: available.length };
        throw err;
      }

      const seed = revealSeed(draw);
      const pickedSoFar = new Set();
      const attempts = [];
      const picks = [];

      for (let unitIndex = 0; unitIndex < winnersCount; unitIndex += 1) {
        const eligible = available.filter((e) => !pickedSoFar.has(String(e.id)));
        if (eligible.length === 0) break; // only reachable under allowPartialAward
        const attemptNo = attempts.length + 1;
        const picked = selectForUnit(draw, seed, eligible, { unitIndex, attemptNo });
        pickedSoFar.add(String(picked.id));

        attempts.push(await d.DrawAttempt.create(
          {
            drawId: draw.id,
            attemptNo,
            prizeUnitIndex: unitIndex,
            seed,
            totalChances: eligible.reduce((n, e) => n + e.chances, 0),
            eligibleHash: computeEligibleHash(eligible),
            pickedEntryId: picked.id,
            reason: 'initial',
            drawnAt,
            witnessedByUserId: witnessUserId,
            claimDeadline: new Date(drawnAt.getTime() + CLAIM_WINDOW_DAYS * 24 * 3600 * 1000),
            outcome: 'pending',
          },
          { transaction: t }
        ));
        picks.push({ unitIndex, prize: unitPrizeName(draw, unitIndex), ...publicPick(picked) });
      }

      await transition(draw.id, 'sealed', 'drawn', { witnessedByUserId: witnessUserId }, t);
      return { drawId: draw.id, winnersCount, awarded: attempts.length, attempts, picks };
    });

    d.logger.info('lucky_draw.ceremony', {
      drawId: result.drawId, winnersCount: result.winnersCount, awarded: result.awarded,
      picks: result.picks.map((p) => ({ unit: p.unitIndex, entryId: p.entryId, phoneLast4: p.phoneLast4 })),
    });
    return result;
  }

  /**
   * A single REDRAW for one prize unit. Every guard is scoped to the unit
   * (Phase 3 §3.4) — a pending attempt on unit 2 must not block a redraw on
   * unit 4 — with ONE deliberate exception: the exclusion set stays GLOBAL,
   * because that is what enforces one-prize-per-person.
   *
   * The initial ceremony runs through runInitialDraw; this path exists for
   * replacing a winner who lapsed, declined, was unreachable or ineligible.
   */
  async function runDrawAttempt(drawId, { witnessUserId = null, reason = 'initial', prizeUnitIndex = 0 } = {}, user) {
    if (!ATTEMPT_REASONS.has(reason)) {
      throw new AppError(`reason must be one of: ${[...ATTEMPT_REASONS].join(', ')}`, 422);
    }
    const unitIndex = Number(prizeUnitIndex);
    if (!Number.isInteger(unitIndex) || unitIndex < 0) {
      throw new AppError('prizeUnitIndex must be a non-negative integer', 422);
    }

    const drawnAt = d.now();
    const outcome = await d.sequelize.transaction(async (t) => {
      const draw = await d.Draw.findByPk(drawId, { transaction: t, lock: Transaction.LOCK.UPDATE });
      if (!draw) throw new AppError('Draw not found', 404);
      if (!['sealed', 'drawn'].includes(draw.status)) {
        throw new AppError(`Draw is ${draw.status}, expected sealed (or drawn, for a redraw)`, 409);
      }
      const winnersCount = Math.max(1, Number(draw.winnersCount) || 1);
      if (unitIndex >= winnersCount) {
        throw new AppError(`prizeUnitIndex ${unitIndex} is outside this draw's ${winnersCount} prize unit(s)`, 422);
      }

      const allAttempts = await d.DrawAttempt.findAll({
        where: { drawId: draw.id }, order: [['attemptNo', 'ASC']], transaction: t,
      });
      const unitAttempts = allAttempts.filter((a) => unitOf(a) === unitIndex);

      const pending = unitAttempts.find((a) => a.outcome === 'pending');
      if (pending) {
        throw new AppError(
          `Attempt ${pending.attemptNo} on prize unit ${unitIndex} is still pending — record its outcome before redrawing`,
          409
        );
      }
      if (unitAttempts.some((a) => a.outcome === 'claimed')) {
        throw new AppError(`Prize unit ${unitIndex} already has a claimed winner`, 409);
      }
      if (unitAttempts.length > 0) {
        // The redraw reason IS the prior attempt's recorded outcome, per unit —
        // the audit ledger must not be able to say "unclaimed" about a declined
        // winner (Codex finding #10).
        const prior = unitAttempts[unitAttempts.length - 1];
        if (reason !== prior.outcome) {
          throw new AppError(
            `Redraw reason must match the prior attempt's outcome ('${prior.outcome}'), got '${reason}'`,
            422
          );
        }
      } else if (reason !== 'initial') {
        throw new AppError("The first attempt's reason must be 'initial'", 422);
      }

      // GLOBAL exclusion — every entry ever picked on this draw, any unit.
      const pickedBefore = new Set(allAttempts.map((a) => String(a.pickedEntryId)));
      const allEntries = await d.DrawEntry.findAll({ where: { drawId: draw.id }, transaction: t });
      const eligible = orderedEntries(allEntries).filter(
        (e) => e.prospectId != null && !pickedBefore.has(String(e.id))
      );
      if (eligible.length === 0) throw new AppError('No eligible entries left to draw from', 409);

      const seed = revealSeed(draw);
      const attemptNo = allAttempts.length + 1;
      const picked = selectForUnit(draw, seed, eligible, { unitIndex, attemptNo });

      const attempt = await d.DrawAttempt.create(
        {
          drawId: draw.id,
          attemptNo,
          prizeUnitIndex: unitIndex,
          seed,
          totalChances: eligible.reduce((n, e) => n + e.chances, 0),
          eligibleHash: computeEligibleHash(eligible),
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
      return { attempt, picked, prize: unitPrizeName(draw, unitIndex) };
    });

    d.logger.info('lucky_draw.drawn', {
      drawId, attemptNo: outcome.attempt.attemptNo, prizeUnitIndex: unitIndex,
      pickedEntryId: outcome.picked.id, displayName: outcome.picked.displayName,
      phoneLast4: outcome.picked.phoneLast4,
    });
    return {
      attempt: outcome.attempt,
      picked: { ...publicPick(outcome.picked), unitIndex, prize: outcome.prize },
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
      // Lock the DRAW row before touching the attempt — same global lock order
      // as the ceremony. Without it, two concurrent final claims can each read
      // "not all units claimed yet" and neither flips the draw terminal
      // (write skew, blocker #9).
      const draw = await d.Draw.findByPk(attempt.drawId, { transaction: t, lock: Transaction.LOCK.UPDATE });
      if (!draw) throw new AppError('Draw not found', 404);

      const [count] = await d.DrawAttempt.update(
        {
          outcome,
          ...(contactedAt ? { contactedAt } : {}),
          ...(outcome === 'claimed' ? { claimedAt: claimedAt || d.now() } : {}),
        },
        { where: { id: attemptId, outcome: 'pending' }, transaction: t }
      );
      if (count === 0) throw new AppError(`Attempt already has outcome '${attempt.outcome}'`, 409);

      if (outcome !== 'claimed') return;

      if (!['drawn', 'published'].includes(draw.status)) {
        throw new AppError('Draw is no longer live (voided or reset?) — cannot record a claim', 409);
      }

      // A claim on ONE unit no longer ends the draw (Phase 3 §3.5). The draw is
      // terminal only when every promised unit has been claimed, so `claimed`
      // keeps its old meaning — the terminal-est state — and stays byte-identical
      // for single-winner draws, where winnersCount is 1.
      //
      // A short-awarded draw (allowPartialAward) never reaches `claimed`, and
      // that is deliberate: it did not fulfil the promise its terms published,
      // and the lifecycle should show that rather than paper over it.
      const claimedRows = await d.DrawAttempt.findAll({
        where: { drawId: draw.id, outcome: 'claimed' },
        transaction: t,
      });
      const claimedUnits = new Set(claimedRows.map(unitOf)).size;
      const winnersCount = Math.max(1, Number(draw.winnersCount) || 1);
      if (claimedUnits >= winnersCount) {
        const [drawCount] = await d.Draw.update(
          { status: 'claimed' },
          { where: { id: draw.id, status: { [Op.in]: ['drawn', 'published'] } }, transaction: t }
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

    // Commit-reveal on the seed (P2-8). poolHash proves WHAT was drawn from;
    // this proves the pick was not re-rolled until it landed somewhere chosen.
    if (draw.seedCommitment) {
      const recomputed = draw.sealedSeed ? sha256Hex(draw.sealedSeed) : null;
      const ok = recomputed === draw.seedCommitment;
      report.checks.push({ check: 'seedCommitment', ok, expected: draw.seedCommitment, recomputed });
      if (!ok) report.ok = false;
    } else if (attempts.length) {
      // Sealed before commit-reveal existed: say so rather than reporting a
      // clean bill of health the evidence does not support.
      report.checks.push({
        check: 'seedCommitment', ok: true, note: 'sealed before commit-reveal — seed was minted at draw time, not committed',
      });
    }

    // ---- Structural checks on the prize units (Phase 3) ----
    const winnersCount = Math.max(1, Number(draw.winnersCount) || 1);
    const outOfRange = attempts.filter((a) => unitOf(a) >= winnersCount);
    if (outOfRange.length > 0) {
      report.checks.push({
        check: 'prizeUnitBounds', ok: false,
        note: `attempt(s) ${outOfRange.map((a) => `#${a.attemptNo}`).join(', ')} award a unit outside [0, ${winnersCount})`,
      });
      report.ok = false;
    } else {
      report.checks.push({ check: 'prizeUnitBounds', ok: true, winnersCount });
    }

    // One claimed attempt per unit, and one live award per entry. The partial
    // unique indexes make both unstorable — verifying them here catches a row
    // written before those indexes existed, or by hand.
    const claimedByUnit = new Map();
    const liveByEntry = new Map();
    for (const a of attempts) {
      if (a.outcome === 'claimed') {
        const unit = unitOf(a);
        claimedByUnit.set(unit, (claimedByUnit.get(unit) || 0) + 1);
      }
      if (a.outcome === 'claimed' || a.outcome === 'pending') {
        const key = String(a.pickedEntryId);
        liveByEntry.set(key, (liveByEntry.get(key) || 0) + 1);
      }
    }
    const doubleClaimed = [...claimedByUnit.entries()].filter(([, n]) => n > 1);
    if (doubleClaimed.length > 0) {
      report.checks.push({
        check: 'oneClaimPerUnit', ok: false,
        note: `unit(s) ${doubleClaimed.map(([u]) => u).join(', ')} have more than one claimed attempt`,
      });
      report.ok = false;
    } else {
      report.checks.push({ check: 'oneClaimPerUnit', ok: true });
    }
    const doubleAwarded = [...liveByEntry.entries()].filter(([, n]) => n > 1);
    if (doubleAwarded.length > 0) {
      report.checks.push({
        check: 'onePrizePerEntry', ok: false,
        note: `${doubleAwarded.length} entr(y/ies) hold more than one live award — one-prize-per-person is broken`,
      });
      report.ok = false;
    } else {
      report.checks.push({ check: 'onePrizePerEntry', ok: true });
    }

    // ---- Replay every pick ----
    const pickedBefore = new Set();
    for (const attempt of attempts) {
      if (draw.seedCommitment && sha256Hex(attempt.seed) !== draw.seedCommitment) {
        report.checks.push({
          check: `attempt#${attempt.attemptNo}.seedRevealed`, ok: false,
          note: 'the seed this attempt was drawn with does not hash to the sealed commitment',
        });
        report.ok = false;
      }
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
        // Re-derive under the algorithm THIS draw ran, binding the pick to its
        // unit and attempt number — so reassigning an attempt to a different
        // prize unit no longer replays clean (blocker #15).
        const picked = selectForUnit(draw, attempt.seed, eligible, {
          unitIndex: unitOf(attempt),
          attemptNo: attempt.attemptNo,
        });
        const ok = String(picked.id) === String(attempt.pickedEntryId);
        report.checks.push({
          check: `attempt#${attempt.attemptNo}.pick`, ok, prizeUnitIndex: unitOf(attempt),
        });
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
    const entryById = new Map(entries.map((e) => [String(e.id), e]));
    const winnersCount = Math.max(1, Number(draw.winnersCount) || 1);
    const units = expandPrizeUnits(draw.prizes);

    // Per-unit rollup — what the CLI's `status` renders as N rows. The unit's
    // state is the state of its LATEST attempt; a unit with no attempt yet is
    // 'not_drawn' rather than silently absent.
    const unitRollup = [];
    for (let unitIndex = 0; unitIndex < winnersCount; unitIndex += 1) {
      const mine = attempts.filter((a) => unitOf(a) === unitIndex);
      const latest = mine[mine.length - 1] || null;
      const winner = latest ? entryById.get(String(latest.pickedEntryId)) : null;
      unitRollup.push({
        unitIndex,
        prize: units[unitIndex]?.name || null,
        status: latest ? latest.outcome : 'not_drawn',
        attempts: mine.length,
        winner: winner
          ? { entryId: winner.id, displayName: winner.displayName, phoneLast4: winner.phoneLast4 }
          : null,
        claimDeadline: latest?.claimDeadline || null,
      });
    }

    return {
      draw: {
        id: draw.id, campaignId: draw.campaignId, status: draw.status,
        closesAt: draw.closesAt, boostClosesAt: draw.boostClosesAt,
        multiplier: draw.multiplier, poolHash: draw.poolHash,
        activationId: draw.activationId, termsVersionId: draw.termsVersionId,
        winnersCount, prizes: draw.prizes || null,
        algorithmVersion: draw.algorithmVersion ?? ALGORITHM_V1_LEGACY_MOD,
      },
      entries: {
        count: entries.length,
        totalChances: entries.reduce((n, e) => n + e.chances, 0),
        boosted: entries.filter((e) => e.boostVia).length,
        erased: entries.filter((e) => e.prospectId == null).length,
      },
      units: unitRollup,
      attempts: attempts.map((a) => ({
        attemptNo: a.attemptNo, prizeUnitIndex: unitOf(a),
        prize: units[unitOf(a)]?.name || null,
        reason: a.reason, outcome: a.outcome,
        drawnAt: a.drawnAt, claimDeadline: a.claimDeadline, claimedAt: a.claimedAt,
        pickedEntryId: a.pickedEntryId, seed: a.seed,
      })),
    };
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
    runInitialDraw, runDrawAttempt, recordAttemptOutcome, markPublished, voidDraw,
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
