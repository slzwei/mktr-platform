/**
 * THE campaign-type registry (P4-4). Adding a campaign type = one entry here;
 * every enum site derives: the Sequelize ENUM + default (models/Campaign.js),
 * both Joi validators (middleware/validation.js), the OpenAPI CampaignType
 * schema (config/swagger.js), the marketplace-eligible subset (re-exported by
 * utils/marketplaceContent.js), the AI-drafting type enum + context labels
 * (routes/adminAi.js / campaignDetailsAiService.js), and the create default.
 *
 * Key order matters: it IS the Sequelize ENUM declaration order (test DBs
 * sync the enum from the model; prod's enum order is owned by migrations).
 *
 * Per-type flags:
 *   marketplace — the campaign can be listed on redeem.sg /offers. quiz and
 *     guided_review stay false: they have their own qualification funnels the
 *     generic marketplace flow would silently bypass.
 *   aiLabel — the context line the AI drafting prompts describe this type with.
 *
 * NOTE genuinely type-specific BEHAVIOR stays where it lives (readiness's
 * quiz/guided-review warnings, funnel rendering) — the registry removes the
 * scattered enum lists, not per-type product logic.
 */
export const CAMPAIGN_TYPES = {
  lead_generation: { marketplace: true, aiLabel: 'standard lead-generation campaign' },
  brand_awareness: { marketplace: true, aiLabel: 'brand-awareness campaign' },
  product_promotion: { marketplace: true, aiLabel: 'product-promotion campaign' },
  event_marketing: { marketplace: true, aiLabel: 'event-marketing campaign' },
  quiz: { marketplace: false, aiLabel: 'interactive personality-quiz campaign for paid social' },
  guided_review: { marketplace: false, aiLabel: 'long-form guided-review campaign that qualifies intent before a consultation' },
};

export const CAMPAIGN_TYPE_IDS = Object.keys(CAMPAIGN_TYPES);

export const DEFAULT_CAMPAIGN_TYPE = 'lead_generation';

export const MARKETPLACE_CAMPAIGN_TYPES = CAMPAIGN_TYPE_IDS.filter(
  (id) => CAMPAIGN_TYPES[id].marketplace
);

/**
 * The AI drafting surface accepts one PSEUDO-type on top of the real enum:
 * 'lucky_draw' is not a campaigns.type value (a draw is a lead_generation
 * campaign with luckyDraw config) but the drafting prompts need its distinct
 * context, and the workspace create flow offers it as a first-class pick.
 */
export const AI_CAMPAIGN_TYPE_IDS = [...CAMPAIGN_TYPE_IDS, 'lucky_draw'];

export const AI_TYPE_LABELS = {
  ...Object.fromEntries(CAMPAIGN_TYPE_IDS.map((id) => [id, CAMPAIGN_TYPES[id].aiLabel])),
  lucky_draw: 'lucky-draw campaign (verified entries, one winner pool, optional session boost)',
};
