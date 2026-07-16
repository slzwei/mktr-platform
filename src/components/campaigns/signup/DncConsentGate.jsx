import { Shield, ShieldCheck, Pencil } from 'lucide-react';
import { TOKENS } from '@/components/campaigns/LeadCaptureLayout';

/**
 * DNC consent gate — C3 "editorial seal" (design_handoff_dnc_consent_gate/README.md, authoritative).
 * Rendered beneath the verified phone/OTP block when the campaign has `dncCheckAtSubmit` ON AND the
 * verified number is on Singapore's DNC Registry. Two states driven by `consented`:
 *   notice (cream)  → gives the consent action; while it shows, the form fields stay locked.
 *   confirmed (sage) → records consent; Edit revokes it.
 * Reveal slides in from the left; honors prefers-reduced-motion.
 *
 * `advertiser` (mono chip) is the name the person consents to being contacted by —
 * CampaignSignupForm threads `campaign.name`; the neutral fallback below should never
 * render in practice. The design handoff's `{Advertiser}` was an interpolation slot,
 * not copy. Editing this component's wording requires bumping DNC_CONSENT_VERSION
 * (backend/src/services/dncConsent.js) so recorded consent evidence stays accurate.
 */

const FRAUNCES = 'Fraunces, serif';
const ALBERT = '"Albert Sans", sans-serif';
const MONO = '"JetBrains Mono", monospace';

function AdvertiserChip({ advertiser, tone }) {
  const sage = tone === 'sage';
  return (
    <span
      style={{
        fontFamily: MONO,
        fontSize: '0.9em',
        background: sage ? 'rgba(94,112,73,.14)' : 'rgba(176,128,30,.14)',
        color: sage ? '#566A3D' : '#8A6418',
        borderRadius: 5,
        padding: '1px 5px',
      }}
    >
      {advertiser}
    </span>
  );
}

const KEYFRAMES = `
  @keyframes dncSlideIn { from { opacity: 0; transform: translateX(-32px); } to { opacity: 1; transform: translateX(0); } }
  @keyframes dncFadeIn { from { opacity: 0; } to { opacity: 1; } }
  .dnc-gate-notice { animation: dncSlideIn 460ms cubic-bezier(0.16, 1, 0.3, 1) both; }
  .dnc-gate-confirmed { animation: dncFadeIn 300ms ease both; }
  @media (prefers-reduced-motion: reduce) {
    .dnc-gate-notice, .dnc-gate-confirmed { animation: none; }
  }
`;

export default function DncConsentGate({ advertiser = 'the advertiser', consented, onGiveConsent, onRevoke }) {
  if (consented) {
    return (
      <div
        className="dnc-gate-confirmed"
        role="status"
        style={{
          background: '#F6F8EF',
          border: '1px solid #CDD9B6',
          borderRadius: 18,
          padding: '18px 18px 16px',
          textAlign: 'center',
          boxShadow: '0 2px 8px rgba(60,70,40,.06)',
          margin: '14px 0',
        }}
      >
        <style>{KEYFRAMES}</style>
        <div
          style={{
            width: 42,
            height: 42,
            borderRadius: '50%',
            background: '#DCE6C8',
            border: '1.5px solid #BFD0A2',
            margin: '0 auto 11px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <ShieldCheck size={20} style={{ stroke: '#5E7049' }} aria-hidden="true" />
        </div>
        <div style={{ fontFamily: FRAUNCES, fontSize: 19, fontWeight: 700, letterSpacing: '-.01em', color: TOKENS.ink }}>
          Consent recorded
        </div>
        <p style={{ fontFamily: ALBERT, fontSize: 12.5, lineHeight: 1.55, color: '#5C6845', maxWidth: 262, margin: '6px auto 12px' }}>
          You&apos;ve agreed to be contacted by <AdvertiserChip advertiser={advertiser} tone="sage" />. You can change this anytime.
        </p>
        <button
          type="button"
          onClick={onRevoke}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: '#5E7049',
            textDecoration: 'underline',
            textUnderlineOffset: 3,
            fontFamily: ALBERT,
            fontSize: 13.5,
            fontWeight: 600,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <Pencil size={13} style={{ stroke: '#5E7049' }} aria-hidden="true" /> Edit consent
        </button>
      </div>
    );
  }

  return (
    <div
      className="dnc-gate-notice"
      role="group"
      aria-label="Do Not Call consent"
      style={{
        background: '#FFFCF6',
        border: '1px solid #EAD6A6',
        borderRadius: 18,
        padding: '18px 18px 16px',
        textAlign: 'center',
        boxShadow: '0 12px 26px -12px rgba(120,80,20,.22), 0 3px 10px rgba(120,80,20,.10)',
        margin: '14px 0',
      }}
    >
      <style>{KEYFRAMES}</style>
      <div
        style={{
          width: 42,
          height: 42,
          borderRadius: '50%',
          background: '#F7E9C8',
          border: '1.5px solid #E3C879',
          margin: '0 auto 11px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Shield size={20} style={{ stroke: '#B0801E' }} aria-hidden="true" />
      </div>
      <div style={{ fontFamily: FRAUNCES, fontSize: 19, fontWeight: 700, letterSpacing: '-.01em', color: '#3D1F0B' }}>
        A quick consent
      </div>
      <p style={{ fontFamily: ALBERT, fontSize: 12.5, lineHeight: 1.55, color: '#6E5631', maxWidth: 262, margin: '6px auto 14px' }}>
        This number is on Singapore&apos;s Do Not Call Registry. To receive <AdvertiserChip advertiser={advertiser} />
        &apos;s offer and updates about it, please confirm below.
      </p>
      <button
        type="button"
        onClick={onGiveConsent}
        style={{
          width: '100%',
          height: 48,
          borderRadius: 999,
          background: '#fff',
          border: '1.5px solid #D17029',
          color: '#D17029',
          fontFamily: ALBERT,
          fontSize: 14.5,
          fontWeight: 600,
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 9,
        }}
      >
        <span aria-hidden="true" style={{ width: 19, height: 19, border: '1.5px solid #D17029', borderRadius: 5, display: 'inline-block' }} />
        I consent to be contacted
      </button>
    </div>
  );
}
