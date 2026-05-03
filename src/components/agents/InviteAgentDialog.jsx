/**
 * Re-export of AgentFormDialog used in invite mode (agent === null).
 *
 * The existing AgentFormDialog already handles both"invite"and"edit"modes
 * based on whether an `agent` prop is provided, so this file simply re-exports
 * it under a semantic alias for clarity in the orchestrator page.
 *
 * Usage:
 * <InviteAgentDialog open={…} onOpenChange={…} agent={null} onSubmit={…} />
 * <InviteAgentDialog open={…} onOpenChange={…} agent={selectedAgent} onSubmit={…} />
 */
export { default } from"./AgentFormDialog";
