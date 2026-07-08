import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { apiClient } from '@/api/client';

/**
 * Consumer reward page — redeem.sg/r/:token (docs/redeem-ops/ROUTE_MAP.md).
 * One stable link, state-dependent render: reservation pass while locked,
 * scannable voucher once the consultant unlocks it. Public + token-authenticated;
 * deliberately dependency-light (no dashboard chrome).
 */
export default function RewardClaim() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    apiClient.get(`/reward-claim/${encodeURIComponent(token)}`)
      .then((res) => { if (!cancelled) setData(res.data); })
      .catch((err) => { if (!cancelled) setError(err.status === 404 ? 'This link is not valid.' : 'Something went wrong — try again shortly.'); });
    return () => { cancelled = true; };
  }, [token]);

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

  const { state, reward, firstName, expiresAt, pass, voucher } = data;
  const expiry = expiresAt ? new Date(expiresAt).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' }) : null;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center space-y-4 shadow-sm">
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
            {reward?.locations?.length > 0 && (
              <div className="text-xs text-muted-foreground space-y-0.5">
                <p className="font-medium text-foreground">Participating outlets</p>
                {reward.locations.map((l, i) => (
                  <p key={i}>{[l.name, l.addressLine, l.postalCode && `S${l.postalCode}`].filter(Boolean).join(' · ')}</p>
                ))}
              </div>
            )}
            <p className="text-xs text-muted-foreground">One-time use.{expiry ? ` Valid until ${expiry}.` : ''}</p>
          </>
        )}

        {state === 'redeemed' && (
          <div className="rounded-xl bg-muted p-4 text-sm">
            <p className="font-medium">Already redeemed ✔</p>
            <p className="text-muted-foreground mt-1">This reward has been used. Enjoy!</p>
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
