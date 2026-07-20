import { useMemo, useRef } from 'react';
import DOMPurify from 'dompurify';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useCampaignTheme } from '@/components/campaignPage/themeContext';
import DefaultTermsCopy from '@/components/legal/DefaultTermsCopy';
import {
  CONSENT_COPY, CONSENT_INLINE, isSponsoredCampaign, sponsorNameLine,
} from '@/lib/consentCopy';

/**
 * The FULL agree-all agreement in a dialog (layered presentation, 2026-07-21):
 *
 *   Section 1 — "What you're agreeing to": the §9.4 clause list, byte-identical
 *   to the evidence strings the ledger hashes (CONSENT_COPY.clause*), plus the
 *   named-sponsor line on sponsored campaigns.
 *   Section 2 — "Terms & conditions": the campaign's own T&C HTML, or the
 *   brand-default fallback.
 *
 * Unlike the old read-only T&C dialog, this one holds the ENTIRE deal, so its
 * "I agree" is a real consent gesture: the parent ticks the block's checkbox.
 * The in-clause "terms & conditions" link scrolls to Section 2 (same dialog),
 * never opens a second one.
 */
export default function ConsentAgreementDialog({
  open, onOpenChange, designConfig, termsContent, themeColor, onAgree,
}) {
  const { tokens: TOKENS, radius: RADIUS, onAccent } = useCampaignTheme();
  const sanitized = useMemo(
    () => (termsContent ? DOMPurify.sanitize(termsContent) : null),
    [termsContent]
  );
  const accent = themeColor || TOKENS.accent;
  const sponsored = isSponsoredCampaign(designConfig);
  const termsRef = useRef(null);

  const sectionTitleStyle = {
    fontFamily: 'Albert Sans, system-ui, sans-serif',
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.16em',
    textTransform: 'uppercase',
    color: TOKENS.muted,
    margin: '0 0 10px',
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="border-0 p-0 gap-0"
        style={{
          backgroundColor: TOKENS.modal,
          borderRadius: RADIUS.modal,
          maxWidth: 520,
          width: 'calc(100vw - 32px)',
          maxHeight: '85vh',
          padding: 0,
          boxShadow: '0 24px 64px rgba(60, 40, 20, 0.18), 0 4px 16px rgba(60, 40, 20, 0.08)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Header — eyebrow + display title */}
        <div style={{ padding: '28px 28px 20px' }}>
          <div style={sectionTitleStyle}>{CONSENT_INLINE.dialogEyebrow}</div>
          <h2
            style={{
              fontFamily: 'Fraunces, serif',
              fontWeight: 800,
              fontSize: 30,
              lineHeight: 1.05,
              letterSpacing: '-0.015em',
              color: TOKENS.ink,
              margin: 0,
            }}
          >
            {CONSENT_COPY.heading}
          </h2>
        </div>

        {/* Scrollable body — Section 1: the agreement list */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '0 28px 24px',
            fontFamily: 'Albert Sans, system-ui, sans-serif',
            fontSize: 15,
            lineHeight: 1.65,
            color: TOKENS.body,
          }}
        >
          <div style={sectionTitleStyle}>{CONSENT_INLINE.sectionAgreeTitle}</div>
          <p style={{ margin: '0 0 12px' }}>{CONSENT_COPY.intro}</p>
          <ul style={{ margin: '0 0 16px', paddingLeft: 20, display: 'grid', gap: 10 }}>
            <li>
              <strong style={{ color: TOKENS.ink }}>{CONSENT_COPY.clauseContactHeadline}</strong>{' '}
              {CONSENT_COPY.clauseContactBody}
            </li>
            <li>
              <strong style={{ color: TOKENS.ink }}>{CONSENT_COPY.clauseTermsHeadline}</strong>{' '}
              {CONSENT_COPY.clauseTermsPrefix}
              <button
                type="button"
                onClick={() => termsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                style={{
                  color: TOKENS.body,
                  fontWeight: 600,
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  cursor: 'pointer',
                  textDecoration: 'underline',
                  textUnderlineOffset: 3,
                  fontSize: 'inherit',
                  fontFamily: 'inherit',
                }}
              >
                {CONSENT_COPY.clauseTermsLinkText}
              </button>
              {CONSENT_COPY.clauseTermsSuffix}
            </li>
            {sponsored && (
              <li>
                <strong style={{ color: TOKENS.ink }}>{CONSENT_COPY.clauseThirdPartyHeadline}</strong>{' '}
                {CONSENT_COPY.clauseThirdPartyBody}
              </li>
            )}
          </ul>
          {sponsored && (
            <p style={{ margin: '0 0 16px', fontSize: 13, color: TOKENS.muted }}>
              {sponsorNameLine(designConfig)}
            </p>
          )}

          {/* Section 2: the campaign's terms & conditions */}
          <div
            ref={termsRef}
            style={{
              borderTop: `1px solid ${TOKENS.hairline}`,
              paddingTop: 20,
              marginTop: 4,
              scrollMarginTop: 8,
            }}
          >
            <div style={sectionTitleStyle}>{CONSENT_INLINE.sectionTermsTitle}</div>
            {sanitized ? (
              <div dangerouslySetInnerHTML={{ __html: sanitized }} />
            ) : (
              <DefaultTermsCopy />
            )}
          </div>
        </div>

        {/* Footer — Cancel / I agree (a real consent gesture: parent ticks the box) */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 12,
            padding: '20px 28px 28px',
            borderTop: `1px solid ${TOKENS.hairline}`,
          }}
        >
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            style={{
              height: 48,
              paddingLeft: 24,
              paddingRight: 24,
              borderRadius: RADIUS.pill,
              backgroundColor: '#ffffff',
              color: TOKENS.body,
              border: `1px solid ${TOKENS.hairline}`,
              cursor: 'pointer',
              fontFamily: 'Albert Sans, system-ui, sans-serif',
              fontWeight: 600,
              fontSize: 15,
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onAgree}
            style={{
              height: 48,
              paddingLeft: 28,
              paddingRight: 28,
              borderRadius: RADIUS.pill,
              backgroundColor: accent,
              color: onAccent,
              border: 'none',
              cursor: 'pointer',
              fontFamily: 'Albert Sans, system-ui, sans-serif',
              fontWeight: 600,
              fontSize: 15,
              minWidth: 110,
              boxShadow: '0 4px 14px rgba(209, 112, 41, 0.18)',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = TOKENS.accentDeep)}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = accent)}
          >
            {CONSENT_INLINE.dialogAgreeCta}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
