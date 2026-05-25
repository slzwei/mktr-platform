// Build-time brand resolution for the MKTR / Redeem dual-frontend setup.
//
// Two Render Static Sites are built from the same git commit but with
// different VITE_BRAND values: mktr.sg → mktr, redeem.sg → redeem.
//
// The redeem build intentionally hides MKTR marketing surfaces but keeps
// the legal-entity reference (MKTR PTE. LTD., UEN 202507548M) per D3.
//
// Build-time isolation: the alias `@brand-config` is resolved by Vite to
// either ./brandConfigs/mktr.js or ./brandConfigs/redeem.js based on the
// VITE_BRAND env var (see vite.config.js). That guarantees only the active
// brand's strings land in the production bundle — the plan's acceptance
// test (grep dist/ for the opposite brand) depends on this.

import brandConfig from '@brand-config';

const BRAND = import.meta.env.VITE_BRAND || 'mktr';

export const brand = brandConfig;
export const BRAND_ID = BRAND;
export const isMktr = () => BRAND === 'mktr';
export const isRedeem = () => BRAND === 'redeem';

// Customer-facing public host. ALL customer-facing surfaces (lead capture
// forms, QR tracker URLs, shortlinks, public previews) live on redeem.sg
// regardless of which admin brand is generating the URL. brand.publicHost
// stays per-brand for canonical/SEO/robots/sitemap purposes.
const CUSTOMER_HOST = 'redeem.sg';

// Brand-aware absolute URL for the active build's own host. Use for
// canonical links, SEO, brand-self-referential URLs.
export function publicUrl(path = '/') {
  const host = brand.publicHost;
  const safePath = path.startsWith('/') ? path : `/${path}`;
  return `https://${host}${safePath}`;
}

// Customer-facing absolute URL — always points to redeem.sg, regardless
// of the active brand build. Use for any URL that an admin will copy or
// share with a customer (QR tracker, shortlink, campaign link, preview).
export function customerPublicUrl(path = '/') {
  const safePath = path.startsWith('/') ? path : `/${path}`;
  return `https://${CUSTOMER_HOST}${safePath}`;
}

// Customer-facing QR tracker URL. Encoded into QR images (server-side via
// PUBLIC_BASE_URL), and also displayed/copied in admin UI for sharing.
// Always redeem.sg so the recipient never sees a mktr.sg→redeem.sg hop.
export function publicTrackingUrl(slug) {
  return customerPublicUrl(`/t/${encodeURIComponent(slug)}`);
}

// Customer-facing shortlink URL.
export function publicShareUrl(slug) {
  return customerPublicUrl(`/share/${encodeURIComponent(slug)}`);
}

// Customer-facing campaign lead-capture URL. Used by admin "Copy link"
// buttons so what gets pasted into WhatsApp/email is a clean redeem.sg
// link (not a mktr.sg redirect chain). `extraParams` is an object that
// gets appended as query string (e.g. {ref: '1'}).
export function customerLeadCaptureUrl(campaignId, extraParams = {}) {
  const qs = new URLSearchParams({ campaign_id: campaignId, ...extraParams }).toString();
  return customerPublicUrl(`/LeadCapture?${qs}`);
}

// Customer-facing public preview URL (admin previews a campaign before publish).
export function customerPreviewUrl(slug) {
  return customerPublicUrl(`/p/${encodeURIComponent(slug)}`);
}
