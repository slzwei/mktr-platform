/**
 * Redeem Ops Fresha-language primitives (design source of truth:
 * claude.ai/design "Redeem Ops Design System"). Pure presentational helpers —
 * behaviour stays in shadcn/Radix components, which pick up the theme via the
 * variables in src/styles/redeem-ops-theme.css.
 */
import { cn } from '@/lib/utils';

/* Display labels for Redeem Ops sub-roles — mirrors backend
   services/redeemOps/constants.js SUB_ROLE_LABELS (display-only). */
const RO_ROLE_LABELS = {
  super_admin: 'Super Admin',
  ops_admin: 'Ops Admin',
  bdm: 'Business Development Manager',
  outreach_exec: 'Outreach Executive',
  campaign_ops: 'Campaign Ops',
  redemption_ops: 'Redemption Ops',
  analyst: 'Analyst',
};

/** Human title for the signed-in principal shown in the account menu. */
export function roRoleLabel(user) {
  if (!user) return '';
  if (user.role === 'admin') return 'Administrator';
  return RO_ROLE_LABELS[user.redeemOpsRole] || 'Redeem Ops';
}

/** Sentence-case a SCREAMING_SNAKE enum: MEETING_BOOKED → "Meeting booked". */
export function prettyEnum(value) {
  if (!value) return '';
  const s = String(value).replaceAll('_', ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* 14 pipeline stages → six pastel families (stage-tags card). */
const STAGE_TAG = {
  UNCLAIMED: 'ro-tag--outline',
  CLAIMED: 'ro-tag--gray',
  RESEARCHING: 'ro-tag--gray',
  CONTACTED: 'ro-tag--yellow',
  REPLIED: 'ro-tag--blue',
  MEETING_BOOKED: 'ro-tag--blue',
  MEETING_COMPLETED: 'ro-tag--blue',
  PROPOSAL_SENT: 'ro-tag--purple',
  NEGOTIATING: 'ro-tag--purple',
  PARTNERED: 'ro-tag--green',
  FOLLOW_UP_LATER: 'ro-tag--yellow ro-tag--faded',
  NO_RESPONSE: 'ro-tag--yellow ro-tag--faded',
  NOT_INTERESTED: 'ro-tag--gray ro-tag--faded',
  DISQUALIFIED: 'ro-tag--red',
};

export function RoStageTag({ stage, size, className }) {
  return (
    <span className={cn('ro-tag', STAGE_TAG[stage] || 'ro-tag--gray', size === 'sm' && 'ro-tag--sm', className)}>
      {prettyEnum(stage)}
    </span>
  );
}

/* Generic status/priority tag; tone keys cover every enum the pages render. */
const TONE_TAG = {
  // reward / activation status
  active: 'ro-tag--green',
  draft: 'ro-tag--gray',
  paused: 'ro-tag--yellow',
  ended: 'ro-tag--gray ro-tag--faded',
  archived: 'ro-tag--gray ro-tag--faded',
  // tasks
  open: 'ro-tag--blue',
  completed: 'ro-tag--green',
  cancelled: 'ro-tag--gray ro-tag--faded',
  // priority
  high: 'ro-tag--red',
  medium: 'ro-tag--yellow',
  low: 'ro-tag--gray',
  // onboarding
  done: 'ro-tag--green',
  in_progress: 'ro-tag--blue',
  pending: 'ro-tag--outline',
  na: 'ro-tag--gray ro-tag--faded',
  // entitlements / redemptions
  reserved: 'ro-tag--yellow',
  issued: 'ro-tag--blue',
  redeemed: 'ro-tag--green',
  expired: 'ro-tag--gray ro-tag--faded',
  void: 'ro-tag--red ro-tag--faded',
  // misc
  primary: 'ro-tag--blue',
  inactive: 'ro-tag--gray ro-tag--faded',
};

export function RoTag({ tone, size, className, children }) {
  return (
    <span className={cn('ro-tag', TONE_TAG[tone] || 'ro-tag--gray', size === 'sm' && 'ro-tag--sm', className)}>
      {children}
    </span>
  );
}

/* Deterministic pastel avatar — same person, same colour, every screen. */
const AVATAR_PALETTES = [
  { bg: '#E5F1FF', fg: '#0364D3' },
  { bg: '#F0EAFE', fg: '#6A3FD1' },
  { bg: '#E3F5E9', fg: '#177239' },
  { bg: '#FFF2D6', fg: '#8F6400' },
  { bg: '#FDEAE8', fg: '#BD3A2E' },
  { bg: '#F0F2F4', fg: '#4C555E' },
];

export function roInitials(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '—';
  const first = words[0][0] || '';
  const second = words.length > 1 ? words[words.length - 1][0] || '' : words[0][1] || '';
  return (first + second).toUpperCase();
}

export function RoAvatar({ name, size = 36, className, title }) {
  let hash = 0;
  const s = String(name || '');
  for (let i = 0; i < s.length; i += 1) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  const palette = AVATAR_PALETTES[hash % AVATAR_PALETTES.length];
  return (
    <span
      className={cn('ro-avatar', className)}
      title={title ?? (name || undefined)}
      style={{
        width: size,
        height: size,
        background: palette.bg,
        color: palette.fg,
        fontSize: Math.max(9, Math.round(size * 0.36)),
      }}
    >
      {roInitials(name)}
    </span>
  );
}

/* Owner chip: avatar + first name, or a quiet dash when unowned. */
export function RoOwner({ name, size = 24 }) {
  if (!name) return <span className="text-sm" style={{ color: 'var(--ro-text-3)' }}>—</span>;
  return (
    <span className="inline-flex items-center gap-2 text-sm">
      <RoAvatar name={name} size={size} />
      {name.split(/\s+/)[0]}
    </span>
  );
}

export function RoPageHeader({ title, sub, actions, className }) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-4', className)}>
      <div className="min-w-0">
        <h1 className="ro-title">{title}</h1>
        {sub && <p className="ro-sub">{sub}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}

export function RoStatTile({ value, label, hot }) {
  return (
    <div className={cn('ro-tile', hot && value > 0 && 'ro-tile--hot')}>
      <b>{value}</b>
      <span>{label}</span>
    </div>
  );
}

export function RoEmpty({ title, body, children, className }) {
  return (
    <div className={cn('rounded-2xl border border-border px-8 py-10 text-center', className)}>
      <div
        className="ro-icon-circle mx-auto mb-3"
        style={{ width: 48, height: 48, background: 'var(--ro-tag-green-bg)', color: 'var(--ro-tag-green-fg)', fontSize: 20 }}
        aria-hidden="true"
      >
        ✓
      </div>
      <p className="font-bold text-base m-0">{title}</p>
      {body && <p className="text-sm mt-1 mb-4" style={{ color: 'var(--ro-text-2)' }}>{body}</p>}
      {children}
    </div>
  );
}
