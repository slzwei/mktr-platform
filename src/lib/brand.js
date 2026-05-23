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

// Helper for building absolute public-facing URLs (used by QR/share copy UI
// where the SPA can be served from either mktr.sg or redeem.sg).
export function publicUrl(path = '/') {
  const host = brand.publicHost;
  const safePath = path.startsWith('/') ? path : `/${path}`;
  return `https://${host}${safePath}`;
}

// Public tracking base — what QR codes / shortlinks encode and what we copy
// to clipboard from admin QR tables. Always absolute so external users can
// open the link regardless of the SPA's host.
export function publicTrackingUrl(slug) {
  return publicUrl(`/t/${encodeURIComponent(slug)}`);
}

export function publicShareUrl(slug) {
  return publicUrl(`/share/${encodeURIComponent(slug)}`);
}
