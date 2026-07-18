import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { apiClient } from '@/api/client';

/**
 * Consumer reward page — redeem.sg/r/:token (docs/redeem-ops/ROUTE_MAP.md).
 * One stable link, state-dependent render: reservation pass while locked,
 * scannable voucher once the consultant unlocks it. Public + token-authenticated;
 * deliberately dependency-light (no dashboard chrome).
 *
 * Live-ish state: redemption happens on the MERCHANT's device (the ops scanner),
 * so this page can't be told directly. Instead of polling (the claim endpoint is
 * rate-limited and it'd be wasteful), we RE-CHECK on the moments the holder
 * actually looks at their phone — tab re-focus, visibility regain, bfcache
 * restore, or a tap — which is exactly when the merchant has just scanned and
 * handed it back. Terminal states stop re-checking.
 */
const TERMINAL = new Set(['redeemed', 'expired', 'cancelled', 'blocked']);
// Loose enough to protect the rate-limited claim endpoint (60/15min per IP)
// from a fidgety tapper, tight enough that the first glance after a scan lands.
const REFRESH_THROTTLE_MS = 5000;

export default function RewardClaim() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  // True only when THIS session watched it flip to redeemed (for the "just now"
  // emphasis) — a fresh load of an already-redeemed link stays calm.
  const [justRedeemed, setJustRedeemed] = useState(false);

  const stateRef = useRef(null); // latest state, read by listeners without re-binding
  const lastFetchRef = useRef(0);
  const inFlightRef = useRef(false);
  const pendingRef = useRef(false); // an event arrived mid-flight → refetch after
  const genRef = useRef(0);         // bumps on token change; stale responses discarded

  const refresh = useCallback(async ({ force = false } = {}) => {
    // Coalesce: a request already running → remember to re-check when it lands
    // (so a redeem that happens mid-flight isn't missed until the next tap).
    if (inFlightRef.current) { pendingRef.current = true; return; }
    const now = Date.now();
    if (!force && now - lastFetchRef.current < REFRESH_THROTTLE_MS) return;
    lastFetchRef.current = now;
    inFlightRef.current = true;
    const gen = genRef.current; // ownership — discard if the token changed under us
    try {
      const res = await apiClient.get(`/reward-claim/${encodeURIComponent(token)}`);
      if (gen !== genRef.current) return;
      const next = res.data;
      const prev = stateRef.current;
      stateRef.current = next?.state ?? null;
      if (prev === 'unlocked' && next?.state === 'redeemed') setJustRedeemed(true);
      setData(next);
      setError(null);
    } catch (err) {
      if (gen !== genRef.current) return;
      // Only the FIRST load surfaces an error; a failed re-check must never wipe
      // a voucher already on screen (offline blip, transient 429, etc.).
      if (stateRef.current === null) {
        setError(err.status === 404 ? 'This link is not valid.' : 'Something went wrong — try again shortly.');
      }
    } finally {
      // Only the still-current generation owns the shared flight lock (a stale
      // A-response must not unlock or re-trigger B's fetch).
      if (gen === genRef.current) {
        inFlightRef.current = false;
        if (pendingRef.current) { pendingRef.current = false; refresh({ force: true }); }
      }
    }
  }, [token]);

  // Initial load (and full reset when the token changes — new generation, so a
  // prior token's in-flight request can neither paint here nor hold the lock).
  useEffect(() => {
    genRef.current += 1;
    stateRef.current = null;
    lastFetchRef.current = 0;
    inFlightRef.current = false;
    pendingRef.current = false;
    setData(null);
    setError(null);
    setJustRedeemed(false);
    refresh({ force: true });
  }, [refresh]);

  // Re-check when the holder returns to / touches the page — but not once the
  // reward has reached a terminal state (nothing left to change).
  useEffect(() => {
    const maybeRefresh = () => {
      if (TERMINAL.has(stateRef.current)) return;
      refresh();
    };
    const onVisibility = () => { if (document.visibilityState === 'visible') maybeRefresh(); };
    window.addEventListener('focus', maybeRefresh);
    window.addEventListener('pageshow', maybeRefresh);
    document.addEventListener('visibilitychange', onVisibility);
    document.addEventListener('pointerdown', maybeRefresh);
    return () => {
      window.removeEventListener('focus', maybeRefresh);
      window.removeEventListener('pageshow', maybeRefresh);
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('pointerdown', maybeRefresh);
    };
  }, [refresh]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <p className="text-muted-foreground">{error}</p>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-ring" />
      </div>
    );
  }

  const { state, reward, firstName, expiresAt, pass, voucher, bookingUrl } = data;
  const expiry = expiresAt ? new Date(expiresAt).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' }) : null;
  // Screen-reader announcement — the state can flip asynchronously (a merchant
  // scan elsewhere), so a live region voices the change without a visual cue.
  const statusMessage = {
    reserved: 'Reward reserved. Show the pass to your consultant to unlock it.',
    unlocked: 'Voucher ready to redeem. Show it at the counter.',
    redeemed: 'This reward has been redeemed.',
    expired: 'This reward has expired.',
    cancelled: 'This reward has been cancelled.',
    blocked: 'This reward is no longer available.',
  }[state] || null;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center space-y-4 shadow-sm">
        {statusMessage && (
          <p className="sr-only" role="status" aria-live="polite">{statusMessage}</p>
        )}
        <p className="text-sm text-muted-foreground">
          {firstName ? `Hi ${firstName},` : 'Hello,'}
        </p>
        <h1 className="text-xl font-semibold tracking-tight">{reward?.title}</h1>
        {reward?.partnerName && (
          <p className="text-sm text-muted-foreground">at {reward.partnerName}</p>
        )}

        {state === 'reserved' && (
          <>
            <div className="rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 p-3 text-sm">
              <p className="font-medium">Reserved for you 🎁</p>
              <p className="text-muted-foreground mt-1">
                Show this pass to your consultant at your complimentary financial review to unlock it.
              </p>
            </div>
            {pass?.qrDataUrl && (
              <img src={pass.qrDataUrl} alt="Reservation pass QR" className="mx-auto w-56 h-56" />
            )}
            <p className="text-xs text-muted-foreground">
              This pass is not a voucher yet — only your consultant can activate it.
              {expiry ? ` Reservation expires ${expiry}.` : ''}
            </p>
          </>
        )}

        {state === 'unlocked' && (
          <>
            <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 p-3 text-sm">
              <p className="font-medium">Unlocked — ready to redeem 🎉</p>
              <p className="text-muted-foreground mt-1">Show this at the counter.</p>
            </div>
            {voucher?.qrDataUrl && (
              <img src={voucher.qrDataUrl} alt="Voucher QR" className="mx-auto w-56 h-56" />
            )}
            {voucher?.tokenHint && (
              <p className="text-sm">or quote code <span className="font-semibold tracking-wider">{voucher.tokenHint}</span></p>
            )}
            {bookingUrl && (
              <a
                href={bookingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 transition-colors"
              >
                Book your session
              </a>
            )}
            {reward?.locations?.length > 0 && (
              <div className="text-xs text-muted-foreground space-y-0.5">
                <p className="font-medium text-foreground">Participating outlets</p>
                {reward.locations.map((l, i) => (
                  <p key={i}>{[l.name, l.addressLine, l.postalCode && `S${l.postalCode}`].filter(Boolean).join(' · ')}</p>
                ))}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              One-time use.{expiry ? ` Valid until ${expiry}.` : ''}
              <br />
              <span className="text-muted-foreground/70">Updates automatically once the counter scans it — tap if it doesn’t.</span>
            </p>
          </>
        )}

        {state === 'redeemed' && (
          <div className="space-y-4">
            {/* Rubber-stamp "REDEEMED" — the visible confirmation the holder wanted.
                Decorative; the status is voiced by the live region above. */}
            <div className="relative mx-auto w-56 h-56 flex items-center justify-center" aria-hidden="true">
              <div className="absolute inset-0 rounded-2xl bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200" />
              <div
                className={`relative select-none rounded-xl border-4 border-emerald-600 px-6 py-3 ${justRedeemed ? 'animate-in zoom-in-75 duration-300' : ''}`}
                style={{ transform: 'rotate(-11deg)' }}
              >
                <span className="block text-2xl font-black tracking-[0.15em] text-emerald-700 dark:text-emerald-400">REDEEMED</span>
                <span className="block text-center text-emerald-700/80 dark:text-emerald-400/80 text-lg leading-none">✓</span>
              </div>
            </div>
            <div className="rounded-xl bg-muted p-4 text-sm">
              <p className="font-medium">{justRedeemed ? 'Redeemed just now ✔' : 'Already redeemed ✔'}</p>
              <p className="text-muted-foreground mt-1">This reward has been used. Enjoy!</p>
            </div>
          </div>
        )}

        {['expired', 'cancelled', 'blocked'].includes(state) && (
          <div className="rounded-xl bg-muted p-4 text-sm">
            <p className="font-medium">No longer available</p>
            <p className="text-muted-foreground mt-1">
              This reward has {state === 'expired' ? 'expired' : 'been cancelled'}.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
