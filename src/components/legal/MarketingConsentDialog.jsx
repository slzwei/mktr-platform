import { useMemo } from 'react';
import DOMPurify from 'dompurify';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useCampaignTheme } from '@/components/campaignPage/themeContext';
import { brand } from '@/lib/brand';

/**
 * Marketing Consent dialog — editorial pattern.
 *
 *   small eyebrow ("Terms And Conditions")
 *   heavy-serif title ("Marketing Consent")
 *   scrollable body — campaign-supplied HTML or brand-default fallback
 *   Cancel / I agree pill buttons
 *
 * `onAgree` is now a real consent gesture: clicking "I agree" closes the
 * dialog and fires the callback so the parent can mark consent as given.
 */
export default function MarketingConsentDialog({ open, onOpenChange, content, themeColor, onAgree }) {
  const { tokens: TOKENS, radius: RADIUS, onAccent } = useCampaignTheme();
  const sanitized = useMemo(() => (content ? DOMPurify.sanitize(content) : null), [content]);
  const accent = themeColor || TOKENS.accent;

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
          <div
            style={{
              fontFamily: 'Albert Sans, system-ui, sans-serif',
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              color: TOKENS.muted,
              marginBottom: 10,
            }}
          >
            Terms And Conditions
          </div>
          <h2
            style={{
              fontFamily: 'Fraunces, serif',
              fontWeight: 800,
              fontSize: 32,
              lineHeight: 1.05,
              letterSpacing: '-0.015em',
              color: TOKENS.ink,
              margin: 0,
            }}
          >
            Marketing Consent
          </h2>
        </div>

        {/* Scrollable body */}
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
          {sanitized ? (
            <div dangerouslySetInnerHTML={{ __html: sanitized }} />
          ) : (
            <DefaultConsentCopy />
          )}
        </div>

        {/* Footer — Cancel / I agree */}
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
          {onAgree && (
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
              I agree
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function DefaultConsentCopy() {
  const { tokens: TOKENS, radius: RADIUS } = useCampaignTheme();
  // Legal data controller stays MKTR PTE. LTD. per D3. Consumer-facing brand
  // references swap with the active build's brand (Redeem on redeem.sg).
  const partnersTerm = brand.partnersTerm;
  const pdpaUrl = brand.pdpaAbsoluteUrl;
  return (
    <>
      <p>
        By submitting this form, you agree to receive updates on promotions, offers, customer rewards, and other
        marketing-related communications from {brand.consentEntityClause}. You also agree that your personal data
        may be collected, used, stored, and shared in accordance with this consent form and the {brand.name}{' '}
        Personal Data Policy (
        <a
          href={pdpaUrl}
          target="_blank"
          rel="noreferrer"
          style={{ color: TOKENS.body, textDecoration: 'underline' }}
        >
          {pdpaUrl}
        </a>
        ).
      </p>
      <p>
        Your details may also be disclosed to trusted third parties and their agents, for the purposes of carrying
        out marketing campaigns, customer engagement activities, and related services.
      </p>
      <Section title={`1. Definition of ${partnersTerm}`}>
        "{partnersTerm}" include {brand.legalName}, its affiliates, service providers, and appointed representatives,
        whether located in Singapore or overseas.
      </Section>
      <Section title="2. Non-Superseding Consent">
        This consent is in addition to any prior consents you may have given. It does not cancel or override any
        earlier consent.
      </Section>
      <Section title="3. Withdrawing Consent">
        You may withdraw or amend your consent at any time by writing via WhatsApp to +60 11 5438 8337.
      </Section>
      <Section title="4. How We May Contact You">
        We may reach out to you through postal mail, email or social media platforms, phone calls, or text and
        messaging apps (e.g. SMS/MMS, WhatsApp).
      </Section>
      <Section title="5. Campaign and Promotion Terms">
        For selected campaigns, your contact information may be shared with authorised {brand.name} representatives
        or partner companies for the purpose of arranging a consultation, product trial, or service session. This
        may be a requirement to redeem any rewards or gifts tied to the campaign. Eligibility criteria (such as
        residency, age range, or one redemption per household) will apply and will be clearly stated in the
        campaign terms.
      </Section>
      <Section title="6. Referral Partners">
        {brand.name} may collaborate with introducers or referral partners who are compensated for connecting
        interested individuals with {brand.name}. Such introducers are not allowed to provide you with product
        advice, recommendations, or ongoing service. Their role is limited to making the introduction.
      </Section>
    </>
  );
}

function Section({ title, children }) {
  const { tokens: TOKENS, radius: RADIUS } = useCampaignTheme();
  return (
    <div style={{ marginTop: 20 }}>
      <p style={{ fontWeight: 700, color: TOKENS.ink, margin: 0, marginBottom: 6 }}>{title}</p>
      <p style={{ margin: 0 }}>{children}</p>
    </div>
  );
}
