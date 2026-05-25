import { useEffect } from 'react';
import { brand } from '@/lib/brand';
import { TOKENS } from '@/components/campaigns/LeadCaptureLayout';

/**
 * Minimal placeholder for redeem.sg apex.
 *
 * Rendered when a customer hits bare `redeem.sg/` with no campaign context.
 * Replaces the previous error state ("No campaign or QR code specified").
 *
 * Kept deliberately minimal — wordmark + tagline + legal footer. A real
 * Redeem homepage can replace this later by flipping `brand.showHomepage`
 * and routing `/` to a new component.
 */
export default function RedeemPlaceholder() {
  useEffect(() => {
    document.title = brand.pageTitle;
  }, []);

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: TOKENS.pagebg,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        position: 'relative',
      }}
    >
      <div style={{ textAlign: 'center', maxWidth: 640 }}>
        <h1
          style={{
            fontFamily: 'Fraunces, Georgia, serif',
            fontWeight: 800,
            fontSize: 'clamp(72px, 14vw, 144px)',
            margin: 0,
            lineHeight: 0.95,
            letterSpacing: '-0.03em',
            color: TOKENS.ink,
          }}
        >
          {brand.wordmark}
        </h1>
        <p
          style={{
            fontFamily: 'Albert Sans, system-ui, -apple-system, sans-serif',
            fontSize: 'clamp(15px, 2.2vw, 18px)',
            lineHeight: 1.55,
            color: TOKENS.body,
            marginTop: 28,
            marginBottom: 0,
            fontWeight: 400,
          }}
        >
          Rewards, perks, and giveaways — handpicked for Singapore.
        </p>
        <p
          style={{
            fontFamily: 'Albert Sans, system-ui, -apple-system, sans-serif',
            fontSize: 14,
            lineHeight: 1.55,
            color: TOKENS.muted,
            marginTop: 20,
            marginBottom: 0,
          }}
        >
          Have a campaign link or QR code? Scan it to get started.
        </p>
      </div>

      <footer
        style={{
          position: 'absolute',
          bottom: 32,
          left: 24,
          right: 24,
          textAlign: 'center',
          fontFamily: 'Albert Sans, system-ui, -apple-system, sans-serif',
          fontSize: 11,
          letterSpacing: '0.04em',
          color: TOKENS.muted,
        }}
      >
        {brand.consumerLine} · UEN {brand.uen}
      </footer>
    </div>
  );
}
