/**
 * The Lead Profile page's pure data layer (P3-3).
 *
 * These functions decide what the page SAYS — the outcome hero's headline, a
 * delivery receipt's true state, and the whole merged history timeline. They
 * are dense, they encode a lot of product judgement, and until now they were
 * module-private inside a 1,966-line component, so the only way to exercise any
 * of them was to mount the entire page with a full profile payload. In practice
 * that meant they were untested.
 *
 * Nothing here renders. Every function takes plain data and returns plain data,
 * which is what makes them worth separating: they are the part most likely to be
 * wrong and the part easiest to test directly. (MarketplaceFlow already exports
 * its helpers "for tests" — this follows that precedent.)
 *
 * Moved verbatim; no behaviour changed.
 */
import { fmtDate } from '@/lib/adminV2/format';
import { drawWindowDay } from '@/lib/adminV2/outcome';

export const SGT = 'Asia/Singapore';

export const fullName = (o) => `${o?.firstName || ''} ${o?.lastName || ''}`.trim();

export const sameName = (a, b) => fullName(a).toLowerCase() === fullName(b).toLowerCase();

// hourCycle 'h23', not hour12:false — ICU versions map the latter to h24 or
// h23 depending on runtime, so midnight was "24:xx" on some (fmtDateTime has
// the full story).
export const sgtTime = (v) => new Date(v).toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: SGT });

export const sgtDayKey = (v) => new Intl.DateTimeFormat('en-CA', { timeZone: SGT }).format(new Date(v));

export const drawWindowDayUpper = (v) => drawWindowDay(v).toUpperCase();

/** House phone display: +6591234567 → "+65 9123 4567" (root CLAUDE.md rule). */
export const fmtPhone = (v) => {
  const m = /^\+65(\d{4})(\d{4})$/.exec(String(v || ''));
  return m ? `+65 ${m[1]} ${m[2]}` : (v || null);
};

/** History rows carry a per-campaign colored dot (hover = full campaign name)
 * instead of a truncated text tag — "IPHONE" couldn't tell two iPhone
 * campaigns apart and read as a device name. Same palette + hash as the
 * Redemptions console's campaign accents, keyed by campaign id so twin-named
 * campaigns still get distinct colors. */
export const CAMPAIGN_ACCENTS = ['#0364D3', '#6A3FD1', '#8F6400', '#177239', '#BD3A2E', '#0E7490'];

export function campaignAccent(key) {
  let hash = 0;
  const s = String(key || '');
  for (let i = 0; i < s.length; i += 1) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  return CAMPAIGN_ACCENTS[hash % CAMPAIGN_ACCENTS.length];
}

export const campaignRef = (id, name) => (name || id ? { key: String(id || name), name: name || 'Unnamed campaign' } : null);

export const BOOST_VIA_COPY = { agent_scan: 'consultant scan', agent_button: 'consultant confirmation' };

export const NOT_ELIGIBLE_COPY = {
  no_phone: 'no phone on record',
  phone_unverified: 'phone unverified',
  terms_not_pinned: 'draw terms not accepted',
  signed_up_after_close: 'signed up after entries closed',
};

/** Client-side twin of the backend's `phoneVerificationEvidence` — used only
 * for the no-linked-person fallback row, which is composed from the prospect
 * the page already holds rather than from a person payload. */
export const STAMP_EPOCH_MS = Date.parse('2026-07-10T00:00:00Z');

export function evidenceOf(prospect) {
  if (prospect?.sourceMetadata?.phoneVerifiedAt) return 'verified';
  const t = prospect?.createdAt ? Date.parse(prospect.createdAt) : NaN;
  return Number.isFinite(t) && t < STAMP_EPOCH_MS ? 'unrecorded' : 'unverified';
}

export const DIAGNOSTIC_COPY = {
  no_active_activation: 'no reward attached to this campaign',
  allocation_exhausted: 'quota full',
  phone_not_verified: 'phone unverified',
  no_phone: 'no phone on record',
  duplicate_phone: 'this phone already holds one',
  offer_not_active: 'offer paused',
  activation_ended: 'activation ended',
  quarantined: 'lead is held',
  not_issued_yet: 'issuance sweep hasn’t landed',
  // NOT "phone unverified": this signup predates the server-side OTP stamp
  // (2026-07-09), and the public form has never let an unverified phone
  // submit. The proof is missing, the verification probably wasn't.
  verification_not_recorded: 'signed up before we recorded OTP proof',
};

