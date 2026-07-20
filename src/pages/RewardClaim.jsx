import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { apiClient } from '@/api/client';
import { brand } from '@/lib/brand';

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
      <div className="min-h-screen flex items-center justify-center bg-[#F5F0E6] p-6">
        <p className="text-[#4A4640]">{error}</p>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F5F0E6]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#D6552B]" />
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

  // Editorial card (claude.ai/design "QR Card Frames" 1c) — the web twin of the
  // PNG delivered by WhatsApp/email. Fixed light palette on purpose: the page
  // must match the card in the customer's chat, not the OS theme. The unlock
  // flips the card terracotta so the state change is unmissable at a glance.
  const unlocked = state === 'unlocked';
  const wordmarkBase = (brand.wordmark || 'Redeem.').replace(/\.$/, '');
  const kicker = {
    reserved: 'RESERVATION PASS',
    unlocked: 'VOUCHER · UNLOCKED',
    redeemed: 'VOUCHER · REDEEMED',
  }[state] || 'REWARD';

  return (
    <div className="min-h-screen bg-[#F5F0E6] flex items-center justify-center p-4 sm:p-6 font-sans text-[#1B1A17]">
      <div
        className={`w-full max-w-md rounded-2xl px-6 py-7 shadow-sm ${
          unlocked ? 'bg-[#D6552B] text-[#FBF7EE]' : 'bg-[#FBF7EE] border border-[#E6E0D1]'
        }`}
      >
        {statusMessage && (
          <p className="sr-only" role="status" aria-live="polite">{statusMessage}</p>
        )}

        {/* Header — wordmark left, state kicker right */}
        <div className="flex items-center justify-between">
          <span className="text-lg font-bold tracking-tight">
            {wordmarkBase}<span className={unlocked ? 'text-[#F7E7DC]' : 'text-[#D6552B]'}>.</span>
          </span>
          <span className={`text-[10px] font-semibold tracking-[0.2em] ${unlocked ? 'text-[#F7E7DC]' : 'text-[#6B6558]'}`}>
            {kicker}
          </span>
        </div>

        {state === 'reserved' && (
          <>
            <p className="mt-3 text-center font-serif italic font-semibold text-4xl leading-none text-[#C89B3C]">Reserved.</p>
            <div className="mt-4 flex items-center gap-3">
              <span className="h-px flex-1 bg-[#E6E0D1]" />
              <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#6B6558]">
                {reward?.partnerName || 'Rewards'}
              </span>
              <span className="h-px flex-1 bg-[#E6E0D1]" />
            </div>
            <h1 className="mt-2 text-center font-serif text-2xl font-semibold leading-tight">{reward?.title}</h1>
            {pass?.qrDataUrl && (
              <div className="mx-auto mt-4 flex h-64 w-64 max-w-full items-center justify-center border-2 border-[#E6E0D1] bg-white">
                <img src={pass.qrDataUrl} alt="Reservation pass QR" className="h-52 w-52" />
              </div>
            )}
            <div className="mt-4 flex items-center justify-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#C89B3C]" aria-hidden="true" />
              <p className="font-serif italic">Held for {firstName || 'you'} — unlock at your appointment</p>
            </div>
            <div className="mt-5 space-y-1 text-center">
              <p className="font-mono text-sm font-medium">CODE · REVEALED ON UNLOCK</p>
              {expiry && (
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#6B6558]">Expires {expiry}</p>
              )}
              <p className="text-xs text-[#8B8477]">
                This pass is not a voucher yet — only your consultant can activate it.
              </p>
              <p className="font-mono text-[10px] tracking-[0.12em] text-[#8B8477]">POWERED BY MKTR</p>
            </div>
          </>
        )}

        {state === 'unlocked' && (
          <>
            <p className="mt-3 text-center font-serif italic font-semibold text-4xl leading-none text-[#F7E7DC]">Unlocked.</p>
            <div className="mt-4 flex items-center gap-3">
              <span className="h-px flex-1 bg-[#FBF7EE]/40" />
              <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#F7E7DC]">
                {reward?.partnerName || 'Rewards'}
              </span>
              <span className="h-px flex-1 bg-[#FBF7EE]/40" />
            </div>
            <h1 className="mt-2 text-center font-serif text-2xl font-semibold leading-tight">{reward?.title}</h1>
            {voucher?.qrDataUrl && (
              <div className="mx-auto mt-4 flex h-64 w-64 max-w-full items-center justify-center bg-white">
                <img src={voucher.qrDataUrl} alt="Voucher QR" className="h-52 w-52" />
              </div>
            )}
            <div className="mt-4 flex items-center justify-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#F7E7DC]" aria-hidden="true" />
              <p className="font-serif italic">Unlocked — present once to redeem</p>
            </div>
            <div className="mt-5 space-y-1 text-center">
              {voucher?.tokenHint && (
                <p className="font-mono text-sm font-medium">CODE {voucher.tokenHint}</p>
              )}
              {expiry && (
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#F7E7DC]">Valid till {expiry}</p>
              )}
            </div>
            {bookingUrl && (
              <div className="mt-4 text-center">
                <a
                  href={bookingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block rounded-lg bg-[#FBF7EE] px-5 py-2 text-sm font-semibold text-[#A53F1E] hover:bg-[#F7E7DC] transition-colors"
                >
                  Book your session
                </a>
              </div>
            )}
            {reward?.locations?.length > 0 && (
              <div className="mt-4 space-y-0.5 text-center text-xs text-[#F7E7DC]/90">
                <p className="font-semibold text-[#FBF7EE]">Participating outlets</p>
                {reward.locations.map((l, i) => (
                  <p key={i}>{[l.name, l.addressLine, l.postalCode && `S${l.postalCode}`].filter(Boolean).join(' · ')}</p>
                ))}
              </div>
            )}
            <div className="mt-4 space-y-1 text-center">
              <p className="text-xs text-[#F7E7DC]/90">Present once. Non-transferable.</p>
              <p className="text-xs text-[#F7E7DC]/70">Updates automatically once the counter scans it — tap if it doesn’t.</p>
              <p className="font-mono text-[10px] tracking-[0.12em] text-[#F7E7DC]/80">POWERED BY MKTR</p>
            </div>
          </>
        )}

        {state === 'redeemed' && (
          <div className="mt-4 space-y-4 text-center">
            <h1 className="font-serif text-2xl font-semibold leading-tight">{reward?.title}</h1>
            {/* Rubber-stamp "REDEEMED" — the visible confirmation the holder wanted.
                Decorative; the status is voiced by the live region above. */}
            <div className="relative mx-auto w-56 h-56 flex items-center justify-center" aria-hidden="true">
              <div className="absolute inset-0 rounded-2xl bg-[#7A8C6B]/10 border border-[#7A8C6B]/30" />
              <div
                className={`relative select-none rounded-xl border-4 border-[#7A8C6B] px-6 py-3 ${justRedeemed ? 'animate-in zoom-in-75 duration-300' : ''}`}
                style={{ transform: 'rotate(-11deg)' }}
              >
                <span className="block text-2xl font-black tracking-[0.15em] text-[#5C7050]">REDEEMED</span>
                <span className="block text-center text-[#5C7050]/80 text-lg leading-none">✓</span>
              </div>
            </div>
            <div className="rounded-xl border border-[#E6E0D1] bg-[#F5F0E6] p-4 text-sm">
              <p className="font-medium">{justRedeemed ? 'Redeemed just now ✔' : 'Already redeemed ✔'}</p>
              <p className="mt-1 text-[#4A4640]">This reward has been used. Enjoy!</p>
            </div>
            <p className="font-mono text-[10px] tracking-[0.12em] text-[#8B8477]">POWERED BY MKTR</p>
          </div>
        )}

        {['expired', 'cancelled', 'blocked'].includes(state) && (
          <div className="mt-4 space-y-4 text-center">
            <h1 className="font-serif text-2xl font-semibold leading-tight">{reward?.title}</h1>
            <div className="rounded-xl border border-[#E6E0D1] bg-[#F5F0E6] p-4 text-sm">
              <p className="font-medium">No longer available</p>
              <p className="mt-1 text-[#4A4640]">
                This reward has {state === 'expired' ? 'expired' : 'been cancelled'}.
              </p>
            </div>
            <p className="font-mono text-[10px] tracking-[0.12em] text-[#8B8477]">POWERED BY MKTR</p>
          </div>
        )}
      </div>
    </div>
  );
}
