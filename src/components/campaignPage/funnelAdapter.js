/**
 * v2 → funnel adapter (Campaign Studio PR 2).
 *
 * The interactive funnel components are REUSED, not rebuilt — but they read
 * `campaign.design_config.*` at the v1 flat paths internally. This adapter
 * produces (a) an adapted campaign whose design_config is the legacy view of
 * the v2 doc with the resolved theme overlaid, and (b) the exact prop bag the
 * v1 mounts pass to CampaignSignupForm — shared by LeadCapture, PublicPreview,
 * and the designer PreviewFrame so their derivations can never diverge again
 * (the old PublicPreview blue-accent/'Sign Up Now' drift).
 */
import { isV2, readLegacyView, resolveTheme } from '@/lib/designConfigV2';
import { buildFunnelTokens } from './themeContext';

export function adaptCampaignForFunnel(campaign) {
  const doc = campaign?.design_config;
  if (!isV2(doc)) {
    return { isV2Doc: false, campaign, legacy: doc || {}, theme: null, funnelTheme: null, doc: doc || {} };
  }
  const theme = resolveTheme(doc.theme || {});
  const legacy = {
    ...readLegacyView(doc),
    // The funnel's accent/font come from the RESOLVED theme (preset-aware),
    // not the raw doc — a null accent means "the preset's own accent".
    themeColor: theme.accent,
    heroFont: theme.fontId,
  };
  return {
    isV2Doc: true,
    campaign: { ...campaign, design_config: legacy },
    legacy,
    theme,
    funnelTheme: buildFunnelTokens(theme),
    doc,
  };
}

/** The shared CampaignSignupForm prop derivation (v1 defaults preserved). */
export function deriveFunnelProps(adapted, { onSubmit, previewMode = false } = {}) {
  const { legacy, campaign, doc, isV2Doc } = adapted;
  return {
    themeColor: legacy.themeColor,
    formHeadline: legacy.formHeadline || 'Get Started',
    formSubheadline: legacy.formSubheadline,
    campaignId: campaign?.id,
    campaign,
    onSubmit,
    termsContent: legacy.termsContent,
    ctaLabel: legacy.ctaText || 'Submit Now',
    previewMode,
    advertiserName: isV2Doc ? (doc.content?.advertiserName || campaign?.name) : undefined,
  };
}
