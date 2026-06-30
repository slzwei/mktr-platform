/**
 * Canonical lead-timeline model for the web — a JS port of the mktr-leads app's lib/leadMeta
 * normalizers, so the mktr.sg Activity Timeline renders the SAME kinds/labels/order as the app.
 *
 * The backend merges MKTR ProspectActivity + Supabase lead_activities into `details.timeline`
 * (`[{ origin:'mktr'|'app', row }]`, newest-first, deduped). This normalises each row to a
 * canonical entry. If the merge isn't present (EF off / older backend), it falls back to
 * `details.activities` (ProspectActivity only) — what the web showed before.
 */

/** Per-kind fallback title when a row carries no explicit title/description. */
export const KIND_TITLE = {
  lead_created: 'Lead created',
  assigned: 'Assigned',
  reassigned: 'Reassigned',
  returned: 'Returned to the queue',
  unassigned: 'Unassigned',
  held: 'Held',
  call: 'Call',
  whatsapp: 'WhatsApp',
  meeting: 'Meeting',
  email: 'Email',
  note: 'Note',
  status_changed: 'Status updated',
  won: 'Marked as Won',
  disputed: 'Marked as Disputed',
  archived: 'Archived',
  unarchived: 'Restored from archive',
  deleted: 'Lead deleted',
  account_deleted: 'Agent account deleted',
  viewed: 'Viewed',
  updated: 'Updated',
};

const LEAD_ACTIVITY_KIND = {
  call: 'call',
  whatsapp: 'whatsapp',
  meeting: 'meeting',
  email: 'email',
  note: 'note',
  won: 'won',
  status: 'status_changed',
  created: 'lead_created',
  assignment: 'assigned',
  unassignment: 'unassigned',
  deleted_by_agent: 'deleted',
  account_deleted: 'account_deleted',
  archived: 'archived',
  unarchived: 'unarchived',
  viewed: 'viewed',
};

/** The web is admin-only oversight, so a viewed row reads "Viewed by {agent}" — actor name comes
 * from the export EF's `metadata.actor_name` (the app shows "Viewed by you" to the agent instead). */
function viewedTitle(m) {
  return typeof m.actor_name === 'string' && m.actor_name ? `Viewed by ${m.actor_name}` : KIND_TITLE.viewed;
}

/** Normalise ONE Supabase lead_activities row → canonical entry (or null for config rows). */
export function normalizeLeadActivity(a) {
  if (!a || a.type === 'follow_up' || a.type === 'key_facts') return null;
  const m = a.metadata || {};
  let kind = LEAD_ACTIVITY_KIND[a.type] || 'updated';
  if (kind === 'assigned' && (m.reassigned === true || m.previous_agent_id)) kind = 'reassigned';
  if (kind === 'unassigned' && (m.returnedToHeld === true || m.returned_to_held === true)) kind = 'returned';
  if (kind === 'status_changed' && /disputed/i.test(a.description || '')) kind = 'disputed';
  return {
    id: a.id,
    kind,
    title: typeof m.title === 'string' ? m.title : kind === 'viewed' ? viewedTitle(m) : KIND_TITLE[kind],
    note: kind === 'lead_created' || kind === 'assigned' || kind === 'reassigned' ? null : a.description || null,
    outcome: typeof m.outcome === 'string' ? m.outcome : null,
    nextStep: typeof m.next_step === 'string' ? m.next_step : null,
    at: a.created_at,
  };
}

/** Normalise ONE MKTR ProspectActivity row → canonical entry. */
export function normalizeProspectActivity(a) {
  if (!a) return null;
  const m = a.metadata || {};
  const desc = (a.description || '').trim();
  let kind;
  switch (a.type) {
    case 'created':
      kind = 'lead_created';
      break;
    case 'assigned':
      kind =
        m.returnedToHeld === true || m.returned_to_held === true
          ? 'returned'
          : m.reassigned === true || m.previousAgentId || m.previous_agent_id || /re-?assign/i.test(desc)
            ? 'reassigned'
            : 'assigned';
      break;
    case 'updated':
      kind = m.quarantined === true || /^held\b/i.test(desc) ? 'held' : 'updated';
      break;
    case 'viewed':
      kind = 'viewed';
      break;
    default:
      kind = 'updated';
  }
  return { id: a.id, kind, title: desc || KIND_TITLE[kind], note: null, outcome: null, nextStep: null, at: a.createdAt };
}

/**
 * Build the unified, newest-first entry list for the web Activity Timeline from a prospect detail.
 * Prefers the merged `details.timeline` (tagged rows); falls back to ProspectActivity-only.
 */
export function buildTimeline(details) {
  if (Array.isArray(details?.timeline)) {
    return details.timeline
      .map((x) =>
        x?.origin === 'app'
          ? // Prefer the EF-computed canonical entry (single source of truth, parity-tested against
            // the app). Fall back to the local normalizer only for older backends that omit `entry`.
            (x.entry ?? normalizeLeadActivity(x.row))
          : normalizeProspectActivity(x?.row),
      )
      .filter(Boolean);
  }
  return (details?.activities || []).map(normalizeProspectActivity).filter(Boolean);
}
