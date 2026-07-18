/**
 * Campaign Studio routing helpers. The Studio is the PERMANENT design surface
 * since the teardown PR (rollout completed 2026-07) — the old
 * VITE_CAMPAIGN_STUDIO_ENABLED rollout flag is gone and the route is always
 * registered. The backend write gate (DESIGN_CONFIG_V2_WRITES_ENABLED) remains
 * as the server-side emergency brake.
 */

/** Campaign types the Studio can edit. Guided-review keeps its own designer. */
export function studioSupportsCampaign(campaign) {
  return !!campaign && campaign.type !== 'guided_review';
}

export function studioPath(campaignId) {
  return `/admin/campaigns/${campaignId}/studio`;
}
