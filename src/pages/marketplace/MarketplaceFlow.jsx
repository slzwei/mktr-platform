import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import MarketplaceLayout from './MarketplaceLayout';
import MarketingConsentDialog from '@/components/legal/MarketingConsentDialog';
import { apiClient } from '@/api/client';
import { getMarketplaceCampaign } from '@/api/marketplace';
import { composeValueLine, fmtDateLong, isDrawCampaign, boostOf, offerUnavailability, UNAVAILABLE_COPY } from './content';
import { formatDateInput, getAgeValidationError } from '@/components/campaigns/signup/dateUtils';
import {
  shouldTrack, generateEventId, captureFbcFromUrl, captureUtmsFromUrl,
  readFbc, readFbp, readUtms, ensureFbp, initPixel, trackEvent, trackLead, trackCustomEvent,
} from '@/lib/metaPixel';
import {
  shouldTrackTikTok, captureTtclidFromUrl, readTtclid, readTtp,
  initTikTokPixel, trackTikTokViewContent, trackTikTokEvent, trackTikTokLead,
} from '@/lib/tiktokPixel';
import { getOrCreateVcState, markVcFired } from '@/lib/pixelSession';

/**
 * Marketplace redemption flow (/flow/:slug) — the step machine from the
 * approved Prototype v2, submitting into the EXISTING production pipeline:
 * POST /verify/send + /verify/check (OTP), POST /dnc/check, POST /prospects.
 *
 * Steps: [SC/PR screen?] → [advisor screen?] → details → [child?] → [prefs?]
 *        → otp → [dnc?] → consent → confirmation | duplicate.
 *
 * Form contract = the FLAT production keys (fieldOrder — legacy string[] OR
 * row objects {id, columns[]} — plus visibleFields / requiredFields).
 * Production fields default VISIBLE + REQUIRED unless explicitly false
 * (matching CampaignSignupForm semantics); the marketplace-only child/prefs
 * fields are opt-IN via visibleFields so existing campaigns are unaffected.
 */

/** Flatten both production fieldOrder shapes into an ordered id list. */
export function flattenFieldOrder(fieldOrder) {
  const fallback = ['name', 'phone', 'email', 'dob', 'postal_code', 'education_level', 'monthly_income'];
  if (!Array.isArray(fieldOrder) || fieldOrder.length === 0) return fallback;
  const out = [];
  for (const item of fieldOrder) {
    if (typeof item === 'string') out.push(item);
    else if (item && Array.isArray(item.columns)) out.push(...item.columns.filter((c) => typeof c === 'string'));
  }
  return out.length ? out : fallback;
}

// Production select options — these values map to prospect columns consumed
// downstream (FieldRenderer.jsx is the source of truth; keep in lock-step).
const EDUCATION_OPTIONS = ['Secondary School or below', 'O Levels', 'Diploma', 'Degree', 'Masters and above'];
const INCOME_OPTIONS = ['<$3000', '$3000 - $4999', '$5000 - $7999', '>$8000'];

const FIELD_DEFS = {
  name: { label: 'Full name', autoComplete: 'name', placeholder: 'John Tan' },
  phone: { label: 'Mobile number', type: 'tel', inputMode: 'numeric', autoComplete: 'tel', placeholder: '8-digit SG mobile' },
  email: { label: 'Email', type: 'email', autoComplete: 'email', placeholder: 'you@example.com' },
  dob: { label: 'Date of birth', inputMode: 'numeric', placeholder: 'DD/MM/YYYY' },
  postal_code: { label: 'Postal code', inputMode: 'numeric', placeholder: '6-digit postal code' },
  education_level: { label: 'Education level', options: EDUCATION_OPTIONS },
  monthly_income: { label: 'Monthly income', options: INCOME_OPTIONS },
};

const ALWAYS_VISIBLE = new Set(['name', 'email', 'phone']);
// Production visibility semantics (CampaignSignupForm submit validation is
// the authority): dob/postal render unless explicitly hidden; education/
// income are opt-IN; required only when requiredFields[key] === true.
const OPT_IN_VISIBLE = new Set(['education_level', 'monthly_income']);

/** Exported for tests — mirrors the live form's field visibility contract. */
export function isFieldVisible(key, visibleFields = {}) {
  if (ALWAYS_VISIBLE.has(key)) return true;
  if (FIELD_DEFS[key]) {
    return OPT_IN_VISIBLE.has(key) ? visibleFields[key] === true : visibleFields[key] !== false;
  }
  return visibleFields[key] === true; // marketplace extras are opt-in
}

/** Exported for tests — required ONLY on an explicit true (live-form parity). */
export function isFieldRequired(key, requiredFields = {}) {
  if (ALWAYS_VISIBLE.has(key)) return true;
  return requiredFields[key] === true;
}

/** DD/MM/YYYY (display mask) → YYYY-MM-DD (API contract, live-form parity). */
export function dobToIso(v) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((v || '').trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
}
const STEP_LABELS = { screen: 'Eligibility', advisor: 'Industry check', details: 'Your details', child: 'Your child', prefs: 'Preferences', otp: 'Verify', dnc: 'DNC consent', consent: 'Confirm' };

