/**
 * Switchboard admin v2 — shared vocabulary. One map per enum so the queue,
 * table chips and drawer never drift (design assumption: state is always
 * glyph/label + color, never color alone).
 */

export const PERIODS = ['7d', '30d', '90d'];

// Real prospect enums (Prospect model — verified in the design reconciliation).
export const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'proposal_sent', 'negotiating', 'won', 'lost', 'nurturing'];
export const LEAD_SOURCES = ['qr_code', 'website', 'referral', 'social_media', 'advertisement', 'direct', 'call_bot', 'other'];

export const STATUS_LABELS = {
  new: 'New',
  contacted: 'Contacted',
  qualified: 'Qualified',
  proposal_sent: 'Proposal sent',
  negotiating: 'Negotiating',
  won: '✓ Won',
  lost: 'Lost',
  nurturing: 'Nurturing',
};

// Mid-pipeline stays neutral; color is reserved for entry (new), terminal
// (won/lost) and operator signals (held/unassigned) — DS §4.
export const STATUS_CHIP_CLASS = {
  new: 'av2-chip--accent',
  contacted: '',
  qualified: '',
  proposal_sent: '',
  negotiating: '',
  won: 'av2-chip--ok',
  lost: 'av2-chip--bad',
  nurturing: '',
};

export const SOURCE_LABELS = {
  qr_code: 'QR code',
  website: 'Website',
  referral: 'Referral',
  social_media: 'Social',
  advertisement: 'Ad',
  direct: 'Direct',
  call_bot: 'Call bot',
  other: 'Other',
};

// ALL five real quarantine reasons + the reconciling `other` bucket
// (attention endpoint contract — never render a raw enum at the operator).
export const HELD_REASON_LABELS = {
  no_funded_agent: 'No funded agent',
  no_funded_external_buyer: 'No funded external buyer',
  dnc_pending: 'DNC check pending',
  dnc_registered: 'DNC-registered',
  returned_by_admin: 'Returned by admin',
  screening_pending: 'Screening call',
  screening_failed: 'Screening: not qualified',
  screening_unreachable: 'Screening: unreachable',
  other: 'Other',
};

// List chips are a fixed-width nowrap column, so long labels were truncated to
// their first two words — which turned 'Screening: not qualified' into the
// nonsense 'Screening: not'. Reasons needing a purpose-built short form say so
// here; everything else keeps the two-word rule.
const HELD_REASON_SHORT = {
  screening_failed: 'Not qualified',
  screening_unreachable: 'Unreachable',
};

/**
 * Operator-facing hold label for a lead, as { short, full }.
 *
 * A qualified lead is STILL held until its release lands (that transition is
 * atomic: assign + charge + queue delivery, all-or-nothing), so the row keeps
 * quarantineReason 'screening_pending'. Labelling it by reason alone reads as
 * "we're still calling them" — the opposite of the truth, and it hides a lead
 * that is waiting on a human. A decided verdict therefore wins the label; the
 * ◆ hold glyph already carries "held", so the short form spends its width on
 * the verdict instead of repeating it.
 */
export function heldLabel(prospect) {
  const reason = prospect?.quarantineReason || null;
  if (reason === 'screening_pending' && prospect?.screeningVerdict === 'qualified') {
    return { short: 'Qualified', full: 'Screening: qualified — awaiting delivery' };
  }
  const full = HELD_REASON_LABELS[reason] || 'Held';
  return { short: HELD_REASON_SHORT[reason] || full.split(' ').slice(0, 2).join(' '), full };
}

// utm_source → display label (matches the tracked ad platforms).
export const UTM_LABELS = {
  fb: 'Facebook',
  ig: 'Instagram',
  tiktok: 'TikTok',
  an: 'Audience Network',
  msg: 'Messenger',
};

export const PAGE_SIZE = 25;
