/**
 * Canonical prospect status styling and labels.
 *
 * Covers every status key found across AdminProspects, AdminAgentDetail,
 * MyProspects, and RecentActivity so every consumer renders consistently.
 */

/** Tailwind class strings for Badge / pill styling keyed by prospect status. */
export const statusStyles = {
  new: "bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800",
  contacted: "bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800",
  meeting: "bg-violet-50 dark:bg-violet-950/30 text-violet-700 dark:text-violet-400 border-violet-200 dark:border-violet-800",
  qualified: "bg-indigo-100 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800",
  proposal: "bg-purple-100 dark:bg-purple-950/30 text-purple-700 dark:text-purple-400 border-purple-200 dark:border-purple-800",
  negotiating: "bg-pink-100 dark:bg-pink-950/30 text-pink-700 dark:text-pink-400 border-pink-200 dark:border-pink-800",
  negotiation: "bg-pink-100 dark:bg-pink-950/30 text-pink-700 dark:text-pink-400 border-pink-200 dark:border-pink-800",
  won: "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800",
  close_won: "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800",
  lost: "bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-800",
  close_lost: "bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-800",
  rejected: "bg-slate-50 dark:bg-slate-950/30 text-slate-700 dark:text-slate-400 border-slate-200 dark:border-slate-800",
};

/** Human-readable label for each status. */
export const statusLabels = {
  new: "New",
  contacted: "Contacted",
  meeting: "Meeting",
  qualified: "Qualified",
  proposal: "Proposal",
  negotiating: "Negotiating",
  negotiation: "Negotiation",
  won: "Won",
  close_won: "Won",
  lost: "Lost",
  close_lost: "Lost",
  rejected: "Rejected",
};

/**
 * Returns the Badge class string for a given prospect status.
 * Falls back to a neutral gray style for unknown statuses.
 */
export function getStatusColor(status) {
  return statusStyles[status] || "bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:border-gray-700";
}

/**
 * Formats a raw status string for display (title-cased, underscores removed).
 * Prefer statusLabels[status] when available; use this as a generic fallback.
 */
export function formatStatus(status) {
  if (!status) return "Unknown";
  if (statusLabels[status]) return statusLabels[status];
  return status.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
}
