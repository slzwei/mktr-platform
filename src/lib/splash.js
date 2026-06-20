import { isRedeem } from '@/lib/brand';

// Boot splash (the `mktr_` typing animation) helpers. Extracted from main.jsx so
// the suppression logic is unit-testable without triggering main.jsx's
// ReactDOM.createRoot side effect.

export const SPLASH_KEY = 'mktr_splash_shown';

// sessionStorage can throw (private mode / blocked storage). A throw inside the
// hide timer would also strand the splash (setShowSplash never runs), so guard both.
export function safeSessionGet(key) {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

export function safeSessionSet(key, value) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    /* storage blocked — non-fatal */
  }
}

/**
 * The operator `mktr_` splash must never appear on customer-facing or
 * redirect-shim surfaces:
 *  - the entire redeem (customer) build, and
 *  - the QR/share redirect shims (`/t/`, `/share/`) + public lead-capture /
 *    preview pages (`/p/`, `/LeadCapture`) on ANY build.
 * Those surfaces do rapid full-page navigations (a QR scan is
 * `/t/:slug` → backend 302 → `/LeadCapture`), so the splash would replay on each
 * boot and flash the operator brand at customers. The mktr admin app keeps its
 * once-per-session splash.
 */
export function shouldSuppressSplash(pathname = window.location.pathname) {
  if (isRedeem()) return true;
  return (
    pathname.startsWith('/t/') ||
    pathname.startsWith('/share/') ||
    pathname.startsWith('/p/') ||
    pathname === '/LeadCapture' ||
    pathname === '/lead-capture'
  );
}