/**
 * The outcome hero — the loudest element of a drill-in (24px/800). Returns
 * { big, tail, tone, meta } in the exact lifecycle-honest voices of the
 * backend contract; `tone` ∈ ink | ok | quiet.
 */
export function heroFor(draw, rewards, diagnostic) {
  if (draw) {
    switch (draw.state) {
      case 'provisional_in':
        return draw.boosted
          ? { big: `On track for ×${draw.multiplier}`, tail: ` — ${BOOST_VIA_COPY[draw.boostVia] || 'boost'} recorded`, tone: 'ink', meta: draw.closesAt ? `CLOSES ${drawWindowDayUpper(draw.closesAt)}` : null }
          : { big: '1 chance so far', tail: ' — boost window open', tone: 'ink', meta: (draw.boostClosesAt || draw.closesAt) ? `BOOST BY ${drawWindowDayUpper(draw.boostClosesAt || draw.closesAt)}` : null };
      case 'provisional_out':
        return { big: 'Not counted yet', tail: ` — ${NOT_ELIGIBLE_COPY[draw.notEligibleReason] || 'not eligible'}`, tone: 'quiet', meta: draw.closesAt ? `CLOSES ${drawWindowDayUpper(draw.closesAt)}` : null };
      case 'frozen_in':
        return { big: 'In the pool', tail: draw.boosted ? ` — ×${draw.multiplier} boost applies at seal` : ' — 1 chance', tone: 'ink', meta: 'FROZEN' };
      case 'excluded_at_freeze':
        return { big: 'Excluded at freeze', tail: '', tone: 'quiet', meta: null };
      case 'sealed': {
        const n = draw.chances;
        const chances = `${n} chance${n === 1 ? '' : 's'}`;
        const o = draw.outcome;
        if (!o) return { big: chances, tail: ' — sealed', tone: 'ink', meta: 'SEALED' };
        switch (o.status) {
          case 'selected_pending': return { big: 'Selected', tail: ` — claim by ${fmtDate(o.claimDeadline)}`, tone: 'ink', meta: `ATTEMPT ${o.attemptNo}` };
          case 'selected_claimed': return { big: '🏆 Winner', tail: ` — claimed ${fmtDate(o.claimedAt)}`, tone: 'ok', meta: null };
          case 'not_selected_final': return { big: 'Not selected', tail: ` — ${chances}`, tone: 'quiet', meta: null };
          case 'not_selected_yet': return { big: chances, tail: ' — draw in progress', tone: 'ink', meta: null };
          default: return { big: `Selected — ${o.status.replace('selected_', '')}`, tail: ', redrawn', tone: 'quiet', meta: `ATTEMPT ${o.attemptNo}` };
        }
      }
      case 'void': return { big: 'Draw void', tail: '', tone: 'quiet', meta: null };
      case 'erased_draw_unavailable': return { big: '⊘ Draw record unavailable', tail: '', tone: 'quiet', meta: 'ERASED' };
      case 'no_draw_record': return { big: 'Draw configured', tail: ' — no draw record yet', tone: 'quiet', meta: null };
      default: break;
    }
  }
  const ent = rewards?.[0];
  if (ent) {
    const title = ent.rewardTitle ? ` — ${ent.rewardTitle}` : '';
    switch (ent.state) {
      case 'reserved': return { big: 'Reserved', tail: title, tone: 'ink', meta: ent.expiresAt ? `EXPIRES ${fmtDate(ent.expiresAt).toUpperCase()}` : null };
      case 'unlocked': return { big: 'Unlocked', tail: title, tone: 'ok', meta: ent.expiresAt ? `VOUCHER UNTIL ${fmtDate(ent.expiresAt).toUpperCase()}` : null };
      case 'redeemed': return { big: 'Redeemed ✓', tail: title, tone: 'ok', meta: ent.redeemedAt ? fmtDate(ent.redeemedAt).toUpperCase() : null };
      case 'expired': return { big: 'Expired', tail: title, tone: 'quiet', meta: null };
      case 'blocked': return { big: 'Blocked', tail: title, tone: 'quiet', meta: null };
      default: return { big: ent.state || ent.status, tail: title, tone: 'quiet', meta: null };
    }
  }
  if (diagnostic) {
    return diagnostic === 'not_issued_yet'
      ? { big: 'Reward pending', tail: ` — ${DIAGNOSTIC_COPY[diagnostic]}`, tone: 'quiet', meta: null }
      : { big: 'No reward', tail: ` — ${DIAGNOSTIC_COPY[diagnostic] || diagnostic}`, tone: 'quiet', meta: null };
  }
  return { big: 'No outcome recorded', tail: '', tone: 'quiet', meta: null };
}

