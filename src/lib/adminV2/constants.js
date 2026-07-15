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
  other: 'Other',
};

// utm_source → display label (matches the tracked ad platforms).
export const UTM_LABELS = {
  fb: 'Facebook',
  ig: 'Instagram',
  tiktok: 'TikTok',
  an: 'Audience Network',
  msg: 'Messenger',
};

export const PAGE_SIZE = 25;
