/**
 * Shared ad-pixel suppression predicate for the public lead-capture surface.
 *
 * Both the Meta Pixel (`metaPixel.shouldTrack`) and the TikTok Pixel
 * (`tiktokPixel.shouldTrackTikTok`) gate on the SAME page/preview/test-data
 * rules so the two platforms never diverge on where events fire. This encodes
 * plan invariants #5 (previewMode honoured everywhere) and #10 (customer quiz
 * UI is brand-neutral; pixels never fire on admin/preview surfaces).
 *
 * It deliberately excludes the per-pixel env checks (pixel id present, PROD vs
 * test-event-code) — those are owned by each pixel's own `shouldTrack*`.
 *
 * Never track on:
 *   - design-prototype routes under `/preview*`
 *   - the demo route `/LeadCapture/demo`
 *   - PublicPreview `/p/:slug`
 *   - any URL with `?preview=true`
 *   - test-data campaigns (`campaign.is_test_data === true`)
 *
 * Returns true ONLY for the live `/LeadCapture` page and the marketplace
 * campaign surfaces `/offers/:slug` + `/flow/:slug` (Analytics Event Taxonomy:
 * ViewContent fires at the FIRST public content surface for a campaign; every
 * other route stays suppressed). SSR-safe.
 */
/**
 * The exclusion half of the rule set, factored out so surfaces with a WIDER
 * allow-list than the campaign funnel (adroll.js — retargeting fires on the
 * browse pages too) can suppress on exactly the same terms instead of keeping
 * a second copy of these checks that can drift.
 */
export function isSuppressedSurface({ campaign, pathname, search } = {}) {
  const path = (pathname || '').toLowerCase();
  if (path === '/preview' || path.startsWith('/preview/')) return true;
  if (path.startsWith('/leadcapture/demo')) return true;
  if (path.startsWith('/p/')) return true;

  if (search) {
    try {
      const params = new URLSearchParams(search);
      if (params.get('preview') === 'true') return true;
    } catch {
      /* malformed query — ignore */
    }
  }

  return campaign?.is_test_data === true;
}

export function isTrackableLeadCapture({ campaign, pathname, search } = {}) {
  if (isSuppressedSurface({ campaign, pathname, search })) return false;

  const path = (pathname || '').toLowerCase();
  if (path === '/leadcapture') return true;
  // Marketplace campaign surfaces — a slug segment must be present.
  if (/^\/offers\/[a-z0-9-]+$/.test(path)) return true;
  if (/^\/flow\/[a-z0-9-]+$/.test(path)) return true;
  return false;
}