// Post-acceptance truth (wa-delivery-truth): a receipt's base state means the
// provider ACCEPTED the message — only the joined status inbox can prove
// delivered/read, or surface Meta's silent drops (131049 = the per-user
// marketing frequency cap that ate real boost receipts). Deliberately words,
// not glyphs — a ✓ reads as "delivered" no matter what it technically meant —
// and every state carries a hover explanation (native title).
export function deliveryState(r) {
  if (!r) return null;
  if (!r.ok) {
    return {
      ok: false,
      text: 'failed to send',
      hint: `Rejected before it left our system${r.error ? `: ${r.error}` : ''}.`,
    };
  }
  const st = r.delivery?.status;
  if (st === 'failed') {
    const capped = String(r.delivery?.errorCode) === '131049';
    return {
      ok: false,
      text: capped ? 'not delivered (Meta marketing limit)' : 'not delivered',
      hint: capped
        ? "Meta accepted it, then dropped it — this person hit Meta's per-person marketing message limit. Retries fail until the window clears; use email or a link."
        : `Meta reported it undelivered${r.delivery?.errorTitle ? `: ${r.delivery.errorTitle}` : r.delivery?.errorCode ? ` (code ${r.delivery.errorCode})` : ''}.`,
    };
  }
  if (st === 'read') {
    return { ok: true, text: 'read', hint: 'Opened by the recipient on WhatsApp.' };
  }
  if (st === 'delivered') {
    return { ok: true, text: 'delivered', hint: "Delivered to the recipient's device." };
  }
  if (st === 'sent') {
    return { ok: true, text: 'sent, delivery pending', hint: 'Dispatched by Meta — delivery not confirmed yet.' };
  }
  return {
    ok: true,
    text: 'accepted',
    hint: 'Accepted by the provider. Delivery is not confirmed for this message.',
  };
}

export function receiptBits(delivery) {
  if (!delivery) return [];
  const bit = (r, prefix) => {
    const s = deliveryState(r);
    return s ? { ok: s.ok, prefix, state: s } : null;
  };
  return [bit(delivery.email, 'pass emailed'), bit(delivery.whatsapp, 'WhatsApp')].filter(Boolean);
}

// Voucher/pass lifecycle rows (lead-history-completeness). `drawLinked`
// decides the noun — event metadata alone can't (draw lookups fail open on
// the writer side).
export const RESEND_NOUNS = { resend_pass: 'Pass', resend_voucher: 'Voucher', resend_boost: 'Boost receipt' };

export function lifecycleRow(ev, e) {
  const noun = e.drawLinked ? 'Pass' : 'Voucher';
  if (ev.type === 'verify_attempt') {
    return { title: e.drawLinked ? 'Pass scanned by consultant' : 'Voucher scanned at merchant', quiet: true, family: 'reward' };
  }
  if (ev.type === 'rejected') {
    return { title: 'Scan rejected — not redeemable', quiet: true, family: 'reward', tone: 'bad' };
  }
  if (ev.type === 'unlock_reversed') {
    return { title: 'Draw boost undone', detail: ev.reason ? ` — ${ev.reason}` : null, family: 'unassignment' };
  }
  if (ev.type === 'reversed') {
    return { title: `Redemption voided${ev.actorName ? ` by ${ev.actorName}` : ''}`, family: 'reward', tone: 'bad' };
  }
  if (ev.type === 'expired') {
    // The sweep only expires ELIGIBLE rows — this event is reservation expiry.
    return { title: e.drawLinked ? 'Draw pass expired' : 'Reservation expired', quiet: true, family: 'generic' };
  }
  if (ev.type === 'manual_override') {
    if (ev.action === 'cancelled') {
      return { title: `Cancelled${ev.actorName ? ` by ${ev.actorName}` : ''}`, detail: ev.reason ? ` — ${ev.reason}` : null, family: 'reward', tone: 'bad' };
    }
    if (ev.action === 'auto_resend') {
      return { title: `${noun} resend retried automatically`, quiet: true, family: 'delivery' };
    }
    if (RESEND_NOUNS[ev.action]) {
      const via = ev.channel === 'link' ? 'share link issued' : ev.channel ? `via ${ev.channel}` : '';
      return {
        // "initiated", deliberately — the audit row commits before the
        // fire-and-forget send; the delivery receipt rows carry the outcome.
        title: `${RESEND_NOUNS[ev.action]} resend initiated${ev.actorName ? ` by ${ev.actorName}` : ''}`,
        detail: via ? ` — ${via}` : null,
        quiet: true,
        family: 'delivery',
      };
    }
  }
  return null;
}

