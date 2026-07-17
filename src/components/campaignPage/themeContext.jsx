/**
 * Campaign funnel theme context (Campaign Studio PR 2).
 *
 * The interactive funnel components (FieldRenderer, OTPVerification,
 * CampaignSignupForm, CampaignQuiz, MarketingConsentDialog) historically
 * imported the frozen warm-cream TOKENS/RADIUS constants statically. They now
 * read this context instead — with a DEFAULT equal to those exact constants,
 * so every v1 mount renders byte-identically WITHOUT a provider. The v2
 * template renderer wraps the funnel in a provider fed from the design_config
 * v2 theme (`buildFunnelTokens(resolveTheme(doc.theme))`).
 *
 * Deliberately NOT themed (fixed palettes by design): DncConsentGate (the
 * editorial-seal card), TypingLoader, ShareCampaignDialog, and the v1-only
 * LeadCaptureLayout itself.
 *
 * `radius` carries BOTH the semantic v2 names (input/btn/media/check) and the
 * legacy v1 aliases (pill/image/checkbox) so existing call sites keep working
 * unchanged under the alias pattern:
 *   const { tokens: TOKENS, radius: RADIUS } = useCampaignTheme();
 */
import { createContext, useContext } from 'react';
import { TOKENS, RADIUS } from '@/components/campaigns/LeadCaptureLayout';

export const DEFAULT_CAMPAIGN_THEME = Object.freeze({
  tokens: TOKENS,
  radius: Object.freeze({
    // legacy v1 names (existing call sites)
    pill: RADIUS.pill,
    card: RADIUS.card,
    modal: RADIUS.modal,
    image: RADIUS.image,
    checkbox: RADIUS.checkbox,
    // semantic v2 names
    input: RADIUS.pill,
    btn: RADIUS.pill,
    media: RADIUS.image,
    check: RADIUS.checkbox,
  }),
  // Production accent buttons hardcoded white; the warm accents all pass the
  // white floor, so this default is visually identical for v1.
  onAccent: '#ffffff',
});

const CampaignThemeContext = createContext(DEFAULT_CAMPAIGN_THEME);
export const CampaignThemeProvider = CampaignThemeContext.Provider;
export const useCampaignTheme = () => useContext(CampaignThemeContext);

/**
 * Map a resolveTheme() result (src/lib/designConfigV2.js) onto the funnel
 * token shape (same key names as the legacy TOKENS constant, so the alias
 * pattern themes every existing style expression).
 */
export function buildFunnelTokens(t) {
  return {
    tokens: {
      pagebg: t.bg,
      storyCard: t.storyCard,
      formCard: t.card,
      modal: t.modal,
      ink: t.ink,
      body: t.bodyText,
      muted: t.muted,
      hairline: t.line,
      divider: t.divider,
      accent: t.accent,
      accentDeep: t.accentDeep,
      required: t.danger,
      success: t.success,
    },
    radius: {
      pill: t.r.btn === 999 ? 999 : t.r.btn,
      card: t.r.card,
      modal: t.r.modal,
      image: t.r.media,
      checkbox: t.r.check,
      input: t.r.input,
      btn: t.r.btn,
      media: t.r.media,
      check: t.r.check,
    },
    onAccent: t.onAccent,
  };
}
