/**
 * Canonical prospect status styling and labels.
 *
 * Covers every status key found across AdminProspects, AdminAgentDetail,
 * MyProspects, and RecentActivity so every consumer renders consistently.
 *
 * Hue mapping follows the Tropic canonical semantic palette
 * (see lyfe-master/.impeccable.md):
 *   new         → info (dusty slate-blue)
 *   contacted   → warning (butter)
 *   meeting     → plum
 *   qualified   → success (sage)
 *   proposal    → plum
 *   negotiating → plum (proposal-family)
 *   won         → success (sage)
 *   lost        → destructive (rust)
 *   rejected    → muted (neutral)
 *
 * Each triplet (bg / text / border) stays in a single hue family. Terracotta
 * (primary) is the spotlight color and never used here.
 */

/** Tailwind class strings for Badge / pill styling keyed by prospect status. */
export const statusStyles = {
    new: 'bg-info/10 text-info border-info/30',
    contacted: 'bg-warning/10 text-warning border-warning/30',
    meeting: 'bg-plum/10 text-plum border-plum/30',
    qualified: 'bg-success/10 text-success border-success/30',
    proposal: 'bg-plum/10 text-plum border-plum/30',
    negotiating: 'bg-plum/10 text-plum border-plum/30',
    negotiation: 'bg-plum/10 text-plum border-plum/30',
    won: 'bg-success/10 text-success border-success/30',
    close_won: 'bg-success/10 text-success border-success/30',
    lost: 'bg-destructive/10 text-destructive border-destructive/30',
    close_lost: 'bg-destructive/10 text-destructive border-destructive/30',
    rejected: 'bg-muted text-muted-foreground border-border',
};

/** Human-readable label for each status. */
export const statusLabels = {
    new: 'New',
    contacted: 'Contacted',
    meeting: 'Meeting',
    qualified: 'Qualified',
    proposal: 'Proposal',
    negotiating: 'Negotiating',
    negotiation: 'Negotiation',
    won: 'Won',
    close_won: 'Won',
    lost: 'Lost',
    close_lost: 'Lost',
    rejected: 'Rejected',
};

/**
 * Returns the Badge class string for a given prospect status.
 * Falls back to a neutral style for unknown statuses.
 */
export function getStatusColor(status) {
    return statusStyles[status] || 'bg-muted text-muted-foreground border-border';
}

/**
 * Formats a raw status string for display (title-cased, underscores removed).
 * Prefer statusLabels[status] when available; use this as a generic fallback.
 */
export function formatStatus(status) {
    if (!status) return 'Unknown';
    if (statusLabels[status]) return statusLabels[status];
    return status.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
}
