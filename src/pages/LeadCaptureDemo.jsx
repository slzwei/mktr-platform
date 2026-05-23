import { useEffect, useMemo, useRef, useState } from 'react';
import CampaignSignupForm from '../components/campaigns/CampaignSignupForm';
import LeadCaptureLayout, { TOKENS, RADIUS } from '../components/campaigns/LeadCaptureLayout';
import CheckCircle from 'lucide-react/icons/check-circle';
import { brand } from '@/lib/brand';

/**
 * Demo / preview route for the new LeadCapture design.
 *
 * Mounts the same production components as /LeadCapture but feeds them
 * mock campaign data so the page renders end-to-end without a live backend.
 * Useful for visual validation; intercepts OTP send/verify and prospect
 * submit to short-circuit the API calls.
 *
 * Visit /LeadCapture/demo to see it.
 */

const MOCK_CAMPAIGN = {
  id: 'demo-campaign',
  name: 'Goodies SG',
  is_active: true,
  min_age: 21,
  max_age: 65,
  design_config: {
    formHeadline: 'Redeem Your Free Luggage',
    formSubheadline:
      'Fill in your details below to complete your redemption.',
    storyText:
      'Goodies SG is your go-to destination for exciting rewards, lifestyle perks, and exclusive giveaways.\n\nFrom travel essentials to everyday treats, we bring you thoughtfully curated goodies designed to add more joy to your daily life.\n\nComplete the form below to claim your complimentary luggage reward and be among the first to enjoy what Goodies SG has to offer.',
    storyEmphasis: "Limited quantities available — don't miss out!",
    heroCtaLabel: 'Redeem Your Luggage Now',
    ctaText: 'Submit Now',
    brandWordmark: 'goodies.sg',
    // brandFooter intentionally omitted here; demo wires brand.defaultPoweredBy via prop below
    regulatoryFooter:
      'Goodies SG (UEN: 202338805R) may be remunerated for each successful referral. By submitting, you agree to be contacted using the particulars you have provided. This form does not establish any advisory relationship.',
    themeColor: '#D17029',
    imageUrl: '',
    videoUrl: '',
    visibleFields: { phone: true, dob: true, postal_code: true, education_level: false, monthly_income: false },
    requiredFields: { dob: true, postal_code: false },
    fieldOrder: ['name', 'phone', 'email', 'dob', 'postal_code'],
    otpChannel: 'whatsapp',
  },
};

export default function LeadCaptureDemo() {
  const formRef = useRef(null);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    document.title = 'Lead Capture — Demo';
    // Patch apiClient.post so the form's verify/submit calls succeed.
    // We restore on unmount.
    let restore;
    (async () => {
      const { apiClient } = await import('@/api/client');
      const originalPost = apiClient.post;
      apiClient.post = async (url) => {
        // Simulate latency
        await new Promise((r) => setTimeout(r, url.includes('/verify/') ? 700 : 400));
        if (url.includes('/verify/send')) return { success: true };
        if (url.includes('/verify/check')) return { success: true, data: { verified: true } };
        if (url.includes('/prospects')) return { success: true };
        if (url.includes('/analytics')) return { success: true };
        return { success: true };
      };
      restore = () => {
        apiClient.post = originalPost;
      };
    })();
    return () => restore?.();
  }, []);

  const design = MOCK_CAMPAIGN.design_config;

  const story = useMemo(() => {
    const paragraphs = (design.storyText || '')
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter(Boolean);
    return paragraphs.length > 0 ? { paragraphs, emphasis: design.storyEmphasis } : null;
  }, [design.storyText, design.storyEmphasis]);

  const primaryCta = useMemo(
    () => ({
      label: design.heroCtaLabel || 'Get Started',
      color: design.themeColor,
      onClick: () => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    }),
    [design.heroCtaLabel, design.themeColor]
  );

  return (
    <LeadCaptureLayout
      design={design}
      maxWidth={undefined}
      wordmark={design.brandWordmark}
      story={story}
      primaryCta={primaryCta}
      regulatoryFooter={design.regulatoryFooter}
      brand={brand.defaultPoweredBy}
    >
      {submitted ? (
        <SuccessState />
      ) : (
        <div ref={formRef}>
          <CampaignSignupForm
            themeColor={design.themeColor}
            formHeadline={design.formHeadline}
            formSubheadline={design.formSubheadline}
            campaignId={MOCK_CAMPAIGN.id}
            campaign={MOCK_CAMPAIGN}
            onSubmit={async () => {
              await new Promise((r) => setTimeout(r, 600));
              setSubmitted(true);
            }}
            termsContent={design.termsContent}
            ctaLabel={design.ctaText}
          />
        </div>
      )}
    </LeadCaptureLayout>
  );
}

function SuccessState() {
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
      <a
        href="/LeadCapture/demo"
        style={{
          display: 'inline-flex',
          height: 52,
          paddingLeft: 28,
          paddingRight: 28,
          borderRadius: RADIUS.pill,
          backgroundColor: '#ffffff',
          color: TOKENS.body,
          border: `1px solid ${TOKENS.hairline}`,
          fontFamily: 'Albert Sans, system-ui, sans-serif',
          fontWeight: 600,
          fontSize: 15,
          alignItems: 'center',
          textDecoration: 'none',
        }}
      >
        Reset demo
      </a>
    </div>
  );
}
