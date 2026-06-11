/**
 * Agent provenance helpers — which external app owns a mirrored agent row.
 *
 * mktr-platform mirrors agents from two source apps into its local users
 * table; the provenance columns are mutually exclusive (DB CHECK):
 *   lyfeId       → the Lyfe mobile app owns the agent (read-only here)
 *   mktrLeadsId  → the MKTR Leads app owns the agent (managed here via the
 *                  /api/mktr-leads/agents/* write-back endpoints)
 *   neither      → a legacy local row (pre-mirror invites, System Agent)
 */

export const AGENT_SOURCES = {
  LYFE: 'lyfe',
  MKTR_LEADS: 'mktr_leads',
  LOCAL: 'local',
};

export function agentSource(agent) {
  if (!agent) return AGENT_SOURCES.LOCAL;
  if (agent.lyfeId) return AGENT_SOURCES.LYFE;
  if (agent.mktrLeadsId) return AGENT_SOURCES.MKTR_LEADS;
  return AGENT_SOURCES.LOCAL;
}

export const isLyfeAgent = (agent) => agentSource(agent) === AGENT_SOURCES.LYFE;
export const isMktrLeadsAgent = (agent) => agentSource(agent) === AGENT_SOURCES.MKTR_LEADS;
export const isLocalAgent = (agent) => agentSource(agent) === AGENT_SOURCES.LOCAL;

/** Display metadata for the Source badge. */
export function sourceBadge(agent) {
  switch (agentSource(agent)) {
    case AGENT_SOURCES.LYFE:
      return { label: 'Lyfe', className: 'bg-info/10 text-info border-info/30' };
    case AGENT_SOURCES.MKTR_LEADS:
      return { label: 'MKTR Leads', className: 'bg-primary/10 text-primary border-primary/30' };
    default:
      return { label: 'Local', className: 'bg-muted text-muted-foreground border-border' };
  }
}
