import { Op } from 'sequelize';

/**
 * Draw evidence & status reads (split from luckyDrawService): the boost-
 * evidence collector every freeze/verify pass uses, and the prospect-facing
 * draw-status projection (the DTO behind lead surfaces). Read-only — the
 * engine lifecycle (create/freeze/seal/attempt/void) stays in
 * luckyDrawService, which composes this factory with its own deps and the
 * entryEligibility predicate so both sides apply ONE eligibility rule.
 * Extracted verbatim; behaviour is covered by the luckyDrawService /
 * drawRecordAutoCreate / prospect surface suites with zero test edits.
 */
export function makeDrawStatusOps({ d, entryEligibility }) {
  /**
   * The boost evidence for a draw: append-only 'unlocked' events on the
   * designated activation, non-manual issuance, inside boostClosesAt, for
   * prospects that hold a frozen entry. Two-step query (no association
   * dependency). Returns { byProspect, undecidedButtons }.
   *
   * via rules: `agent_scan` is the token-backed evidence the routes derive
   * server-side — always counts, always wins for the prospect. `agent_button`
   * (consultant assertion) and `manual`-via (admin/support unlock) count BY
   * DEFAULT under the veto model (operator decision 2026-07-25; the original
   * approval queue was friction for a team this small) — a DrawBoostReview
   * 'rejected' row is the strike. `auto_on_capture` (voucher issued without
   * any meeting) NEVER boosts, and manually-ISSUED entitlements
   * (issuedVia='manual') stay excluded at the query.
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
    const undecidedButtons = []; // counted by default — listed for OPTIONAL veto
    for (const ev of events) {
      const ent = entitlementById.get(String(ev.entitlementId));
      if (!ent) continue;
      const via = ev.metadata?.via;
      const key = String(ent.prospectId);
      if (via === 'agent_scan') {
        // Token-backed scan — the strongest evidence; always wins for the prospect.
        byProspect.set(key, { via, eventId: ev.id, at: ev.createdAt });
      } else if (via === 'agent_button' || via === 'manual') {
        // VETO model (operator decision 2026-07-25, supersedes the approval
        // queue): a consultant's button unlock COUNTS by default — the team is
        // small and routine approvals were pure friction. A DrawBoostReview
        // 'rejected' row strikes exactly this unlock before seal; 'approved'
        // stays a recordable affirmation. Unreviewed buttons are surfaced
        // (CLI `reviews`) but never block anything.
        const decision = reviewByEntitlement.get(String(ev.entitlementId));
        if (decision !== 'rejected') {
          if (!byProspect.has(key)) byProspect.set(key, { via: 'agent_button', eventId: ev.id, at: ev.createdAt });
          if (!decision) {
            undecidedButtons.push({ entitlementId: ent.id, prospectId: ent.prospectId, eventId: ev.id, via });
          }
        }
        // rejected → vetoed: no boost.
      }
      // Any other via (auto_on_capture, unknown) → never session evidence.
    }
    return { byProspect, undecidedButtons };
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
        out.set(pid, {
          ...block,
          state: notEligibleReason ? 'provisional_out' : 'provisional_in',
          chances: notEligibleReason ? 0 : (boost ? dr.multiplier : 1),
          boosted: !notEligibleReason && Boolean(boost),
          boostVia: boost?.via || null,
          boostedAt: boost?.at || null,
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
        out.set(pid, {
          ...block,
          state: 'frozen_in',
          chances: entry.chances, // 1 until seal applies the multiplier
          boosted: Boolean(boost), // provisional — applies at seal
          boostVia: boost?.via || null,
          boostedAt: boost?.at || null,
        });
        continue;
      }

      // sealed | drawn | published | claimed — stored truth + redraw ledger.
      const attempts = data.attemptsByDraw.get(String(dr.id)) || [];
      const mine = attempts.filter((a) => String(a.pickedEntryId) === String(entry.id));
      // Non-selection is FINAL only when the whole draw is finished — every
      // promised prize unit claimed. On a multi-winner draw a single claim used
      // to tell every other entrant "not selected, final" while four prizes were
      // still being awarded and a redraw could still pick them.
      const winnersCount = Math.max(1, Number(dr.winnersCount) || 1);
      const claimedAttempts = attempts.filter((a) => a.outcome === 'claimed');
      const claimedUnits = new Set(claimedAttempts.map((a) => Number(a.prizeUnitIndex) || 0)).size;
      const anyClaimed = dr.status === 'claimed' || claimedUnits >= winnersCount;
      let outcome = null;
      if (mine.length > 0) {
        const last = mine[mine.length - 1];
        outcome = {
          status: last.outcome === 'pending' ? 'selected_pending' : `selected_${last.outcome}`,
          attemptNo: last.attemptNo,
          claimDeadline: last.claimDeadline || null,
          claimedAt: last.claimedAt || null,
          // History timestamps (lead-history-completeness): drawnAt is the
          // SELECTION moment; outcomeAt is when the outcome was recorded
          // (claim time, or the staff outcome-entry moment via updatedAt) —
          // a lapse must not be timelined at the draw moment.
          drawnAt: last.drawnAt || null,
          outcomeAt: last.outcome === 'pending' ? null : (last.claimedAt || last.updatedAt || null),
        };
      } else if (attempts.length > 0) {
        // Timestamp the LAST claim, not the first: on a multi-winner draw the
        // entrant's non-selection only became final when the final prize went.
        const lastClaimedAt = claimedAttempts
          .map((a) => a.claimedAt)
          .filter(Boolean)
          .sort((x, y) => new Date(y).getTime() - new Date(x).getTime())[0] || null;
        outcome = {
          status: anyClaimed ? 'not_selected_final' : 'not_selected_yet',
          // Final non-selection becomes TRUE when the last prize is claimed.
          outcomeAt: anyClaimed ? lastClaimedAt : null,
        };
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

  return { collectBoostEvidence, getProspectDrawStatus };
}