export default function MarketplaceFlow() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [campaign, setCampaign] = useState(undefined);
  const [qrTagId, setQrTagId] = useState(null);
  const leadEventIdRef = useRef(null);

  const [stepIdx, setStepIdx] = useState(0);
  const [blocked, setBlocked] = useState(null); // null | 'scpr' | 'advisor'
  const [form, setForm] = useState({
    name: '', phone: '', email: '', dob: '', postal_code: '', education_level: '', monthly_income: '',
    child_name: '', child_level: '', branch: '', day: '', time: '',
  });
  const [errors, setErrors] = useState({});
  const [otp, setOtp] = useState({ status: 'idle', code: '', cooldown: 0, error: '' });
  const [dnc, setDnc] = useState({ checked: false, hit: false, consent: false });
  const [consent, setConsent] = useState({ contact: true, terms: false, third: false });
  const [ack, setAck] = useState(false);
  const [termsOpen, setTermsOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null); // {kind:'done', ...} | {kind:'duplicate'}
  const [toast, setToast] = useState('');

  useEffect(() => {
    if (!leadEventIdRef.current) leadEventIdRef.current = generateEventId();
    captureFbcFromUrl(window.location.search);
    captureTtclidFromUrl(window.location.search);
    captureUtmsFromUrl(window.location.search);
  }, []);

  useEffect(() => {
    let alive = true;
    getMarketplaceCampaign(slug)
      .then((c) => alive && setCampaign(c))
      .catch(() => alive && setCampaign(null));
    // QR attribution: same session lookup LeadCapture uses, so tracker-set
    // cookies still bind the lead to its scanned tag.
    apiClient
      .get('/qrcodes/session', { skipAuth: true })
      .then((resp) => {
        if (alive && resp?.data?.qrTag?.id) setQrTagId(resp.data.qrTag.id);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [slug]);

  // Session-guarded ViewContent — fires here only when this is the FIRST
  // public content surface this session (direct links); detail-first traffic
  // already fired with the same event_id.
  useEffect(() => {
    if (!campaign) return;
    const trackCtx = { campaign, pathname: window.location.pathname, search: window.location.search };
    const vc = getOrCreateVcState(campaign.id);
    if (!vc.firedMeta && shouldTrack(trackCtx)) {
      const pixelId = campaign.metaPixelId || import.meta.env.VITE_META_PIXEL_ID;
      if (pixelId) {
        initPixel(pixelId);
        ensureFbp();
        trackEvent(
          'ViewContent',
          { content_ids: [campaign.id], content_name: campaign.name, content_category: campaign.design_config?.category || 'marketplace' },
          { eventID: vc.eventId }
        );
        markVcFired(campaign.id, 'meta');
      }
    }
    if (!vc.firedTiktok && shouldTrackTikTok(trackCtx)) {
      const ttPixelId = campaign.tiktokPixelId || import.meta.env.VITE_TIKTOK_PIXEL_ID;
      if (ttPixelId) {
        initTikTokPixel(ttPixelId);
        trackTikTokViewContent({ content_name: campaign.name, content_type: 'marketplace' }, vc.eventId);
        markVcFired(campaign.id, 'tiktok');
      }
    }
  }, [campaign]);

  // OTP resend cooldown tick
  useEffect(() => {
    if (otp.cooldown <= 0) return;
    const t = setTimeout(() => setOtp((p) => ({ ...p, cooldown: p.cooldown - 1 })), 1000);
    return () => clearTimeout(t);
  }, [otp.cooldown]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 2800);
    return () => clearTimeout(t);
  }, [toast]);

  const dc = campaign?.design_config || {};
  const visibleFields = dc.visibleFields || {};
  const requiredFields = dc.requiredFields || {};
  const isVisible = (key) => isFieldVisible(key, visibleFields);
  const isRequired = (key) => isFieldRequired(key, requiredFields);

  const isDraw = isDrawCampaign(campaign);
  const boost = boostOf(campaign);
  const act = dc.activation || {};
  const needAck = act.required === true;
  const trackCustom = (name, params = {}) => {
    const trackCtx = { campaign, pathname: window.location.pathname, search: window.location.search };
    if (shouldTrack(trackCtx)) trackCustomEvent(name, params);
    if (shouldTrackTikTok(trackCtx)) trackTikTokEvent(name, params);
  };

  const steps = useMemo(() => {
    if (!campaign) return [];
    const s = [];
    if (dc.sgPrOnly === true) s.push('screen');
    if (dc.excludeAdvisors === true) s.push('advisor');
    s.push('details');
    if (isVisible('child_name') || isVisible('child_school_level')) s.push('child');
    if (isVisible('preferred_branch') || isVisible('preferred_timing')) s.push('prefs');
    s.push('otp');
    if (dnc.hit) s.push('dnc');
    s.push('consent');
    return s;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaign, dnc.hit]);

  const idx = Math.min(stepIdx, Math.max(steps.length - 1, 0));
  const current = steps[idx];

  const setField = (key, value) => {
    setForm((p) => ({ ...p, [key]: value }));
    setErrors((p) => ({ ...p, [key]: undefined }));
  };

  const validateDetails = () => {
    const errs = {};
    for (const key of flattenFieldOrder(dc.fieldOrder)) {
      if (!FIELD_DEFS[key] || !isVisible(key)) continue;
      const v = (form[key] || '').trim();
      if (!v) {
        if (isRequired(key)) errs[key] = 'This field is required.';
        continue;
      }
      if (key === 'name' && v.length < 2) errs.name = 'Please enter your full name.';
      if (key === 'phone' && !/^[89]\d{7}$/.test(v.replace(/\s/g, ''))) errs.phone = 'Enter an 8-digit Singapore mobile starting with 8 or 9.';
      if (key === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) errs.email = 'Enter a valid email address.';
      if (key === 'postal_code' && !/^\d{6}$/.test(v)) errs.postal_code = 'Enter a 6-digit Singapore postal code.';
      if (key === 'dob') {
        // Age gate = campaign min_age/max_age COLUMNS (server re-checks, 422).
        const ageErr = getAgeValidationError(v, campaign);
        if (v.replace(/\D/g, '').length !== 8) errs.dob = 'Enter a valid date as DD/MM/YYYY.';
        else if (ageErr) errs.dob = ageErr;
      }
    }
    return errs;
  };

  const validateStep = (stepId) => {
    if (stepId === 'details') return validateDetails();
    const errs = {};
    if (stepId === 'child') {
      if (isVisible('child_name') && isRequired('child_name') && form.child_name.trim().length < 2) errs.child_name = "Please enter your child's name.";
      if (isVisible('child_school_level') && isRequired('child_school_level') && !form.child_level) errs.child_level = 'Select a level.';
    }
    if (stepId === 'prefs') {
      if (isVisible('preferred_branch') && isRequired('preferred_branch') && !form.branch) errs.branch = 'Pick a branch.';
    }
    return errs;
  };

  const advance = () => {
    const errs = validateStep(current);
    if (Object.keys(errs).length) {
      setErrors(errs);
      return;
    }
    setErrors({});
    setStepIdx(Math.min(idx + 1, steps.length - 1));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const goBack = () => {
    if (idx === 0) {
      navigate(`/offers/${slug}`);
      return;
    }
    setErrors({});
    setStepIdx(idx - 1);
  };

  const sendOtp = async () => {
    setOtp((p) => ({ ...p, status: 'sending', error: '' }));
    try {
      const resp = await apiClient.post('/verify/send', { phone: form.phone, countryCode: '+65', campaignId: campaign.id }, { skipAuth: true });
      if (resp?.success) {
        setOtp((p) => ({ ...p, status: 'pending', cooldown: 30 }));
        trackCustom('otp_sent');
      } else {
        setOtp((p) => ({ ...p, status: 'idle', error: resp?.message || "We couldn't send the code — try again." }));
      }
    } catch (err) {
      setOtp((p) => ({ ...p, status: 'idle', error: err?.message || "We couldn't send the code — try again." }));
    }
  };

  const verifyOtp = async () => {
    setOtp((p) => ({ ...p, status: 'verifying', error: '' }));
    setDnc({ checked: false, hit: false, consent: false });
    try {
      const resp = await apiClient.post('/verify/check', { phone: form.phone, code: otp.code, countryCode: '+65' }, { skipAuth: true });
      const verified = resp?.success && (resp?.data?.verified === true || resp?.data?.status === 'approved');
      if (!verified) {
        setOtp((p) => ({ ...p, status: 'pending', error: "That code didn't match. Check the 6 digits and try again." }));
        return;
      }
      setOtp((p) => ({ ...p, status: 'verified', error: '' }));
      trackCustom('otp_verified');
      if (dc.dncCheckAtSubmit === true) {
        try {
          const d = await apiClient.post('/dnc/check', { phone: form.phone, countryCode: '+65', campaignId: campaign.id }, { skipAuth: true });
          const hit = d?.data?.registered === true;
          setDnc({ checked: true, hit, consent: false });
          if (hit) trackCustom('dnc_gate_shown');
        } catch {
          setDnc({ checked: true, hit: false, consent: false }); // fails open, like production
        }
      } else {
        setDnc({ checked: true, hit: false, consent: false });
      }
    } catch (err) {
      setOtp((p) => ({ ...p, status: 'pending', error: err?.message || 'Verification failed — try again.' }));
    }
  };

  const submit = async () => {
    if (!consent.terms || (needAck && !ack) || (dnc.hit && !dnc.consent) || submitting) return;
    setSubmitting(true);
    try {
      const name = form.name.trim();
      const [firstName, ...restName] = name.split(/\s+/);
      const marketplaceMeta = {
        ...(form.child_name ? { child_name: form.child_name.trim() } : {}),
        ...(form.child_level ? { child_school_level: form.child_level } : {}),
        ...(form.branch ? { preferred_branch: form.branch } : {}),
        ...([form.day, form.time].filter(Boolean).length ? { preferred_timing: [form.day, form.time].filter(Boolean).join(' ') } : {}),
      };
      const basePayload = {
        firstName,
        lastName: restName.join(' '),
        email: form.email,
        phone: form.phone,
        // API contract is ISO YYYY-MM-DD (live-form parity) — the display
        // mask is DD/MM/YYYY, which new Date() misparses server-side.
        date_of_birth: dobToIso(form.dob),
        postal_code: form.postal_code,
        education_level: form.education_level,
        monthly_income: form.monthly_income,
        consent_contact: consent.contact,
        consent_terms: consent.terms,
        consent_third_party: consent.third,
        ...(dnc.hit ? { consent_dnc: dnc.consent } : {}),
        leadSource: qrTagId ? 'qr_code' : 'website',
        campaignId: campaign.id,
        qrTagId: qrTagId || undefined,
        eventId: leadEventIdRef.current,
        fbp: readFbp(),
        fbc: readFbc(),
        eventSourceUrl: typeof window !== 'undefined' ? window.location.href : undefined,
        ...(readUtms() || {}),
        ttclid: readTtclid() || undefined,
        ttp: readTtp() || undefined,
        ...(Object.keys(marketplaceMeta).length ? { marketplace: marketplaceMeta } : {}),
      };
      const payload = Object.fromEntries(
        Object.entries(basePayload).filter(([k, v]) => {
          if (k === 'lastName' && v === '') return true;
          return v !== null && v !== undefined && v !== '';
        })
      );

      const resp = await apiClient.post('/prospects', payload, { skipAuth: true });
      if (resp?.success) {
        const trackCtx = { campaign, pathname: window.location.pathname, search: window.location.search };
        if (shouldTrack(trackCtx)) {
          trackLead(
            { content_ids: [campaign.id], content_name: campaign.name, content_category: dc.category || 'marketplace' },
            leadEventIdRef.current
          );
        }
        if (shouldTrackTikTok(trackCtx)) {
          trackTikTokLead({ content_name: campaign.name }, leadEventIdRef.current);
        }
        if (isDraw) trackCustom('draw_entry_confirmed');
        setResult({
          kind: 'done',
          ref: resp?.data?.prospect?.id || '',
          shareUrl: resp?.data?.shareUrl || '',
        });
        window.scrollTo({ top: 0 });
      } else {
        setToast(resp?.message || 'Something went wrong — please try again.');
      }
    } catch (err) {
      if (err?.status === 409 && err?.data?.alreadyRegistered) {
        trackCustom('duplicate_blocked');
        setResult({ kind: 'duplicate' });
        window.scrollTo({ top: 0 });
      } else {
        setToast(err?.message || 'Something went wrong — please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  /* ---------- render ---------- */

  if (campaign === undefined) {
    return (
      <MarketplaceLayout>
        <div className="rm-shell rm-shell--flow" style={{ padding: 'clamp(24px,3.5vw,40px) 0' }}>
          <div className="rm-shimmer" style={{ height: 380, borderRadius: 22 }} />
        </div>
      </MarketplaceLayout>
    );
  }

  if (campaign === null) {
    return (
      <MarketplaceLayout>
        <div className="rm-shell rm-shell--flow" style={{ padding: 'clamp(24px,3.5vw,40px) 0 clamp(56px,7vw,88px)' }}>
          <div className="rm-card" style={{ padding: '48px 28px', textAlign: 'center' }}>
            <div className="rm-serif" style={{ fontSize: 26 }}>This campaign isn't available</div>
            <Link className="rm-btn" to="/explore" style={{ marginTop: 18 }}>Explore live offers</Link>
          </div>
        </div>
      </MarketplaceLayout>
    );
  }

  // The flow must never accept submissions the pipeline can't service —
  // sold-out / ended / closed-draw campaigns get a courteous stop, not a form
  // (mid-flow submits on a just-exhausted offer still surface server-side).
  const unavailable = offerUnavailability(campaign);
  if (unavailable && !result) {
    const copy = UNAVAILABLE_COPY[unavailable];
    return (
      <MarketplaceLayout>
        <div className="rm-shell rm-shell--flow" style={{ padding: 'clamp(24px,3.5vw,40px) 0 clamp(56px,7vw,88px)' }}>
          <div className="rm-card rm-fadeup" style={{ padding: '48px 28px', textAlign: 'center' }}>
            <div className="rm-serif" style={{ fontSize: 26 }}>{copy.title}</div>
            <p style={{ margin: '10px auto 20px', fontSize: 14, lineHeight: 1.65, color: 'var(--rm-sub)', maxWidth: '46ch' }}>{copy.body}</p>
            <Link className="rm-btn" to="/explore">Explore live offers</Link>
          </div>
        </div>
      </MarketplaceLayout>
    );
  }

  const partnerName = campaign.ops?.partner?.name || '';
  const valueLine = composeValueLine(campaign);
  const otpChannelLabel = dc.otpChannel === 'whatsapp' ? 'WhatsApp' : 'SMS';
  const phoneMasked = form.phone ? `${form.phone.slice(0, 4)} ${form.phone.slice(4)}` : '';
  const submitReady = consent.terms && (!needAck || ack) && (!dnc.hit || dnc.consent) && !submitting;
  const missingText = submitting
    ? ''
    : `${!consent.terms ? 'Campaign terms consent is required. ' : ''}${needAck && !ack ? 'Please acknowledge the activation requirement.' : ''}`;

  const orderedFields = flattenFieldOrder(dc.fieldOrder).filter((k) => FIELD_DEFS[k] && isVisible(k));
  const branches = (campaign.ops?.partner?.locations || []).filter((l) => l.name);
  const dncChecking = otp.status === 'verified' && !dnc.checked;

  return (
    <MarketplaceLayout>
      <div className="rm-shell rm-shell--flow" style={{ paddingTop: 'clamp(24px,3.5vw,40px)', paddingBottom: 'clamp(56px,7vw,88px)' }}>
        <button className="rm-link-btn" style={{ color: 'var(--rm-mut)' }} onClick={() => navigate(`/offers/${slug}`)}>
          ← Back to offer
        </button>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginTop: 4 }}>
          <h1 className="rm-serif" style={{ margin: 0, fontSize: 'clamp(24px,3vw,30px)' }}>{dc.name || campaign.name}</h1>
          <span className="rm-mono-note" style={{ fontSize: 11 }}>{partnerName}</span>
        </div>
        {valueLine && <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--rm-pine)', marginTop: 6 }}>{valueLine}</div>}

        {!result && !blocked && (
          <div className="rm-progress">
            <div className="rm-progress-line" aria-hidden="true" />
            <div className="rm-progress-steps">
              {steps.map((s, i) => (
                <div key={s} className={`rm-progress-step${i === idx ? ' is-current' : ''}${i < idx ? ' is-done' : ''}`}>
                  <span className="rm-progress-dot">{i + 1}</span>
                  <span className="rm-progress-label">{STEP_LABELS[s]}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="rm-card" style={{ borderRadius: 22, padding: 'clamp(22px,4vw,36px)', boxShadow: 'var(--rm-sh)', marginTop: result || blocked ? 22 : 0 }}>
          {blocked ? (
            <div className="rm-fadeup" style={{ textAlign: 'center', padding: '12px 0' }}>
              <div style={{ width: 56, height: 70, borderRadius: '28px 28px 5px 5px', background: 'var(--rm-sage)', margin: '0 auto 18px' }} />
              <h2 className="rm-serif" style={{ margin: 0, fontSize: 23 }}>Thanks for checking this one out</h2>
              <p style={{ margin: '10px auto 20px', fontSize: 14, lineHeight: 1.65, color: 'var(--rm-sub)', maxWidth: '46ch' }}>
                {blocked === 'scpr'
                  ? "This particular campaign is only open to Singapore Citizens and PRs, so we can't take your details for it. Plenty of others don't have this condition."
                  : "This campaign's sponsor excludes financial-advisory and insurance industry members, so we can't take your details for it. Plenty of other offers are open to you."}
              </p>
              <Link className="rm-btn" to="/explore">Browse open offers</Link>
            </div>
          ) : result?.kind === 'duplicate' ? (
            <div className="rm-fadeup" style={{ textAlign: 'center', padding: '10px 0' }}>
              <div style={{ width: 56, height: 70, borderRadius: '28px 28px 5px 5px', background: 'var(--rm-sage)', margin: '0 auto 16px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>👋</div>
              <h2 className="rm-serif" style={{ margin: 0, fontSize: 24 }}>You've already redeemed this one</h2>
              <p style={{ margin: '10px auto 20px', fontSize: 14, lineHeight: 1.65, color: 'var(--rm-sub)', maxWidth: '46ch' }}>
                Good news — your original redemption stands, and the details are in your email. Each offer is one per person, so this submission wasn't recorded twice.
              </p>
              <Link className="rm-btn" to="/explore">See what else is on</Link>
            </div>
          ) : result?.kind === 'done' ? (
            <Confirmation
              campaign={campaign}
              isDraw={isDraw}
              boost={boost}
              needAck={needAck}
              actSummary={act.summary}
              consentContact={consent.contact}
              result={result}
              partnerName={partnerName}
              onCopyShare={() => {
                if (result.shareUrl && navigator.clipboard) navigator.clipboard.writeText(result.shareUrl);
                setToast('Referral link copied');
              }}
            />
          ) : current === 'screen' ? (
            <div className="rm-fadeup">
              <h2 className="rm-serif" style={{ margin: 0, fontSize: 23, lineHeight: 1.25 }}>Are you a Singapore Citizen or Permanent Resident?</h2>
              <p style={{ margin: '10px 0 22px', fontSize: 13.5, lineHeight: 1.6, color: 'var(--rm-sub)' }}>
                This campaign's sponsor requires it — we ask before you share any details.
              </p>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <button className="rm-btn rm-btn--big" style={{ flex: 1, minWidth: 140, borderRadius: 14 }} onClick={advance}>Yes, I am</button>
                <button className="rm-btn rm-btn--outline" style={{ flex: 1, minWidth: 140, borderRadius: 14 }} onClick={() => setBlocked('scpr')}>No, I'm not</button>
              </div>
            </div>
          ) : current === 'advisor' ? (
            <div className="rm-fadeup">
              <h2 className="rm-serif" style={{ margin: 0, fontSize: 23, lineHeight: 1.25 }}>Do you work in financial advisory or insurance distribution?</h2>
              <p style={{ margin: '10px 0 22px', fontSize: 13.5, lineHeight: 1.6, color: 'var(--rm-sub)' }}>
                This campaign's sponsor excludes industry members — we ask before you share any details.
              </p>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <button className="rm-btn rm-btn--big" style={{ flex: 1, minWidth: 140, borderRadius: 14 }} onClick={advance}>No, I'm not</button>
                <button className="rm-btn rm-btn--outline" style={{ flex: 1, minWidth: 140, borderRadius: 14 }} onClick={() => setBlocked('advisor')}>Yes, I am</button>
              </div>
            </div>
          ) : current === 'details' ? (
            <div className="rm-fadeup" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <h2 className="rm-serif" style={{ margin: 0, fontSize: 23 }}>Your details</h2>
                <p style={{ margin: '8px 0 0', fontSize: 13, lineHeight: 1.55, color: 'var(--rm-sub)' }}>
                  Only what's needed to arrange your redemption — nothing more.
                </p>
              </div>
              {orderedFields.map((key) => {
                const def = FIELD_DEFS[key];
                const optional = !isRequired(key);
                return (
                  <label key={key} style={{ display: 'block' }}>
                    <span className="rm-label">
                      {def.label} {optional && <span className="rm-opt">(optional)</span>}
                    </span>
                    {def.options ? (
                      <select className="rm-select" name={key} value={form[key]} onChange={(e) => setField(key, e.target.value)}>
                        <option value="">Select…</option>
                        {def.options.map((op) => <option key={op} value={op}>{op}</option>)}
                      </select>
                    ) : (
                      <input
                        className="rm-input"
                        name={key}
                        type={def.type || 'text'}
                        inputMode={def.inputMode}
                        autoComplete={def.autoComplete}
                        placeholder={def.placeholder}
                        value={form[key]}
                        onChange={(e) => {
                          let v = e.target.value;
                          if (key === 'dob') v = formatDateInput(v);
                          if (key === 'phone') {
                            let digits = v.replace(/\D/g, '');
                            if (digits.startsWith('65') && digits.length > 8) digits = digits.substring(2);
                            v = digits.slice(0, 8);
                            // Verification is bound to the number it was earned
                            // for — editing the phone invalidates OTP + DNC state
                            // (otherwise verify A, back-navigate, submit B).
                            if (v !== form.phone && otp.status !== 'idle') {
                              setOtp({ status: 'idle', code: '', cooldown: 0, error: '' });
                              setDnc({ checked: false, hit: false, consent: false });
                            }
                          }
                          setField(key, v);
                        }}
                      />
                    )}
                    <span className="rm-err">{errors[key] || ''}</span>
                  </label>
                );
              })}
              <StepNav onBack={goBack} onNext={advance} />
            </div>
          ) : current === 'child' ? (
            <div className="rm-fadeup" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <h2 className="rm-serif" style={{ margin: 0, fontSize: 23 }}>About your child</h2>
                <p style={{ margin: '8px 0 0', fontSize: 13, lineHeight: 1.55, color: 'var(--rm-sub)' }}>
                  So {partnerName || 'the partner'} can pitch the session at the right level.
                </p>
              </div>
              {isVisible('child_name') && (
                <label style={{ display: 'block' }}>
                  <span className="rm-label">Child's name {!isRequired('child_name') && <span className="rm-opt">(optional)</span>}</span>
                  <input className="rm-input" value={form.child_name} onChange={(e) => setField('child_name', e.target.value)} />
                  <span className="rm-err">{errors.child_name || ''}</span>
                </label>
              )}
              {isVisible('child_school_level') && (dc.school_levels || []).length > 0 && (
                <div>
                  <span className="rm-label" style={{ marginBottom: 8 }}>School level {!isRequired('child_school_level') && <span className="rm-opt">(optional)</span>}</span>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {dc.school_levels.map((lv) => (
                      <button key={lv} className={`rm-chip rm-chip--pick${form.child_level === lv ? ' is-active' : ''}`} onClick={() => setField('child_level', lv)}>
                        {lv}
                      </button>
                    ))}
                  </div>
                  <span className="rm-err">{errors.child_level || ''}</span>
                </div>
              )}
              <StepNav onBack={goBack} onNext={advance} />
            </div>
          ) : current === 'prefs' ? (
            <div className="rm-fadeup" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div>
                <h2 className="rm-serif" style={{ margin: 0, fontSize: 23 }}>Your preferences</h2>
                <p style={{ margin: '8px 0 0', fontSize: 13, lineHeight: 1.55, color: 'var(--rm-sub)' }}>
                  The partner confirms the final slot with you directly.
                </p>
              </div>
              {isVisible('preferred_branch') && branches.length > 0 && (
                <div>
                  <span className="rm-label" style={{ marginBottom: 8 }}>Preferred branch {!isRequired('preferred_branch') && <span className="rm-opt">(optional)</span>}</span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {branches.map((b) => (
                      <button
                        key={b.name}
                        className={`rm-check${form.branch === b.name ? ' is-checked' : ''}`}
                        style={{ justifyContent: 'space-between', alignItems: 'center' }}
                        onClick={() => setField('branch', b.name)}
                      >
                        <span style={{ fontSize: 14, fontWeight: 600 }}>{b.name}</span>
                        {b.area && <span className="rm-mono-label" style={{ fontSize: 10 }}>{b.area}</span>}
                      </button>
                    ))}
                  </div>
                  <span className="rm-err">{errors.branch || ''}</span>
                </div>
              )}
              {isVisible('preferred_timing') && (
                <>
                  {(dc.availability?.days || []).length > 0 && (
                    <div>
                      <span className="rm-label" style={{ marginBottom: 8 }}>Preferred day <span className="rm-opt">(optional)</span></span>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {dc.availability.days.map((d) => (
                          <button key={d} className={`rm-chip rm-chip--pick${form.day === d ? ' is-active' : ''}`} onClick={() => setField('day', form.day === d ? '' : d)}>{d}</button>
                        ))}
                      </div>
                    </div>
                  )}
                  {(dc.availability?.slots || []).length > 0 && (
                    <div>
                      <span className="rm-label" style={{ marginBottom: 8 }}>Preferred time <span className="rm-opt">(optional)</span></span>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {dc.availability.slots.map((t) => (
                          <button key={t} className={`rm-chip rm-chip--pick${form.time === t ? ' is-active' : ''}`} onClick={() => setField('time', form.time === t ? '' : t)}>{t}</button>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
              <StepNav onBack={goBack} onNext={advance} />
            </div>
          ) : current === 'otp' ? (
            <div className="rm-fadeup" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <h2 className="rm-serif" style={{ margin: 0, fontSize: 23 }}>Verify your number</h2>
                <p style={{ margin: '8px 0 0', fontSize: 13, lineHeight: 1.6, color: 'var(--rm-sub)' }}>
                  We'll send a one-time code to <strong style={{ color: 'var(--rm-ink)' }}>{phoneMasked}</strong> via {otpChannelLabel}. This confirms it's really you — no account is created.
                </p>
              </div>
              {otp.status === 'idle' && (
                <>
                  <button className="rm-btn rm-btn--big" style={{ alignSelf: 'flex-start' }} onClick={sendOtp}>
                    Send code via {otpChannelLabel}
                  </button>
                  {otp.error && <span className="rm-err">{otp.error}</span>}
                </>
              )}
              {otp.status === 'sending' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, color: 'var(--rm-sub)' }}>
                  <span className="rm-spin" />Sending your code…
                </div>
              )}
              {(otp.status === 'pending') && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <label style={{ display: 'block' }}>
                    <span className="rm-label">Enter the 6-digit code</span>
                    <input
                      className="rm-input"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      value={otp.code}
                      onChange={(e) => setOtp((p) => ({ ...p, code: e.target.value.replace(/\D/g, '').slice(0, 6) }))}
                      placeholder="••••••"
                      style={{ maxWidth: 240, fontFamily: 'var(--rm-mono)', fontSize: 22, letterSpacing: '0.4em', borderRadius: 12 }}
                    />
                  </label>
                  {otp.error && <span className="rm-err" style={{ minHeight: 0 }}>{otp.error}</span>}
                  <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
                    <button className="rm-btn rm-btn--big" onClick={verifyOtp} disabled={otp.code.length !== 6}>Verify</button>
                    {otp.cooldown > 0 ? (
                      <span className="rm-mono-note" style={{ fontSize: 11.5 }}>Resend in {otp.cooldown}s</span>
                    ) : (
                      <button className="rm-link-btn" onClick={sendOtp}>Resend code</button>
                    )}
                  </div>
                </div>
              )}
              {otp.status === 'verifying' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, color: 'var(--rm-sub)' }}>
                  <span className="rm-spin" />Checking your code…
                </div>
              )}
              {otp.status === 'verified' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--rm-ok)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 19, fontWeight: 700, animation: 'rmPop 0.4s ease both' }}>✓</span>
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--rm-ok)' }}>Number verified</div>
                      <div style={{ fontSize: 12.5, color: 'var(--rm-sub)' }}>{phoneMasked} is confirmed as yours.</div>
                    </div>
                  </div>
                  {dncChecking ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-start' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--rm-sub)' }}>
                        <span className="rm-spin" style={{ width: 14, height: 14 }} />Checking your number against the Do-Not-Call registry…
                      </div>
                      <button className="rm-btn rm-btn--big rm-btn--disabled" disabled>Continue</button>
                    </div>
                  ) : (
                    <button className="rm-btn rm-btn--big" style={{ alignSelf: 'flex-start' }} onClick={advance}>Continue</button>
                  )}
                </div>
              )}
              <div>
                <button className="rm-link-btn" style={{ color: 'var(--rm-mut)' }} onClick={goBack}>Back</button>
              </div>
            </div>
          ) : current === 'dnc' ? (
            <div className="rm-fadeup" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <h2 className="rm-serif" style={{ margin: 0, fontSize: 23, lineHeight: 1.25 }}>One more consent — your number is on the Do-Not-Call registry</h2>
                <p style={{ margin: '10px 0 0', fontSize: 13.5, lineHeight: 1.65, color: 'var(--rm-sub)' }}>
                  You've registered this number on Singapore's DNC registry, which we respect. To proceed with this campaign, the partner and sponsor need your explicit permission to contact you about it. Nothing happens without it.
                </p>
              </div>
              <button
                className={`rm-check${dnc.consent ? ' is-checked' : ''}`}
                role="checkbox"
                aria-checked={dnc.consent}
                style={{ background: 'var(--rm-bg)', borderRadius: 14, padding: 16 }}
                onClick={() => {
                  const next = !dnc.consent;
                  setDnc((p) => ({ ...p, consent: next }));
                  if (next) trackCustom('dnc_consent_given');
                }}
              >
                <span className="rm-check-box">{dnc.consent ? '✓' : ''}</span>
                <span className="rm-check-text" style={{ fontSize: 13.5 }}>
                  I consent to being contacted about this campaign at the number I verified, even though it is listed on the DNC registry.
                </span>
              </button>
              <div style={{ fontSize: 12, lineHeight: 1.55, color: 'var(--rm-mut)' }}>
                Declining simply means we can't proceed with this campaign — your DNC registration stays fully respected.
              </div>
              <StepNav onBack={goBack} onNext={advance} nextDisabled={!dnc.consent} />
            </div>
          ) : current === 'consent' ? (
            <div className="rm-fadeup" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <h2 className="rm-serif" style={{ margin: 0, fontSize: 23 }}>Almost there</h2>
                <p style={{ margin: '8px 0 0', fontSize: 13, lineHeight: 1.55, color: 'var(--rm-sub)' }}>
                  Read once, tick what you agree to. No surprises later.
                </p>
              </div>
              {needAck && (
                <div style={{ background: '#F2F6EF', border: '1.5px solid var(--rm-pine)', borderRadius: 14, padding: '16px 18px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <span className="rm-ticket" style={{ width: 10, height: 13 }} />
                    <span className="rm-mono-label" style={{ color: 'var(--rm-pine)', fontSize: 10 }}>Activation requirement</span>
                  </div>
                  <div style={{ fontSize: 13, lineHeight: 1.6 }}>{act.detail}</div>
                  <button
                    className={`rm-check${ack ? ' is-checked' : ''}`}
                    role="checkbox"
                    aria-checked={ack}
                    style={{ border: 'none', padding: '12px 0 0', minHeight: 44 }}
                    onClick={() => setAck(!ack)}
                  >
                    <span className="rm-check-box">{ack ? '✓' : ''}</span>
                    <span className="rm-check-text" style={{ fontWeight: 600 }}>I understand and accept this requirement.</span>
                  </button>
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <ConsentCheck checked={consent.contact} onToggle={() => setConsent((p) => ({ ...p, contact: !p.contact }))}>
                  Contact me about this redemption using the details I've provided. <span style={{ color: 'var(--rm-mut)' }}>(Pre-ticked — untick if you'd rather we didn't.)</span>
                </ConsentCheck>
                <ConsentCheck checked={consent.terms} onToggle={() => setConsent((p) => ({ ...p, terms: !p.terms }))}>
                  I agree to this campaign's{' '}
                  {dc.termsContent ? (
                    <button className="rm-underline" style={{ color: 'var(--rm-pine)', fontWeight: 600 }} onClick={(e) => { e.stopPropagation(); setTermsOpen(true); }}>
                      terms &amp; conditions
                    </button>
                  ) : (
                    'terms & conditions'
                  )}
                  . <span style={{ fontFamily: 'var(--rm-mono)', fontSize: 9.5, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--rm-err)' }}>Required</span>
                </ConsentCheck>
                <ConsentCheck checked={consent.third} onToggle={() => setConsent((p) => ({ ...p, third: !p.third }))}>
                  Share my contact details with the sponsoring licensed financial-advisory representative for this campaign. <span style={{ color: 'var(--rm-mut)' }}>(Optional — a separate choice from the two above.)</span>
                </ConsentCheck>
                {dc.sponsor?.disclosure && (
                  <div style={{ fontSize: 11.5, lineHeight: 1.55, color: 'var(--rm-mut)', padding: '0 4px' }}>{dc.sponsor.disclosure}</div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
                <button className="rm-link-btn" style={{ color: 'var(--rm-mut)' }} onClick={goBack}>Back</button>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                  <button className={`rm-btn rm-btn--big${!submitReady ? ' rm-btn--disabled' : ''}`} disabled={!submitReady} onClick={submit}>
                    {submitting ? 'Submitting…' : isDraw ? 'Confirm my entry' : 'Confirm redemption'}
                  </button>
                  {missingText && <span style={{ fontFamily: 'var(--rm-mono)', fontSize: 10, color: 'var(--rm-warn)', maxWidth: 300, textAlign: 'right' }}>{missingText}</span>}
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <div className="rm-mono-note" style={{ fontSize: 10, letterSpacing: '0.05em', textAlign: 'center', marginTop: 16 }}>
          OTP-verified · consent recorded with submission · data used only as stated on the offer
        </div>
      </div>

      <MarketingConsentDialog open={termsOpen} onOpenChange={setTermsOpen} content={dc.termsContent} />

      {toast && (
        <div role="status" style={{ position: 'fixed', bottom: 26, left: '50%', transform: 'translateX(-50%)', zIndex: 90, background: 'var(--rm-ink)', color: '#F6F2E6', fontSize: 13.5, fontWeight: 500, padding: '12px 22px', borderRadius: 999, boxShadow: '0 12px 30px rgba(23,37,31,0.3)' }}>
          {toast}
        </div>
      )}
    </MarketplaceLayout>
  );
}

function StepNav({ onBack, onNext, nextDisabled }) {
  return (
    <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', marginTop: 6 }}>
      <button className="rm-link-btn" style={{ color: 'var(--rm-mut)' }} onClick={onBack}>Back</button>
      <button className={`rm-btn rm-btn--big${nextDisabled ? ' rm-btn--disabled' : ''}`} disabled={nextDisabled} onClick={onNext}>
        Continue
      </button>
    </div>
  );
}

function ConsentCheck({ checked, onToggle, children }) {
  return (
    <button className={`rm-check${checked ? ' is-checked' : ''}`} role="checkbox" aria-checked={checked} onClick={onToggle}>
      <span className="rm-check-box">{checked ? '✓' : ''}</span>
      <span className="rm-check-text">{children}</span>
    </button>
  );
}

function Confirmation({ campaign, isDraw, boost, needAck, actSummary, consentContact, result, partnerName, onCopyShare }) {
  const dc = campaign.design_config || {};
  return (
    <div className="rm-fadeup" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ textAlign: 'center', padding: '8px 0 4px' }}>
        <span style={{ width: 62, height: 62, borderRadius: '50%', background: 'var(--rm-ok)', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, fontWeight: 700, animation: 'rmPop 0.45s ease both' }}>✓</span>
        <h2 className="rm-serif" style={{ margin: '14px 0 0', fontSize: 26 }}>{isDraw ? "You're in the draw" : 'Redemption confirmed'}</h2>
        <div className="rm-mono-note" style={{ fontSize: 11, marginTop: 6 }}>
          {result.ref ? `Reference ${String(result.ref).slice(0, 8).toUpperCase()} · ` : ''}{dc.name || campaign.name}
        </div>
      </div>

      <div style={{ background: 'var(--rm-bg)', border: '1px solid var(--rm-line)', borderRadius: 14, padding: '18px 20px' }}>
        <div className="rm-mono-label" style={{ fontSize: 10, marginBottom: 10 }}>What happens next</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9, fontSize: 13.5, lineHeight: 1.6 }}>
          {isDraw ? (
            <>
              <Step n="1" apricot>Your entry is recorded — one chance in the draw, nothing more to do.</Step>
              {boost && (
                <Step n="2" apricot>
                  <strong>Boost your odds:</strong> complete the activation step before {fmtDateLong(boost.boostClosesAt)} and this entry counts ×{boost.multiplier}.{' '}
                  {consentContact ? 'The details are in your confirmation email, and the consultant can reach you at your verified number.' : 'The details are in your confirmation email.'}
                </Step>
              )}
              <Step n={boost ? '3' : '2'} apricot>
                Entries close on {fmtDateLong(dc.luckyDraw?.closesAt)};{dc.luckyDraw?.winners ? ` ${dc.luckyDraw.winners}` : ''} winners are drawn within seven days.
              </Step>
              <Step n={boost ? '4' : '3'} apricot>
                Winners are contacted at the number you verified and listed on the <Link to="/winners" className="rm-underline">winners page</Link>.
              </Step>
            </>
          ) : (
            <>
              <Step n="1">{partnerName || 'The partner'} will contact you to confirm your slot.</Step>
              <Step n="2">Expect first contact within one working day{consentContact ? ', at the number you verified' : ''}.</Step>
              <Step n="3">A confirmation has also been sent to your email.</Step>
            </>
          )}
        </div>
      </div>

      {needAck && !isDraw && (
        <div style={{ background: '#F2F6EF', border: '1px solid #CFDDD2', borderRadius: 14, padding: '14px 18px', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <span className="rm-ticket" style={{ width: 10, height: 13, marginTop: 3, flexShrink: 0 }} />
          <span style={{ fontSize: 12.5, lineHeight: 1.6, color: 'var(--rm-pine2)' }}>
            <strong>Reminder:</strong> {actSummary} — your experience is confirmed after this step.
          </span>
        </div>
      )}

      {result.shareUrl && (
        <div style={{ background: 'var(--rm-bg)', border: '1px solid var(--rm-line)', borderRadius: 14, padding: '14px 18px', display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0 }}>
            <div className="rm-mono-label" style={{ fontSize: 10, marginBottom: 4 }}>Share with a friend</div>
            <div style={{ fontFamily: 'var(--rm-mono)', fontSize: 11.5, color: 'var(--rm-sub)', overflowWrap: 'anywhere' }}>{result.shareUrl}</div>
          </div>
          <button className="rm-btn rm-btn--outline" onClick={onCopyShare} style={{ flexShrink: 0 }}>Copy link</button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
        <Link className="rm-btn" to="/explore">Explore more offers</Link>
      </div>
      <div className="rm-mono-note" style={{ fontSize: 10.5, textAlign: 'center' }}>Need help? support@redeem.sg</div>
    </div>
  );
}

function Step({ n, apricot, children }) {
  return (
    <div style={{ display: 'flex', gap: 10 }}>
      <span style={{ color: apricot ? 'var(--rm-apr2)' : 'var(--rm-pine)', fontWeight: 700 }}>{n}</span>
      <span>{children}</span>
    </div>
  );
}
