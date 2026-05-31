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
 * Returns true ONLY for the live `/LeadCapture` page. SSR-safe.
 */
export function isTrackableLeadCapture({ campaign, pathname, search } = {}) {
  const path = (pathname || '').toLowerCase();
  if (path === '/preview' || path.startsWith('/preview/')) return false;
  if (path.startsWith('/leadcapture/demo')) return false;
  if (path.startsWith('/p/')) return false;

  if (search) {
    try {
      const params = new URLSearchParams(search);
      if (params.get('preview') === 'true') return false;
    } catch {
      /* malformed query — ignore */
    }
  }

  if (campaign?.is_test_data === true) return false;

  return path === '/leadcapture';
}
