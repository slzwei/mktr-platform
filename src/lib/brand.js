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

// Customer-facing public host. By default ALL customer-facing surfaces (lead
// capture forms, QR tracker URLs, shortlinks, public previews) live on
// redeem.sg, regardless of which admin brand is generating the URL. A campaign
// may opt into mktr.sg per-campaign (design_config.customerHost === 'mktr'),
// which intentionally shows the operator brand to the customer. brand.publicHost
// stays per-brand for canonical/SEO/robots/sitemap purposes.
//
// `resolveCustomerHost` maps a stored enum CHOICE ('redeem' | 'mktr') to a HOST.
// Keep the choice and the host strictly separate — never pass a raw hostname
// from campaign JSON into a URL helper.
const CUSTOMER_HOSTS = { redeem: 'redeem.sg', mktr: 'mktr.sg' };
export const DEFAULT_CUSTOMER_HOST = 'redeem.sg';

export function resolveCustomerHost(choice) {
  return CUSTOMER_HOSTS[choice] || DEFAULT_CUSTOMER_HOST;
}

// Brand-aware absolute URL for the active build's own host. Use for
// canonical links, SEO, brand-self-referential URLs.
export function publicUrl(path = '/') {
  const host = brand.publicHost;
  const safePath = path.startsWith('/') ? path : `/${path}`;
  return `https://${host}${safePath}`;
}

// Customer-facing absolute URL. Defaults to redeem.sg; pass a `host` (from
// resolveCustomerHost(campaign.design_config.customerHost)) to emit a
// per-campaign mktr.sg link instead. Use for any URL an admin copies or
// shares with a customer (QR tracker, shortlink, campaign link, preview).
export function customerPublicUrl(path = '/', host = DEFAULT_CUSTOMER_HOST) {
  const safePath = path.startsWith('/') ? path : `/${path}`;
  return `https://${host}${safePath}`;
}

// Customer-facing QR tracker URL. Encoded into QR images (server-side via
// PUBLIC_BASE_URL), and also displayed/copied in admin UI for sharing.
// Defaults to redeem.sg; pass the campaign's resolved host for mktr.sg.
export function publicTrackingUrl(slug, host = DEFAULT_CUSTOMER_HOST) {
  return customerPublicUrl(`/t/${encodeURIComponent(slug)}`, host);
}

// Customer-facing shortlink URL.
export function publicShareUrl(slug, host = DEFAULT_CUSTOMER_HOST) {
  return customerPublicUrl(`/share/${encodeURIComponent(slug)}`, host);
}

// Customer-facing campaign lead-capture URL. Used by admin "Copy link"
// buttons so what gets pasted into WhatsApp/email is a clean customer-host
// link (not a redirect chain). `extraParams` is appended as query string
// (e.g. {ref: '1'}); `host` defaults to redeem.sg.
export function customerLeadCaptureUrl(campaignId, extraParams = {}, host = DEFAULT_CUSTOMER_HOST) {
  const qs = new URLSearchParams({ campaign_id: campaignId, ...extraParams }).toString();
  return customerPublicUrl(`/LeadCapture?${qs}`, host);
}

// Customer-facing public preview URL (admin previews a campaign before publish).
export function customerPreviewUrl(slug, host = DEFAULT_CUSTOMER_HOST) {
  return customerPublicUrl(`/p/${encodeURIComponent(slug)}`, host);
}
