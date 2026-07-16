import { useState, useEffect, useMemo, useRef } from 'react';
import { useLocation, Link } from 'react-router-dom';
import { Campaign } from '@/api/entities';
import CampaignSignupForm from '../components/campaigns/CampaignSignupForm';
import { QuizGate } from '../components/campaigns/CampaignQuiz';
import ShareCampaignDialog from '../components/campaigns/ShareCampaignDialog';
import AlertTriangle from 'lucide-react/icons/alert-triangle';
import CheckCircle from 'lucide-react/icons/check-circle';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import TypingLoader from '../components/ui/TypingLoader';
import { apiClient } from '@/api/client';
import LeadCaptureLayout, { TOKENS, RADIUS } from '../components/campaigns/LeadCaptureLayout';
import { deriveLeadCaptureContent } from '../components/campaigns/leadCaptureContent';
import GuidedReviewPage, { GuidedReviewSuccess } from '../components/campaigns/guided-review/GuidedReviewPage';
import {
  shouldTrack,
  generateEventId,
  captureFbcFromUrl,
  captureUtmsFromUrl,
  readFbc,
  readFbp,
  readUtms,
  ensureFbp,
  initPixel,
  trackEvent,
  trackLead,
  trackCompleteRegistration,
} from '../lib/metaPixel';
import {
  shouldTrackTikTok,
  captureTtclidFromUrl,
  readTtclid,
  readTtp,
  initTikTokPixel,
  trackTikTokViewContent,
  trackTikTokCompleteRegistration,
  trackTikTokLead,
} from '../lib/tiktokPixel';
import { getOrCreateVcState, markVcFired } from '../lib/pixelSession';

