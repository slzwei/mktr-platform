/**
 * Campaign-outcome voice — THE one place the compact outcome chips are worded
 * (docs/plans/admin-prospects-outcome-column.md). Consumed by the Prospects
 * list's STATUS column and the Lead Profile's campaigns rail, so the two can
 * never drift. Facts come from the backend (`draw` block per signup/row +
 * newest non-draw-linked entitlement); this module only chooses words.
 */

const SGT = 'Asia/Singapore';

/** "30 Sep" in SGT. */
export const sgtDayMonth = (v) => new Date(v).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', timeZone: SGT });

/**
 * Draw windows are stored as SGT end-of-day EXCLUSIVE instants (the first
 * moment AFTER the window — sgtTime.js); the operator-facing day is the last
 * INCLUDED instant, one ms earlier.
 */
export const drawWindowDay = (v) => sgtDayMonth(new Date(new Date(v).getTime() - 1));

export const REWARD_STATE_COPY = {
  reserved: { tone: 'accent', label: 'Reserved' },
  unlocked: { tone: 'ok', label: 'Unlocked' },
  redeemed: { tone: 'ok', label: 'Redeemed ✓' },
  expired: { tone: '', label: 'Expired' },
  cancelled: { tone: '', label: 'Cancelled' },
  blocked: { tone: 'bad', label: 'Blocked' },
};

/**
 * Compact status chip for a lead row: `{ label, tone }` in its campaign's own
 * voice, or null when there is no outcome to speak of. Draw voice wins over
 * reward voice (a draw campaign's entitlement is the entry pass, not a
 * voucher — the backend already excludes draw-linked entitlements from
 * `rewards`).
 */
export function rowChipFor(draw, rewards) {
  if (draw) {
    switch (draw.state) {
      case 'provisional_in': {
        const closes = draw.closesAt ? ` · closes ${drawWindowDay(draw.closesAt)}` : '';
        // Boosted leads carry the multiplier — "open" alone hides the fact
        // that the ×N is already earned.
        return draw.boosted
          ? { label: `×${draw.multiplier}${closes}`, tone: 'ok' }
          : { label: `open${closes}`, tone: '' };
      }
      case 'provisional_out': return { label: 'not counted', tone: 'warn' };
      case 'frozen_in': return { label: draw.boosted ? `in the pool · ×${draw.multiplier} at seal` : 'in the pool', tone: '' };
      case 'excluded_at_freeze': return { label: 'excluded', tone: 'warn' };
      case 'sealed': {
        const s = draw.outcome?.status;
        if (s === 'selected_claimed') return { label: '🏆 winner', tone: 'ok' };
        if (s === 'selected_pending') return { label: 'selected', tone: 'accent' };
        if (s === 'not_selected_final') return { label: 'not selected', tone: '' };
        return { label: `sealed · ${draw.chances} chance${draw.chances === 1 ? '' : 's'}`, tone: '' };
      }
      case 'void': return { label: 'void', tone: '' };
      case 'erased_draw_unavailable': return { label: '⊘ erased', tone: 'bad' };
      case 'no_draw_record': return { label: 'no draw record', tone: 'warn' };
      default: break;
    }
  }
  const ent = rewards?.[0];
  if (ent) {
    const known = REWARD_STATE_COPY[ent.state];
    if (known) {
      return { label: known.label === 'Redeemed ✓' ? '✓ redeemed' : known.label.toLowerCase(), tone: known.tone };
    }
    return { label: ent.state || ent.status, tone: '' };
  }
  return null;
}
