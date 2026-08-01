/**
 * THE campaign/marketplace slug contract (P4-1). One regex, five former
 * copies (Campaign model validate, marketplaceService ×2, campaignService,
 * campaignCopyAiService) — drift here silently breaks the slug-lock contract,
 * so every consumer imports this.
 */
export const SLUG_RE = /^[a-z0-9-]{3,80}$/;

export function isValidSlug(value) {
  return typeof value === 'string' && SLUG_RE.test(value);
}