export default function LeadCapture() {
  const location = useLocation();
  const formRef = useRef(null);
  const viewEventIdRef = useRef(null);
  const leadEventIdRef = useRef(null);
  // Stable id for the quiz-reveal CompleteRegistration event — shared by the Meta
  // Pixel, TikTok Pixel, and (threaded into submit) the server-side CAPI so all
  // three dedup against one another.
  const registrationEventIdRef = useRef(null);
  const viewContentFiredRef = useRef(false); // Meta ViewContent fire-once
  const ttViewContentFiredRef = useRef(false); // TikTok ViewContent fire-once
  const [campaign, setCampaign] = useState(null);
  const [qrTag, setQrTag] = useState(null);
  const [error, setError] = useState(null);
  const [submitted, setSubmitted] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [referralMarked, setReferralMarked] = useState(false);
  // Referrer display name for the "Referred by …" badge (same-campaign-guarded server-side).
  const [referrerName, setReferrerName] = useState(null);
  // The created prospect's id — embedded in the share URL (?ref={id}) so a
  // friend's referred submit can be attributed back to this sharer.
  const [submittedProspectId, setSubmittedProspectId] = useState(null);
  // The canonical short share link the backend minted at creation — identical to the one
  // in the confirmation email. Preferred over the locally-built long URL when present.
  const [serverShareUrl, setServerShareUrl] = useState(null);
  // True after a fresh signup where an email was provided — the confirmation email (which
  // carries this same link) was dispatched, so the share dialog can say "also in your inbox".
  const [emailedLink, setEmailedLink] = useState(false);
  const [duplicateDetected, setDuplicateDetected] = useState(false);
  const [duplicateCountdown, setDuplicateCountdown] = useState(5);
  // Quiz funnel result (answers + client-scored result). Set when the in-front
  // quiz completes; its answers are threaded into the prospect submit below.
  const [quizResult, setQuizResult] = useState(null);

  // Meta Pixel: generate stable event IDs + capture fbclid and ad UTMs on
  // first mount. These must persist across re-renders so the ViewContent
  // event_id matches any future references, and the Lead event_id matches the
  // CAPI dispatch. UTMs ride along to the submit for sourceMetadata.utm.
  useEffect(() => {
    if (!leadEventIdRef.current) leadEventIdRef.current = generateEventId();
    if (!registrationEventIdRef.current) registrationEventIdRef.current = generateEventId();
    captureFbcFromUrl(location.search);
    captureTtclidFromUrl(location.search);
    // Capture UTM params from the landing URL into sessionStorage (last-touch,
    // mirrors the _mktr_fbc pattern) — forwarded into the prospect submit and
    // stored server-side in sourceMetadata.utm.
    captureUtmsFromUrl(location.search);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Meta + TikTok Pixel: fire ViewContent once the campaign is loaded and we're
  // allowed to track. Each platform is gated + fired independently (TikTok must
  // still fire when Meta is unconfigured, and vice-versa). Fire-once guards
  // prevent re-emission on re-renders / HMR. For a quiz campaign the page loads
  // straight into the quiz intro, so on-load ViewContent IS the quiz-start signal.
  useEffect(() => {
    if (!campaign) return;
    const trackCtx = { campaign, pathname: location.pathname, search: location.search };
    // Session-level once-per-campaign guard (vc:{campaign_id}): marketplace
    // traffic fires ViewContent on the offer detail page first, so a
    // detail → flow → /LeadCapture navigation must reuse the SAME event_id and
    // not re-fire. Per-platform flags stay independent (one platform being
    // unconfigured must not suppress the other). Direct traffic keeps today's
    // behaviour: first load fires once.
    const vc = getOrCreateVcState(campaign.id);
    viewEventIdRef.current = vc.eventId;

    if (!viewContentFiredRef.current && !vc.firedMeta && shouldTrack(trackCtx)) {
      const pixelId = campaign.metaPixelId || import.meta.env.VITE_META_PIXEL_ID;
      if (pixelId) {
        initPixel(pixelId);
        // Establish _fbp now (gated by shouldTrack above) so the Lead submit — and
        // the matching CAPI event — reliably carry it, even on a fast submit.
        ensureFbp();
        trackEvent(
          'ViewContent',
          { content_name: campaign.name, content_category: 'lead_capture' },
          { eventID: vc.eventId }
        );
        viewContentFiredRef.current = true;
        markVcFired(campaign.id, 'meta');
      }
    }

    if (!ttViewContentFiredRef.current && !vc.firedTiktok && shouldTrackTikTok(trackCtx)) {
      const ttPixelId = campaign?.tiktokPixelId || import.meta.env.VITE_TIKTOK_PIXEL_ID;
      if (ttPixelId) {
        initTikTokPixel(ttPixelId);
        trackTikTokViewContent(
          { content_name: campaign.name, content_type: 'lead_capture' },
          vc.eventId
        );
        ttViewContentFiredRef.current = true;
        markVcFired(campaign.id, 'tiktok');
      }
    }
  }, [campaign, location.pathname, location.search]);

  // Quiz result reveal → fire CompleteRegistration on both platforms (strongest
  // mid-funnel optimisation signal). Uses the shared registrationEventId so the
  // server-side CAPI CompleteRegistration (fired at submit) dedups against it.
  // Gated by shouldTrack / shouldTrackTikTok, so it never fires on preview pages.
  const handleQuizReveal = (result) => {
    const trackCtx = { campaign, pathname: location.pathname, search: location.search };
    const status = result?.title || result?.profileId || undefined;

    if (shouldTrack(trackCtx)) {
      const pixelId = campaign?.metaPixelId || import.meta.env.VITE_META_PIXEL_ID;
      if (pixelId) {
        initPixel(pixelId);
        trackCompleteRegistration(
          { content_name: campaign?.name, status },
          registrationEventIdRef.current
        );
      }
    }

    if (shouldTrackTikTok(trackCtx)) {
      const ttPixelId = campaign?.tiktokPixelId || import.meta.env.VITE_TIKTOK_PIXEL_ID;
      if (ttPixelId) {
        initTikTokPixel(ttPixelId);
        trackTikTokCompleteRegistration(
          { content_name: campaign?.name, content_type: 'lead_capture' },
          registrationEventIdRef.current
        );
      }
    }
  };

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
    const explicitCid = params.get('campaign_id');

    // Fetch a campaign by id, preferring the public preview endpoint.
    const fetchCampaignById = async (cid) => {
      try {
        const pub = await apiClient.get(`/previews/public/${cid}`);
        if (pub?.success && pub.data?.campaign) return pub.data.campaign;
      } catch {
        /* fall through to entity fetch */
      }
      return Campaign.get(cid);
    };

    (async () => {
      try {
        const resp = await apiClient.get('/qrcodes/session');
        const session = resp?.success && resp.data ? resp.data : null;
        const sessionCampaignId = session ? (session.campaign?.id ?? session.campaignId ?? null) : null;

        let fetched = null;

        // Prefer an explicit campaign_id from the URL. Only trust the session
        // (and its qrTag, which drives agent routing) when it agrees with the
        // explicit campaign — otherwise a stale session left by an earlier scan
        // of a different campaign would override the link the customer opened
        // (the Copy-Link mis-attribution case).
        if (explicitCid) {
          const sessionMatches =
            sessionCampaignId != null && String(sessionCampaignId) === String(explicitCid);
          if (session && sessionMatches) {
            fetched = session.campaign || (session.campaignId ? await Campaign.get(session.campaignId) : null);
            setQrTag(session.qrTagId ? { id: session.qrTagId } : null);
          } else {
            // No session, or it names a different campaign: use the explicit URL
            // campaign and do NOT carry over the stale qrTag.
            fetched = await fetchCampaignById(explicitCid);
            setQrTag(null);
          }
        } else if (session) {
          // No explicit campaign_id (e.g. a /t/{slug} scan that only set cookies):
          // fall back to the session's bound campaign + qrTag.
          fetched = session.campaign || (session.campaignId ? await Campaign.get(session.campaignId) : null);
          setQrTag(session.qrTagId ? { id: session.qrTagId } : null);
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
          // Marks the referral click AND returns the referrer's name (same-campaign
          // guarded; null for the anonymous ref=1 or a cross-campaign/unknown referrer).
          const resp = await apiClient.post('/analytics/referrals', { campaignId: campaign.id, ref });
          if (resp?.data?.referrerName) setReferrerName(resp.data.referrerName);
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
      const refValue = params.get('ref') || params.get('refshare');
      const isReferral = !!refValue;
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
        consent_third_party: formData.consent_third_party,
        // DNC-gate consent intent — CampaignSignupForm includes it ONLY when the
        // gate was shown (undefined otherwise → dropped by JSON.stringify). The
        // server builds the hold-release evidence from it (prospectService →
        // dncConsent); omitting it here stranded consented DNC-registered leads
        // in the held state until 2026-07-17.
        consent_dnc: formData.consent_dnc,
        leadSource: isReferral ? 'referral' : qrTag?.id ? 'qr_code' : 'website',
        campaignId: campaign?.id,
        qrTagId: qrTag?.id,
        // Meta Pixel/CAPI dedup fields. eventId must match the Lead event_id
        // fired client-side below so Meta deduplicates Pixel + CAPI.
        eventId: leadEventIdRef.current,
        fbp: readFbp(),
        fbc: readFbc(),
        eventSourceUrl: typeof window !== 'undefined' ? window.location.href : undefined,
        // Ad attribution captured at mount (sessionStorage, last-touch) —
        // stashed by the backend into sourceMetadata.utm for per-ad-set
        // reporting and the admin Source column.
        ...(readUtms() || {}),
        // Referral identity: forward the sharer's prospect UUID from the share
        // URL. '1' is the legacy anonymous flag — not worth sending.
        referralRef:
          isReferral && refValue && refValue !== '1' ? refValue.slice(0, 64) : undefined,
        // Quiz funnel: raw answers only (the server re-scores authoritatively
        // from the campaign's quiz def). The object survives the null/empty
        // filter below; undefined when this campaign has no quiz.
        quizResult: quizResult
          ? { quizId: quizResult.quizId, version: quizResult.version, answers: quizResult.answers }
          : undefined,
        // CompleteRegistration dedup id — only when a quiz reveal happened. Lets
        // the server fire a CAPI CompleteRegistration that dedups against the
        // browser Pixel one fired at the reveal.
        registrationEventId: quizResult ? registrationEventIdRef.current : undefined,
        // TikTok attribution identifiers (server-side Events API consumes these in
        // Phase 6). Captured from the landing URL / pixel cookie.
        ttclid: readTtclid() || undefined,
        ttp: readTtp() || undefined,
      };

      const payload = Object.fromEntries(
        Object.entries(basePayload).filter(([k, v]) => {
          if (k === 'lastName' && v === '') return true;
          return v !== null && v !== undefined && v !== '';
        })
      );

      const result = await apiClient.post('/prospects', payload, { skipAuth: true });
      if (result?.success) {
        // Keep the new prospect's id so this submitter's share links carry
        // their identity (?ref={id}) instead of the anonymous ref=1.
        setSubmittedProspectId(result?.data?.prospect?.id || null);
        // Canonical short share link minted server-side (matches the confirmation email).
        setServerShareUrl(result?.data?.shareUrl || null);
        // We email the confirmation (with this link) only when an email was provided.
        setEmailedLink(!!(formData.email && String(formData.email).trim()));
        // Fire Pixel Lead with the same eventId we sent to the backend so Meta
        // (and TikTok) deduplicate this against the server-side dispatch. The OTP
        // gate is enforced upstream in CampaignSignupForm; reaching this branch
        // means the conversion is real.
        const trackCtx = { campaign, pathname: location.pathname, search: location.search };
        if (shouldTrack(trackCtx)) {
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
        if (shouldTrackTikTok(trackCtx)) {
          const ttPixelId = campaign?.tiktokPixelId || import.meta.env.VITE_TIKTOK_PIXEL_ID;
          if (ttPixelId) {
            initTikTokPixel(ttPixelId);
            trackTikTokLead(
              { content_name: campaign?.name, value: 0, currency: 'SGD' },
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
        // Already-registered: use THEIR canonical attributed link from the 409 so the share
        // dialog shows their stable /share/{slug} instead of minting a fresh anonymous one.
        // (No new email is sent on a duplicate, so emailedLink stays false.)
        if (err?.data?.shareUrl) setServerShareUrl(err.data.shareUrl);
        if (err?.data?.prospectId) setSubmittedProspectId(err.data.prospectId);
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

  // Derive story-card / wordmark / footer slots — shared with /p/:slug preview
  // and the campaign designer's inline preview via deriveLeadCaptureContent.
  const content = useMemo(() => deriveLeadCaptureContent(campaign), [campaign]);

  // The shared helper returns pure content; attach this page's own CTA behavior
  // (scroll to the form). The story card sources from design.storyText only.
  const primaryCta = content.primaryCtaData
    ? {
        label: content.primaryCtaData.label,
        color: content.primaryCtaData.color,
        onClick: () => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      }
    : null;

  const longShareUrl = useMemo(() => {
    const baseUrl = window.location.origin;
    // ref carries the sharer's prospect id when we have one (post-submit) so
    // referred friends resolve to "Referred by {name}"; falls back to the
    // legacy anonymous ref=1 (e.g. duplicate-signup sharers have no id).
    const ref = submittedProspectId || '1';
    return campaign
      ? `${baseUrl}/LeadCapture?campaign_id=${campaign.id}&ref=${ref}`
      : window.location.href;
  }, [campaign, submittedProspectId]);

  // Loading state
  if (!campaign && !error) {
    return (
      <div style={{ minHeight: '100vh', backgroundColor: TOKENS.pagebg }}>
        <TypingLoader />
      </div>
    );
  }

  const shareDialog = (
    <ShareCampaignDialog
      open={shareOpen}
      onOpenChange={setShareOpen}
      campaignName={campaign?.name}
      campaignId={campaign?.id}
      prospectId={submittedProspectId}
      serverShareUrl={serverShareUrl}
      longShareUrl={longShareUrl}
      emailedLink={emailedLink}
    />
  );

  const captureExperience = error ? (
    <ErrorState
      duplicateDetected={duplicateDetected}
      duplicateCountdown={duplicateCountdown}
      message={error}
      onShare={() => setShareOpen(true)}
    />
  ) : (
    <div ref={formRef}>
      {referrerName && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            margin: '0 auto 16px',
            padding: '8px 16px',
            maxWidth: 'fit-content',
            background: TOKENS.storyCard,
            border: `1px solid ${TOKENS.hairline}`,
            borderRadius: 999,
            color: TOKENS.body,
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          <span aria-hidden="true">👋</span>
          <span>Referred by {referrerName}</span>
        </div>
      )}
      <QuizGate
        quiz={design.quiz}
        themeColor={design.themeColor}
        onReveal={handleQuizReveal}
        onComplete={setQuizResult}
      >
        <CampaignSignupForm
          themeColor={design.themeColor}
          formHeadline={design.formHeadline || 'Get Started'}
          formSubheadline={design.formSubheadline}
          campaignId={campaign?.id}
          campaign={campaign}
          onSubmit={handleSubmit}
          termsContent={design.termsContent}
          ctaLabel={design.ctaText || 'Submit Now'}
        />
      </QuizGate>
    </div>
  );

  if (campaign?.type === 'guided_review') {
    if (submitted) {
      return (
        <>
          <GuidedReviewSuccess
            config={design.guidedReview}
            campaignName={campaign.name}
            onShare={() => setShareOpen(true)}
          />
          {shareDialog}
        </>
      );
    }
    return (
      <>
        <GuidedReviewPage
          config={design.guidedReview}
          campaignName={campaign.name}
          onCta={() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
        >
          {captureExperience}
        </GuidedReviewPage>
        {shareDialog}
      </>
    );
  }

  return (
    <LeadCaptureLayout
      design={design}
      maxWidth={design.formWidth}
      wordmark={content.wordmark}
      story={content.story}
      primaryCta={primaryCta}
      regulatoryFooter={content.regulatoryFooter}
      brand={content.brand}
    >
      {submitted ? <SuccessState onShare={() => setShareOpen(true)} /> : captureExperience}
      {shareDialog}
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
