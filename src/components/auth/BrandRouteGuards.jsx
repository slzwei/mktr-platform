import { useEffect } from 'react';
import { BRAND_ID } from '@/lib/brand';

const MKTR_HOST = 'https://mktr.sg';

/**
 * Render-blocking redirect to mktr.sg for internal/admin/auth/agent/driver
 * routes when the SPA is served from the redeem.sg static site.
 *
 * Belt-and-braces with the Render route rules: even if the edge-level
 * redirect is misconfigured, the SPA will not authenticate, render admin
 * UI, or display the staff login on redeem.sg.
 */
export function MktrOnlyRedirect() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const dest = `${MKTR_HOST}${window.location.pathname}${window.location.search}${window.location.hash}`;
    window.location.replace(dest);
  }, []);

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'system-ui, sans-serif',
        color: '#374151',
      }}
    >
      <p>Redirecting to MKTR…</p>
    </div>
  );
}

/**
 * 404-equivalent for routes that should not exist on the active brand
 * (e.g. /about on redeem.sg). Emits a non-indexable meta tag.
 */
export function NotFoundForBrand() {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const meta = document.querySelector('meta[name="robots"]') || document.createElement('meta');
    meta.setAttribute('name', 'robots');
    meta.setAttribute('content', 'noindex,nofollow');
    if (!meta.parentElement) document.head.appendChild(meta);
  }, []);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen">
      <h1 className="text-4xl font-bold mb-4">404</h1>
      <p className="text-muted-foreground mb-6">Page not found</p>
      <a href="/" className="text-primary hover:underline">
        Go home
      </a>
    </div>
  );
}

export const IS_REDEEM_BUILD = BRAND_ID === 'redeem';
export const IS_MKTR_BUILD = BRAND_ID === 'mktr';
