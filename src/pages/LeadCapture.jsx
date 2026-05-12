import { useState, useEffect, useMemo, useRef } from 'react';
import { useLocation, Link } from 'react-router-dom';
import { Campaign } from '@/api/entities';
import CampaignSignupForm from '../components/campaigns/CampaignSignupForm';
import ShareCampaignDialog from '../components/campaigns/ShareCampaignDialog';
import AlertTriangle from 'lucide-react/icons/alert-triangle';
import CheckCircle from 'lucide-react/icons/check-circle';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import TypingLoader from '../components/ui/TypingLoader';
import { apiClient } from '@/api/client';
import LeadCaptureLayout, { TOKENS, RADIUS } from '../components/campaigns/LeadCaptureLayout';
import {
  shouldTrack,
  generateEventId,
  captureFbcFromUrl,
  readFbc,
  readFbp,
  initPixel,
  trackEvent,
  trackLead,
} from '../lib/metaPixel';

const DEFAULT_REGULATORY = `MKTR Pte. Ltd. (UEN: 202507548M) operates this referral platform. Submitting this form does not establish any advisory relationship and is not a recommendation of any product. By submitting, you agree to be contacted using the particulars provided.`;

const DEFAULT_BRAND = 'Powered by MKTR';

function brandFromCampaignName(name) {
  if (!name) return null;
  // Take the first significant word, drop punctuation
  const first = name.trim().split(/[\s—–-]+/)[0]?.toLowerCase();
  if (!first) return null;
  return `${first}.sg`;
}

function paragraphsFromText(text) {
  if (!text) return [];
  return text
    .split(/\n{2,}/) // blank-line separates paragraphs
    .map((p) => p.trim())
    .filter(Boolean);
}