export const OUTCOME_LAPSE_COPY = {
  selected_unclaimed: 'not claimed in time',
  selected_unreachable: 'could not be reached',
  selected_ineligible: 'ineligible',
  selected_declined: 'declined the prize',
};

export function buildHistory(p, journey) {
  const events = [];
  const push = (at, title, { detail = null, family = 'generic', quiet = false, campaign = null, state = null, tone = null } = {}) => {
    const t = at ? Date.parse(at) : NaN;
    if (!Number.isNaN(t)) events.push({ at: t, title, detail, family, quiet, campaign, state, tone });
  };
  const anchorCampaign = campaignRef(p.campaign?.id, p.campaign?.name);

  // Journey signups carry NAMED assignment events (backend resolves the agent
  // uuid); when present they replace the anchor's raw "Assigned to agent
  // <uuid>" activity rows, which would otherwise duplicate them unreadably.
  const journeyHasAssignments = (journey?.signups || []).some((s) => s.assignments?.length);
  const rows = (Array.isArray(p.timeline)
    ? p.timeline.map((x) => ({
      at: x.row?.createdAt || x.row?.created_at,
      label: x.entry?.label || x.row?.description || x.row?.type || 'activity',
      type: x.row?.type || null,
    }))
    : (p.activities || []).map((a) => ({ at: a.createdAt, label: a.description || a.type, type: a.type || null }))
  ).filter((r) => !(journeyHasAssignments && r.type === 'assigned'));
  for (const r of rows) push(r.at, r.label, { quiet: true, campaign: anchorCampaign });

  for (const s of journey?.signups || []) {
    const campaign = campaignRef(s.campaign?.id, s.campaign?.name);
    push(s.createdAt, `Signed up as ${fullName(s) || '—'}`, { detail: s.campaign?.name ? ` — ${s.campaign.name}` : null, family: 'signup', campaign });
    for (const a of s.assignments || []) {
      if (a.kind === 'returned_to_held') {
        push(a.at, 'Returned to held', {
          detail: a.agentName ? ` — taken back from ${a.agentName}` : null,
          family: 'unassignment', campaign,
        });
      } else if (a.kind === 'unassigned') {
        push(a.at, `Unassigned${a.agentName ? ` from ${a.agentName}` : ''}`, {
          family: 'unassignment', campaign,
        });
      } else {
        push(a.at, `Assigned to ${a.agentName || (a.external ? 'an MKTR Leads buyer' : 'an agent')}`, {
          detail: a.external ? ' — external buyer' : null,
          family: 'assignment', campaign,
        });
      }
    }
    if (s.draw?.boostedAt) {
      push(s.draw.boostedAt, 'Draw boost recorded', { detail: ` — ${BOOST_VIA_COPY[s.draw.boostVia] || 'boost'}`, family: 'boost', campaign });
    }
    // Draw result (lead-history-completeness): selection at drawnAt, its
    // resolution (claim / lapse) at outcomeAt — never timeline a lapse at the
    // draw moment. Missing timestamps skip the row rather than invent one.
    const oc = s.draw?.outcome;
    if (oc?.status?.startsWith('selected_')) {
      if (oc.drawnAt) {
        push(oc.drawnAt, 'Selected in the draw', {
          detail: oc.attemptNo > 1 ? ` — redraw ${oc.attemptNo}` : null,
          family: 'outcome', campaign,
        });
      }
      if (oc.status === 'selected_claimed' && (oc.claimedAt || oc.outcomeAt)) {
        push(oc.claimedAt || oc.outcomeAt, 'Prize claimed', { family: 'outcome', campaign });
      } else if (OUTCOME_LAPSE_COPY[oc.status] && oc.outcomeAt) {
        push(oc.outcomeAt, 'Selection lapsed', { detail: ` — ${OUTCOME_LAPSE_COPY[oc.status]}`, family: 'outcome', tone: 'bad', campaign });
      }
    } else if (oc?.status === 'not_selected_final' && oc.outcomeAt) {
      push(oc.outcomeAt, 'Not selected in the draw', { quiet: true, family: 'generic', campaign });
    }
  }
  // Consumer-less (B4) leads carry their entitlements on signupProfile — the
  // same lifecycle events must render for them too.
  const entList = journey?.entitlements?.length ? journey.entitlements : (p.signupProfile?.entitlements || []);
  for (const e of entList) {
    const campaign = campaignRef(e.campaignId, e.campaignName);
    const title = e.rewardTitle || 'reward';
    push(e.createdAt, e.drawLinked ? 'Draw pass reserved' : 'Reward reserved', { detail: e.drawLinked ? null : ` — ${title}`, family: 'reward', quiet: true, campaign });
    if (e.unlockedAt) push(e.unlockedAt, e.drawLinked ? 'Draw boost confirmed' : 'Voucher unlocked', { detail: e.drawLinked ? null : ` — ${title}`, family: e.drawLinked ? 'boost' : 'reward', campaign });
    if (e.redeemedAt) push(e.redeemedAt, 'Voucher redeemed ✓', { detail: ` — ${title}`, family: 'reward', campaign });
    if (e.claimViews?.firstAt) {
      // First open only, with the total — a refresh-happy customer is one row.
      push(e.claimViews.firstAt, `Opened their reward link${e.claimViews.count > 1 ? ` — ×${e.claimViews.count} views` : ''}`, { family: 'arrival', quiet: true, campaign });
    }
    for (const ev of e.events || []) {
      const row = lifecycleRow(ev, e);
      if (row) push(ev.at, row.title, { detail: row.detail || null, family: row.family, quiet: row.quiet || false, tone: row.tone || null, campaign });
    }
    // Issued vouchers expire WITHOUT a ledger event (the sweep only touches
    // eligible rows) — derive the row from expiresAt.
    if (!e.drawLinked && e.status === 'issued' && !e.redeemedAt && e.expiresAt && Date.parse(e.expiresAt) < Date.now()) {
      push(e.expiresAt, 'Voucher expired', { detail: ` — ${title}`, family: 'generic', quiet: true, campaign });
    }
    for (const ch of ['email', 'whatsapp']) {
      const r = e.delivery?.[ch];
      if (!r?.at) continue;
      push(r.at, `${(r.kind || 'pass').replace(/_/g, ' ')} ${ch === 'email' ? 'emailed' : 'WhatsApp'} — `, { family: 'delivery', quiet: true, campaign, state: deliveryState(r) });
    }
  }
  // Consent lifecycle (contact kind, source-allowlisted server-side).
  for (const c of journey?.consentTimeline || []) {
    if (c.granted === false) {
      const via = c.via === 'wa_stop' ? 'WhatsApp STOP' : c.via === 'unsubscribe_link' ? 'unsubscribe link' : (c.via || 'unsubscribe');
      push(c.at, 'Marketing consent withdrawn', { detail: ` — ${via}`, family: 'consent', tone: 'bad' });
    } else {
      push(c.at, 'Marketing consent re-granted', { family: 'consent' });
    }
  }
  if (journey?.consumer?.erasedAt) {
    push(journey.consumer.erasedAt, 'Erased under PDPA', { detail: ' — personal data removed', family: 'unassignment', tone: 'bad' });
  }
  for (const b of journey?.broadcasts?.recent || []) {
    push(b.sentAt || b.at, `Marketing email — ${b.status}${b.reason ? ` (${b.reason.replace(/_/g, ' ')})` : ''}`, { family: 'delivery', quiet: true });
  }
  for (const ld of p.lyfeDelivery || []) {
    push(ld.at, `Lyfe ${ld.eventType.replace('lead.', '')} — ${ld.status}${ld.reason ? ` (${ld.reason.replace(/_/g, ' ')})` : ''}`, { family: 'delivery', quiet: true, campaign: anchorCampaign });
  }
  if (p.session?.startedAt) {
    push(p.session.startedAt, `Arrived — ${p.session.landingPath || 'landing page'}`, { family: 'arrival', quiet: true, campaign: anchorCampaign });
  }
  for (const a of Object.values(p.screeningMetadata?.attempts || {})) {
    if (!a?.startedAt) continue;
    const outcome = (a.outcome || 'attempted').replace(/_/g, ' ');
    push(a.startedAt, `Screening call — ${outcome}`, { family: 'screening', quiet: a.outcome !== 'qualified', campaign: anchorCampaign });
  }
  return events.sort((a, b) => b.at - a.at);
}
