import { brand } from '@/lib/brand';

/**
 * Shared content-derivation for the public lead-capture page.
 *
 * `LeadCapture.jsx` (live), `pages/public/Preview.jsx` (/p/:slug admin preview),
 * and the campaign designer's inline preview all derive the SAME story-card /
 * wordmark / footer slots from `campaign.design_config` so the three surfaces
 * stay pixel-identical.
 *
 * This module returns PURE content data only — it deliberately does NOT attach
 * an `onClick` to the primary CTA. Each caller wires its own click behavior
 * (scroll-to-form, no-op, etc.) so no React refs or DOM behavior leak into the
 * shared derivation.
 */

// First significant word of the campaign name → "{word}.sg" wordmark fallback.
export function brandFromCampaignName(name) {
  if (!name) return null;
  const first = name.trim().split(/[\s—–-]+/)[0]?.toLowerCase();
  if (!first) return null;
  return `${first}.sg`;
}

// Split free text into paragraphs on blank lines.
export function paragraphsFromText(text) {
  if (!text) return [];
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/**
 * Derive the lead-capture content slots from a campaign.
 *
 * @returns {{
 *   wordmark: string | null,
 *   story: { paragraphs: string[], emphasis?: string } | null,
 *   primaryCtaData: { label: string, color?: string, enabled: boolean } | null,
 *   regulatoryFooter: string,
 *   brand: string,
 * }}
 */
export function deriveLeadCaptureContent(campaign) {
  const design = campaign?.design_config || {};

  const wordmark = design.brandWordmark || brandFromCampaignName(campaign?.name);

  // Story card sources from `storyText` ONLY. The old `storyText || formSubheadline`
  // fallback made the sub-headline render twice (once under the form headline and
  // again as a story card). `formSubheadline` now drives only the form sub-headline.
  const storyParagraphs = paragraphsFromText(design.storyText);
  const story =
    storyParagraphs.length > 0 ? { paragraphs: storyParagraphs, emphasis: design.storyEmphasis } : null;

  // Hero CTA renders only when there is hero media AND an explicit label.
  // An empty label hides the button — operators opt in by typing a label,
  // mirroring how an empty story / sub-headline renders nothing.
  const hasHeroMedia = !!(design.imageUrl || design.videoUrl);
  const heroCtaLabel = (design.heroCtaLabel || '').trim();
  const primaryCtaData =
    hasHeroMedia && heroCtaLabel ? { label: heroCtaLabel, color: design.themeColor, enabled: true } : null;

  const regulatoryFooter = design.regulatoryFooter || brand.defaultRegulatory;
  const brandFooter = design.brandFooter || brand.defaultPoweredBy;

  return { wordmark, story, primaryCtaData, regulatoryFooter, brand: brandFooter };
}
