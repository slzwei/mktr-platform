/**
 * Campaign Studio rollout flag (Studio PR 3 — docs/plans/campaign-studio-implementation-prompt.md).
 *
 * Module-scope, baked at build time like ADMIN_V2 / CADENCES_ENABLED. While OFF
 * the /admin/campaigns/:id/studio route is not registered and the workspace
 * Design tab keeps mounting the classic DesignEditor. Flipping it ON is a
 * deliberate rollout step (PR 5) — and even then the backend refuses to persist
 * a v2 document until DESIGN_CONFIG_V2_WRITES_ENABLED flips server-side, so the
 * Studio UI alone can never mint a customer-facing v2 doc.
 */
export const CAMPAIGN_STUDIO_ENABLED = import.meta.env.VITE_CAMPAIGN_STUDIO_ENABLED === 'true';

/** Campaign types the Studio can edit. Guided-review keeps its own designer. */
export function studioSupportsCampaign(campaign) {
  return !!campaign && campaign.type !== 'guided_review';
}

export function studioPath(campaignId) {
  return `/admin/campaigns/${campaignId}/studio`;
}
