import { Link } from 'react-router-dom';
import AlertTriangle from 'lucide-react/icons/alert-triangle';
import CheckCircle from 'lucide-react/icons/check-circle';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import { useCampaignTheme } from '@/components/campaignPage/themeContext';

/**
 * Lead-capture OUTCOME states — extracted verbatim from LeadCapture.jsx
 * (Studio PR 3) so the Studio canvas can preview the parent-owned outcomes
 * (success + share, duplicate 409 countdown, generic error) without mounting
 * the whole page. Pure move: markup, tokens and copy are unchanged; the live
 * page keeps rendering these exact components.
 *
 * NOTE the generic error branch contains a react-router <Link> — any preview
 * mount needs a Router ancestor (the Studio DeviceFrame wraps a MemoryRouter).
 */

export function SuccessState({ onShare }) {
  const { tokens: TOKENS, radius: RADIUS } = useCampaignTheme();
  return (
    <div style={{ textAlign: 'center', padding: '24px 0 16px' }}>
      <div
        style={{
          margin: '0 auto 20px',
          width: 64,
          height: 64,
          borderRadius: '50%',
          backgroundColor: TOKENS.success + '22',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <CheckCircle style={{ width: 32, height: 32, color: TOKENS.success }} />
      </div>
      <h2
        style={{
          fontFamily: 'Fraunces, serif',
          fontWeight: 800,
          fontSize: 30,
          color: TOKENS.ink,
          margin: 0,
          marginBottom: 8,
          lineHeight: 1.1,
          letterSpacing: '-0.01em',
        }}
      >
        You're all set.
      </h2>
      <p
        style={{
          fontFamily: 'Albert Sans, system-ui, sans-serif',
          fontSize: 15,
          color: TOKENS.body,
          margin: 0,
          marginBottom: 28,
        }}
      >
        Your details have been received securely.
      </p>
      <button
        type="button"
        onClick={onShare}
        style={{
          height: 52,
          paddingLeft: 28,
          paddingRight: 28,
          borderRadius: RADIUS.pill,
          backgroundColor: TOKENS.inputBg || '#ffffff',
          color: TOKENS.body,
          border: `1px solid ${TOKENS.hairline}`,
          fontFamily: 'Albert Sans, system-ui, sans-serif',
          fontWeight: 600,
          fontSize: 15,
          cursor: 'pointer',
        }}
      >
        Share with friends
      </button>
    </div>
  );
}

export function ErrorState({ duplicateDetected, duplicateCountdown, message, onShare }) {
  const { tokens: TOKENS, radius: RADIUS, onAccent } = useCampaignTheme();
  return (
    <div style={{ textAlign: 'center', padding: '16px 0' }}>
      <div
        style={{
          margin: '0 auto 18px',
          width: 56,
          height: 56,
          borderRadius: '50%',
          backgroundColor: TOKENS.required + '18',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <AlertTriangle style={{ width: 28, height: 28, color: TOKENS.required }} />
      </div>
      {duplicateDetected ? (
        <>
          <h2
            style={{
              fontFamily: 'Fraunces, serif',
              fontWeight: 800,
              fontSize: 26,
              color: TOKENS.ink,
              margin: 0,
              marginBottom: 8,
              lineHeight: 1.1,
            }}
          >
            Already Registered
          </h2>
          <p
            style={{
              fontFamily: 'Albert Sans, system-ui, sans-serif',
              fontSize: 14,
              color: TOKENS.body,
              margin: 0,
              marginBottom: 16,
              maxWidth: 320,
              marginLeft: 'auto',
              marginRight: 'auto',
            }}
          >
            {message}
          </p>
          <p style={{ fontSize: 12, color: TOKENS.muted, marginTop: 12, marginBottom: 8 }}>
            Redirecting in {duplicateCountdown}s…
          </p>
          <button
            type="button"
            onClick={onShare}
            style={{
              height: 52,
              paddingLeft: 32,
              paddingRight: 32,
              borderRadius: RADIUS.pill,
              backgroundColor: TOKENS.accent,
              color: onAccent,
              border: 'none',
              fontFamily: 'Albert Sans, system-ui, sans-serif',
              fontWeight: 600,
              fontSize: 15,
              cursor: 'pointer',
              marginTop: 4,
            }}
          >
            Share now
          </button>
        </>
      ) : (
        <>
          <h2
            style={{
              fontFamily: 'Fraunces, serif',
              fontWeight: 800,
              fontSize: 26,
              color: TOKENS.ink,
              margin: 0,
              marginBottom: 8,
              lineHeight: 1.1,
            }}
          >
            Something went wrong
          </h2>
          <p
            style={{
              fontFamily: 'Albert Sans, system-ui, sans-serif',
              fontSize: 14,
              color: TOKENS.body,
              margin: 0,
              marginBottom: 24,
              maxWidth: 320,
              marginLeft: 'auto',
              marginRight: 'auto',
            }}
          >
            {message}
          </p>
          <Link
            to="/Dashboard"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontFamily: 'Albert Sans, system-ui, sans-serif',
              fontSize: 14,
              color: TOKENS.muted,
              textDecoration: 'none',
            }}
          >
            <ArrowLeft style={{ width: 16, height: 16 }} />
            Back to Safe Zone
          </Link>
        </>
      )}
    </div>
  );
}
