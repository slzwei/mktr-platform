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

// NOTE: `tokens` above is the frozen 13-key production constant. The v2-only
// keys (inputBg, disabledBg, onDisabled, accentText, locked*, accentShadow,
// colorScheme) are deliberately ABSENT here — every call site falls back to the
// literal it used to inline, so an unprovidered v1 mount stays byte-identical.

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
      // Opaque control surfaces — the funnel previously inlined warm-cream
      // literals for these, which is why every dark preset rendered
      // near-white text on a near-white field.
      inputBg: t.inputBg,
      disabledBg: t.disabledBg,
      onDisabled: t.onDisabled,
      accentText: t.accentText,
      lockedBg: t.dark ? t.disabledBg : '#F0E7D4',
      lockedLine: t.dark ? t.line : '#E2D6BC',
      lockedInk: t.dark ? t.muted : '#A8916E',
      // Button glow derived from the campaign accent instead of the baked
      // terracotta; dark surfaces swallow a light shadow, so they get a scrim.
      accentShadow: t.dark ? 'rgba(0,0,0,.45)' : `${t.accent}2E`,
      // Drives `color-scheme` so the native caret, select popups and
      // scrollbars follow the preset instead of staying light.
      colorScheme: t.dark ? 'dark' : 'light',
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