export default function LeadCapture() {
  const location = useLocation();
  const formRef = useRef(null);
  const viewEventIdRef = useRef(null);
  const leadEventIdRef = useRef(null);
  const viewContentFiredRef = useRef(false);
  const [campaign, setCampaign] = useState(null);
  const [qrTag, setQrTag] = useState(null);
  const [error, setError] = useState(null);
  const [submitted, setSubmitted] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [referralMarked, setReferralMarked] = useState(false);
  const [duplicateDetected, setDuplicateDetected] = useState(false);
  const [duplicateCountdown, setDuplicateCountdown] = useState(5);

  // Meta Pixel: generate stable event IDs + capture fbclid on first mount.
  // These must persist across re-renders so the ViewContent event_id matches
  // any future references, and the Lead event_id matches the CAPI dispatch.
  useEffect(() => {
    if (!viewEventIdRef.current) viewEventIdRef.current = generateEventId();
    if (!leadEventIdRef.current) leadEventIdRef.current = generateEventId();
    captureFbcFromUrl(location.search);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Meta Pixel: fire ViewContent once the campaign is loaded and we're allowed
  // to track. Fire-once guard prevents re-emission on re-renders / HMR.
  useEffect(() => {
    if (viewContentFiredRef.current) return;
    if (!campaign) return;
    if (!shouldTrack({ campaign, pathname: location.pathname, search: location.search })) return;
    const pixelId = campaign.metaPixelId || import.meta.env.VITE_META_PIXEL_ID;
    if (!pixelId) return;
    initPixel(pixelId);
    trackEvent(
      'ViewContent',
      {
        content_name: campaign.name,
        content_category: 'lead_capture',
      },
      { eventID: viewEventIdRef.current }
    );
    viewContentFiredRef.current = true;
  }, [campaign, location.pathname, location.search]);

  // Ensure legacy preview page isn't indexed
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const isPreview = params.get('preview');
    if (isPreview) {
      const meta = document.querySelector('meta[name="robots"]') || document.createElement('meta');
      meta.setAttribute('name', 'robots');
      meta.setAttribute('content', 'noindex,nofollow');
      if (!meta.parentElement) document.head.appendChild(meta);
    }
  }, [location.search]);

  // Landing analytics
  useEffect(() => {
    (async () => {
      try {
        await apiClient.post('/analytics/events', {
          type: 'landing',
          meta: { path: '/lead-capture' },
        });
      } catch {
        /* ignore */
      }
    })();
  }, []);

  // Resolve campaign
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const preview = params.get('preview');

    (async () => {
      try {
        const resp = await apiClient.get('/qrcodes/session');
        let fetched = null;
        if (resp?.success && resp.data) {
          if (resp.data.campaign) fetched = resp.data.campaign;
          else if (resp.data.campaignId) fetched = await Campaign.get(resp.data.campaignId);
          setQrTag({ id: resp.data.qrTagId });
        } else if (params.get('campaign_id')) {
          const cid = params.get('campaign_id');
          try {
            const pub = await apiClient.get(`/previews/public/${cid}`);
            if (pub?.success && pub.data?.campaign) fetched = pub.data.campaign;
            else fetched = await Campaign.get(cid);
          } catch {
            fetched = await Campaign.get(cid);
          }
        } else {
          setError('No campaign or QR code specified.');
          return;
        }

        if (!preview && (!fetched || fetched.is_active === false)) {
          setError('This campaign is no longer active.');
          return;
        }
        setCampaign(fetched);
      } catch (err) {
        console.error('Error loading capture page:', err);
        setError('An error occurred while loading the page.');
      }
    })();
  }, [location.search]);

  // Referral analytics
  useEffect(() => {
    (async () => {
      try {
        const params = new URLSearchParams(location.search);
        const ref = params.get('ref') || params.get('refshare');
        if (ref && campaign && !referralMarked) {
          await apiClient.post('/analytics/referrals', { campaignId: campaign.id });
          setReferralMarked(true);
        }
      } catch {
        /* ignore */
      }
    })();
  }, [location.search, campaign, referralMarked]);

  const handleSubmit = async (formData) => {
    try {
      const params = new URLSearchParams(location.search);
      const isReferral = !!(params.get('ref') || params.get('refshare'));
      const name = (formData.name || '').trim();
      const [firstName, ...rest] = name.split(/\s+/);
      const lastName = rest.join(' ');

      const basePayload = {
        firstName,
        lastName,
        email: formData.email,
        phone: formData.phone,
        date_of_birth: formData.date_of_birth,
        postal_code: formData.postal_code,
        education_level: formData.education_level,
        monthly_income: formData.monthly_income,
        consent_contact: formData.consent_contact,
        consent_terms: formData.consent_terms,
        leadSource: isReferral ? 'referral' : qrTag?.id ? 'qr_code' : 'website',
        campaignId: campaign?.id,
        qrTagId: qrTag?.id,
        // Meta Pixel/CAPI dedup fields. eventId must match the Lead event_id
        // fired client-side below so Meta deduplicates Pixel + CAPI.
        eventId: leadEventIdRef.current,
        fbp: readFbp(),
        fbc: readFbc(),
        eventSourceUrl: typeof window !== 'undefined' ? window.location.href : undefined,
      };

      const payload = Object.fromEntries(
        Object.entries(basePayload).filter(([k, v]) => {
          if (k === 'lastName' && v === '') return true;
          return v !== null && v !== undefined && v !== '';
        })
      );

      const result = await apiClient.post('/prospects', payload, { skipAuth: true });
      if (result?.success) {
        // Fire Pixel Lead with the same eventId we sent to the backend so Meta
        // deduplicates this against the CAPI Lead dispatch. The OTP gate is
        // enforced upstream in CampaignSignupForm; reaching this branch means
        // the conversion is real.
        if (shouldTrack({ campaign, pathname: location.pathname, search: location.search })) {
          const pixelId = campaign?.metaPixelId || import.meta.env.VITE_META_PIXEL_ID;
          if (pixelId) {
            initPixel(pixelId);
            trackLead(
              {
                content_name: campaign?.name,
                value: 0,
                currency: 'SGD',
              },
              leadEventIdRef.current
            );
          }
        }
        setSubmitted(true);
        setShareOpen(true);
      } else {
        setError(result?.message || 'Submission failed. Please try again.');
      }
    } catch (err) {
      const msg = err?.message || '';
      if (/already signed up for this campaign/i.test(msg)) {
        setDuplicateDetected(true);
        setDuplicateCountdown(5);
        setSubmitted(false);
        setShareOpen(false);
        setError("You have already signed up for this campaign. We'll open the share options in 5 seconds.");
        return;
      }
      setError(msg || 'An error occurred. Please try again later.');
    }
  };

  // Duplicate countdown
  useEffect(() => {
    if (!duplicateDetected) return;
    setDuplicateCountdown(5);
    const interval = setInterval(() => {
      setDuplicateCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          setShareOpen(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [duplicateDetected]);

  const design = campaign?.design_config || {};

  // Derive story-card content from campaign data
  const wordmark = design.brandWordmark || brandFromCampaignName(campaign?.name);
  const storyParagraphs = useMemo(
    () => paragraphsFromText(design.storyText || design.formSubheadline),
    [design.storyText, design.formSubheadline]
  );
  const story = storyParagraphs.length > 0 ? { paragraphs: storyParagraphs, emphasis: design.storyEmphasis } : null;

  const hasHeroMedia = !!(design.imageUrl || design.videoUrl);
  const primaryCta = hasHeroMedia
    ? {
        label: design.heroCtaLabel || 'Get Started',
        color: design.themeColor,
        onClick: () => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      }
    : null;

  const regulatoryFooter = design.regulatoryFooter || DEFAULT_REGULATORY;
  const brand = design.brandFooter || DEFAULT_BRAND;

  const longShareUrl = useMemo(() => {
    const baseUrl = window.location.origin;
    return campaign ? `${baseUrl}/LeadCapture?campaign_id=${campaign.id}&ref=1` : window.location.href;
  }, [campaign]);

  // Loading state
  if (!campaign && !error) {
    return (
      <div style={{ minHeight: '100vh', backgroundColor: TOKENS.pagebg }}>
        <TypingLoader />
      </div>
    );
  }

  return (
    <LeadCaptureLayout
      design={design}
      maxWidth={design.formWidth}
      wordmark={wordmark}
      story={story}
      primaryCta={primaryCta}
      regulatoryFooter={regulatoryFooter}
      brand={brand}
    >
      {submitted ? (
        <SuccessState onShare={() => setShareOpen(true)} />
      ) : error ? (
        <ErrorState
          duplicateDetected={duplicateDetected}
          duplicateCountdown={duplicateCountdown}
          message={error}
          onShare={() => setShareOpen(true)}
        />
      ) : (
        <div ref={formRef}>
          <CampaignSignupForm
            themeColor={design.themeColor}
            formHeadline={design.formHeadline || 'Get Started'}
            formSubheadline={design.formSubheadline || 'Fill in your details below to complete your registration.'}
            campaignId={campaign.id}
            campaign={campaign}
            onSubmit={handleSubmit}
            termsContent={design.termsContent}
            ctaLabel={design.ctaText || 'Submit Now'}
          />
        </div>
      )}

      <ShareCampaignDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        campaignName={campaign?.name}
        campaignId={campaign?.id}
        longShareUrl={longShareUrl}
      />
    </LeadCaptureLayout>
  );
}

function SuccessState({ onShare }) {
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
          backgroundColor: '#ffffff',
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

function ErrorState({ duplicateDetected, duplicateCountdown, message, onShare }) {
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
              color: '#ffffff',
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
