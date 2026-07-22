import { useState, useEffect, Fragment } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { apiClient } from '@/api/client';
import FieldRenderer from '@/components/campaigns/signup/FieldRenderer';
import OTPVerification from '@/components/campaigns/signup/OTPVerification';
import DncConsentGate from '@/components/campaigns/signup/DncConsentGate';
import ConsentAgreementDialog from '@/components/campaigns/signup/ConsentAgreementDialog';
import { useCampaignTheme } from '@/components/campaignPage/themeContext';
import { heroFontStack } from '@/lib/heroFonts';
import {
  CONSENT_INLINE, CONSENT_COPY_VERSION, CONSENT_BLOCK_HELPER,
  isSponsoredCampaign, sponsorNameLine,
} from '@/lib/consentCopy';
import { formatDateInput, getAgeValidationError, getAgeRestrictionHint, displayPhone } from '@/components/campaigns/signup/dateUtils';

/**
 * Public lead-capture form. Visual style is locked to the warm-cream/Fraunces
 * editorial aesthetic; campaign.design_config.themeColor still drives the
 * primary action color (CTA, focus rings, checkbox fill).
 *
 * Phone + OTP is always required for the public form — it is the lead pipeline's
 * identity/dedup key, so phone cannot be hidden via config.
 *
 * `previewMode` (used by the campaign designer's inline preview and the
 * /p/:slug admin preview) stubs every network path: OTP send/verify are
 * simulated locally (any 6-digit code passes) and submit short-circuits before
 * `onSubmit`, so a preview can never send a real OTP or create a real prospect.
 */
export default function CampaignSignupForm({
  themeColor,
  formHeadline,
  formSubheadline,
  campaignId,
  onSubmit,
  campaign,
  termsContent,
  ctaLabel,
  previewMode = false,
  // v2 (Campaign Studio) content.advertiserName — the DNC gate's advertiser
  // display; defaults to the campaign name exactly as v1 behaves.
  advertiserName,
  // Studio funnel-state jumper (previewJumpFixtures.js): initial-state fixture
  // consumed ONLY when previewMode === true. Live mounts never pass it, and a
  // leaked fixture is inert by construction (every initializer gates itself).
  previewFixture,
}) {
  const { tokens: TOKENS, radius: RADIUS, onAccent } = useCampaignTheme();
  const accent = themeColor || TOKENS.accent;
  const visibleFields = campaign?.design_config?.visibleFields || {};
  const requiredFields = campaign?.design_config?.requiredFields || {};
  const fieldOrder = campaign?.design_config?.fieldOrder || ['name', 'phone', 'email', 'dob', 'postal_code', 'education_level', 'monthly_income'];
  const otpChannel = campaign?.design_config?.otpChannel || 'sms';
  const headingFont = heroFontStack(campaign?.design_config?.heroFont);
  const sgPrOnly = campaign?.design_config?.sgPrOnly === true;
  const excludeAdvisors = campaign?.design_config?.excludeAdvisors === true;
  const dncCheckAtSubmit = campaign?.design_config?.dncCheckAtSubmit === true;
  // Sponsored-campaign disclosure clause in the agree-all block: renders ONLY
  // for a campaign with a NAMED sponsor (§9.5-1 — the clause promises the
  // sponsor is "named on this page") that hasn't turned the
  // thirdPartyDisclosure kill-switch off. Not shown => consent_third_party
  // stays false => no external-delivery evidence (fail-closed).
  const sponsoredClause = isSponsoredCampaign(campaign?.design_config);

  // Preview-only jump fixture (Studio PR 3): gated PER-INITIALIZER on
  // previewMode === true, so a fixture reaching a live mount changes nothing.
  // Fixtures deliberately cannot seed `otp` — a 6-digit code would auto-verify
  // on mount (OTPVerification), which live would mean a real /verify/check.
  const fx = previewMode === true && previewFixture ? previewFixture : null;

  const [formData, setFormData] = useState(() => ({
    name: '',
    email: '',
    phone: '',
    postal_code: '',
    date_of_birth: '',
    education_level: '',
    monthly_income: '',
    ...(fx?.formData || {}),
  }));
  const [otp, setOtp] = useState('');
  const [otpState, setOtpState] = useState(fx?.otpState ?? 'idle');
  // DNC consent gate (inert unless dncCheckAtSubmit). 'unknown' | 'checking' | 'on_dnc' | 'clear'.
  const [dncStatus, setDncStatus] = useState(fx?.dncStatus ?? 'unknown');
  const [dncConsent, setDncConsent] = useState(fx?.dncConsent ?? false);
  const [loading, setLoading] = useState(fx?.loading ?? null);
  const [error, setError] = useState(fx?.error ?? '');
  const [previewNotice, setPreviewNotice] = useState('');
  const [ageError, setAgeError] = useState('');
  const [dobIncomplete, setDobIncomplete] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(fx?.resendCooldown ?? 0);
  const [showSuccessTick, setShowSuccessTick] = useState(false);
  // SG/PR eligibility gate: null = not answered, 'eligible' = show form, 'no' = blocked.
  const [eligibility, setEligibility] = useState(fx?.eligibility ?? null);
  // Financial-consultant exclusion gate: null = not answered, 'public' = show form, 'advisor' = blocked.
  const [advisorAck, setAdvisorAck] = useState(fx?.advisorAck ?? null);

  // Mandatory agree-all consent (wording era CONSENT_COPY_VERSION): ONE
  // required checkbox under the clause list — contact+marketing (brand-wide),
  // campaign T&C, and (when thirdPartyDisclosure) the sponsored third-party
  // clause. No agree, no submit; the payload therefore sends all consent
  // booleans as true plus consent_copy_version so the backend pins the exact
  // wording as evidence. The DNC gate stays a SEPARATE consent (own state,
  // own consent_dnc field) — it never rides on this checkbox.
  const [consentAll, setConsentAll] = useState(fx?.consentAll ?? false);
  const [consentOpen, setConsentOpen] = useState(fx?.consentOpen ?? false);

  const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const getFullPhoneNumber = () => `+65${formData.phone}`;
  const renderAgeRestrictionHint = () => getAgeRestrictionHint(campaign);

  // Resend cooldown tick
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown((p) => p - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  const handleDobBlur = () => {
    const digits = formData.date_of_birth.replace(/\D/g, '');
    setDobIncomplete(digits.length > 0 && digits.length !== 8);
  };

  const handleFormChange = (key, value) => {
    if (key === 'phone') {
      let digits = value.replace(/\D/g, '');
      if (digits.startsWith('65') && digits.length > 8) digits = digits.substring(2);
      setFormData((prev) => ({ ...prev, phone: digits.slice(0, 8) }));
    } else if (key === 'date_of_birth') {
      const formattedDate = formatDateInput(value);
      setFormData((prev) => ({ ...prev, [key]: formattedDate }));
      const digitsOnly = formattedDate.replace(/\D/g, '');
      if (digitsOnly.length === 8 && dobIncomplete) setDobIncomplete(false);
      setAgeError(getAgeValidationError(formattedDate, campaign));
    } else {
      setFormData((prev) => ({ ...prev, [key]: value }));
    }
  };

  const handleSendOtp = async () => {
    if (formData.phone.length !== 8) {
      setError('Please enter a valid 8-digit Singapore phone number.');
      return;
    }
    if (!['3', '6', '8', '9'].includes(formData.phone[0])) {
      setError('Invalid number. Must start with 3, 6, 8, or 9.');
      return;
    }

    setLoading('sending');
    setError('');

    // Preview: simulate sending without hitting /verify/send.
    if (previewMode) {
      setTimeout(() => {
        setOtpState('pending');
        setResendCooldown(30);
        setLoading(null);
      }, 600);
      return;
    }

    try {
      const response = await apiClient.post(
        '/verify/send',
        { phone: formData.phone, countryCode: '+65', campaignId },
        { skipAuth: true }
      );
      if (response.success) {
        setOtpState('pending');
        setResendCooldown(30);
      } else {
        setError(response.message || 'Failed to send verification code. Please try again.');
      }
    } catch (err) {
      let msg = 'Unable to send verification code. Please try again.';
      // apiClient errors carry err.status / err.data / err.message — never
      // err.response (this branch was dead until 2026-07-17).
      const respData = err.data;
      if (err.status === 429) {
        msg = 'Too many verification attempts. Please wait 10 minutes before trying again.';
        setResendCooldown(600);
      } else if (respData?.message) {
        msg = respData.message;
        if (respData.retryAfter) setResendCooldown(respData.retryAfter);
      } else if (err.message) {
        msg = err.message;
      }
      setError(msg);
    }
    setLoading(null);
  };

  const handleVerifyOtp = async (codeToVerify) => {
    const code = typeof codeToVerify === 'string' ? codeToVerify : otp;
    if (!code || code.length < 6) return;

    setLoading('verifying');
    setError('');

    // Preview: any 6-digit code verifies, without hitting /verify/check.
    if (previewMode) {
      setLoading(null);
      setError('');
      setShowSuccessTick(true); // panel plays the success/collapse animation, then calls onVerified()
      return;
    }

    try {
      const response = await apiClient.post(
        '/verify/check',
        { phone: formData.phone, code, countryCode: '+65' },
        { skipAuth: true }
      );
      const verified = response.success && (response.data?.verified === true || response.data?.status === 'approved');
      if (verified) {
        setLoading(null);
        setError('');
        setShowSuccessTick(true); // panel plays the success/collapse animation, then calls onVerified()
      } else {
        let msg = response?.message || 'Verification failed. Please try again.';
        if (msg.includes('incorrect') || response.data?.status === 'pending') {
          msg = 'Incorrect code. Codes are time-sensitive — please double-check and try again.';
        }
        setError(msg);
        setLoading(null);
      }
    } catch (err) {
      // The verify rate limiter is shared across /verify/send and /verify/check,
      // so a 429 here gets the same friendly cooldown as a send 429.
      if (err.status === 429) {
        setError('Too many verification attempts. Please wait 10 minutes before trying again.');
        setResendCooldown(600);
      } else {
        const respData = err.data;
        setError(respData?.message || err.message || 'Verification failed. Please try again.');
      }
      setLoading(null);
    }
  };

  const handleCancelOtp = () => {
    setOtpState('idle');
    setOtp('');
    setError('');
    setDncStatus('unknown');
    setDncConsent(false);
    setResendCooldown(0);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setPreviewNotice('');

    if (!formData.name || !formData.email) {
      setError('Please fill in all required fields.');
      return;
    }
    // Phone is always required for the public form (identity/dedup key).
    if (!formData.phone) {
      setError('Please enter your phone number.');
      return;
    }
    if (otpState !== 'verified') {
      setError('Please verify your phone number before submitting.');
      return;
    }
    if (visibleFields.dob !== false && formData.date_of_birth && formData.date_of_birth.length > 0 && formData.date_of_birth.length !== 10) {
      setError('Please enter a complete date of birth (DD/MM/YYYY).');
      return;
    }
    if (visibleFields.dob !== false && ageError) {
      setError('Please correct the date of birth to meet the age requirements.');
      return;
    }
    if (visibleFields.dob !== false && requiredFields.dob && (!formData.date_of_birth || formData.date_of_birth.length !== 10)) {
      setError('Date of birth is required.');
      return;
    }
    if (visibleFields.postal_code !== false && requiredFields.postal_code && !formData.postal_code) {
      setError('Postal code is required.');
      return;
    }
    if (visibleFields.education_level === true && requiredFields.education_level && !formData.education_level) {
      setError('Highest education is required.');
      return;
    }
    if (visibleFields.monthly_income === true && requiredFields.monthly_income && !formData.monthly_income) {
      setError('Last drawn salary is required.');
      return;
    }
    if (!consentAll) {
      setError(CONSENT_BLOCK_HELPER);
      return;
    }

    setLoading('submitting');
    setError('');

    let dobFormatted = null;
    if (formData.date_of_birth && formData.date_of_birth.length === 10) {
      const [day, month, year] = formData.date_of_birth.split('/');
      const parsed = new Date(Number(year), Number(month) - 1, Number(day));
      if (parsed.getDate() === Number(day) && parsed.getMonth() === Number(month) - 1 && parsed.getFullYear() === Number(year)) {
        dobFormatted = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      } else {
        setError('Please enter a valid date of birth.');
        setLoading(null);
        return;
      }
    }

    const dataToSubmit = {
      ...formData,
      phone: getFullPhoneNumber(),
      date_of_birth: visibleFields.dob !== false ? dobFormatted : null,
      postal_code: visibleFields.postal_code !== false ? formData.postal_code : null,
      education_level: visibleFields.education_level === true ? formData.education_level : null,
      monthly_income: visibleFields.monthly_income === true ? formData.monthly_income : null,
      campaign_id: campaignId,
      // Agree-all: submission implies the whole block, so the booleans are
      // literals; the third-party grant is true iff the sponsored disclosure
      // clause was actually shown (clause not shown => no consent to
      // disclose). consent_copy_version tells the backend WHICH wording to
      // pin as evidence.
      consent_contact: true,
      consent_terms: true,
      consent_third_party: sponsoredClause,
      consent_copy_version: CONSENT_COPY_VERSION,
      // DNC consent intent (the server builds the authoritative evidence). Only sent when
      // the gate was actually shown for this lead.
      ...(dncCheckAtSubmit && dncStatus === 'on_dnc' ? { consent_dnc: dncConsent } : {}),
    };

    // Preview: stop here — never call onSubmit (which would create a real
    // prospect on the parent page). Show a neutral, non-error notice instead.
    if (previewMode) {
      setLoading(null);
      setError('');
      setPreviewNotice('Preview — your details were not submitted.');
      return;
    }

    try {
      await onSubmit(dataToSubmit);
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Submission failed.');
    }
    setLoading(null);
  };

  // Clear the error as soon as the user edits the code, so a failed attempt's
  // red highlight lifts while they retype instead of lingering on the field.
  const handleOtpChange = (value) => {
    if (error) setError('');
    setOtp(value);
  };

  // Called by the panel once its collapse animation finishes — flip to the
  // verified state so the phone row's "Verified" badge takes over.
  const handleOtpVerified = () => {
    setOtpState('verified');
    setShowSuccessTick(false);
    // DNC check — fired only AFTER OTP is verified (so the result can't be used as an
    // "is X on DNC?" oracle) and only when the campaign opted in. Fail-open: any error /
    // non-SG / preview leaves dncStatus 'clear' so no gate appears (the backend scrub is
    // the compliance net).
    if (dncCheckAtSubmit && !previewMode) {
      setDncStatus('checking');
      setDncConsent(false);
      apiClient
        .post('/dnc/check', { phone: formData.phone, countryCode: '+65', campaignId }, { skipAuth: true })
        .then((res) => setDncStatus(res?.data?.registered ? 'on_dnc' : 'clear'))
        .catch(() => setDncStatus('clear'));
    }
  };

  // Inline verification panel — slides down beneath the phone field (no modal).
  const phoneOtpPanel = (
    <OTPVerification
      otpState={otpState}
      otp={otp}
      setOtp={handleOtpChange}
      loading={loading}
      error={error}
      showSuccessTick={showSuccessTick}
      resendCooldown={resendCooldown}
      displayPhone={displayPhone}
      phone={formData.phone}
      themeColor={accent}
      handleVerifyOtp={handleVerifyOtp}
      handleCancelOtp={handleCancelOtp}
      handleSendOtp={handleSendOtp}
      onVerified={handleOtpVerified}
      channel={otpChannel}
    />
  );

  const fieldRendererProps = {
    formData,
    themeColor: accent,
    visibleFields,
    requiredFields,
    handleFormChange,
    displayPhone,
    otpState,
    loading,
    handleSendOtp,
    // Lets the idle-state Verify button honor the send cooldown (a 429 used to
    // set it while nothing outside the OTP panel read it).
    resendCooldown,
    handleDobBlur,
    dobIncomplete,
    ageError,
    renderAgeRestrictionHint,
    phoneOtpPanel,
  };

  // DNC consent gate: rendered beneath the verified phone field when the campaign opted in
  // and the verified number is on the registry. While open and not consented, the other
  // fields lock and submit is disabled. Entirely inert when dncCheckAtSubmit is off.
  const dncGateOpen = dncCheckAtSubmit && dncStatus === 'on_dnc';
  const gateLocked = dncGateOpen && !dncConsent;
  const renderField = (fieldId) => {
    if (fieldId === 'phone') {
      return (
        <Fragment key="phone">
          <FieldRenderer fieldId="phone" {...fieldRendererProps} />
          {dncGateOpen && (
            <DncConsentGate
              advertiser={advertiserName || campaign?.name}
              consented={dncConsent}
              onGiveConsent={() => setDncConsent(true)}
              onRevoke={() => setDncConsent(false)}
            />
          )}
        </Fragment>
      );
    }
    return <FieldRenderer key={fieldId} fieldId={fieldId} {...fieldRendererProps} locked={gateLocked} />;
  };

  const submitDisabled =
    otpState !== 'verified' ||
    loading === 'submitting' ||
    ageError !== '' ||
    dobIncomplete ||
    !isValidEmail(formData.email) ||
    !consentAll ||
    (dncCheckAtSubmit && dncStatus === 'checking') ||
    gateLocked;

  // SG/PR eligibility gate (campaign.design_config.sgPrOnly): a Yes/No screening
  // card shown before the form. "Yes" reveals + animates the form in; "No" shows a
  // polite, reversible ineligible message. No gate when sgPrOnly is off.
  if (sgPrOnly && eligibility !== 'eligible') {
    return (
      <AnimatePresence mode="wait">
        {eligibility === 'no' ? (
          <motion.div
            key="ineligible"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
          >
            <h2
              style={{
                fontFamily: headingFont,
                fontWeight: 800,
                fontSize: 'clamp(24px, 5.5vw, 30px)',
                lineHeight: 1.15,
                color: TOKENS.ink,
                margin: 0,
                marginBottom: 12,
              }}
            >
              Thanks for your interest
            </h2>
            <p
              style={{
                fontFamily: 'Albert Sans, system-ui, sans-serif',
                fontSize: 16,
                lineHeight: 1.55,
                color: TOKENS.body,
                margin: 0,
                marginBottom: 20,
              }}
            >
              This promotion is only open to Singapore Citizens and Permanent Residents.
            </p>
            <button
              type="button"
              onClick={() => setEligibility(null)}
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                color: TOKENS.muted,
                fontSize: 14,
                fontFamily: 'Albert Sans, system-ui, sans-serif',
                textDecoration: 'underline',
                textUnderlineOffset: 3,
              }}
            >
              ← I picked the wrong option
            </button>
          </motion.div>
        ) : (
          <motion.div
            key="gate"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
          >
            <h2
              style={{
                fontFamily: headingFont,
                fontWeight: 800,
                fontSize: 'clamp(24px, 5.5vw, 30px)',
                lineHeight: 1.15,
                color: TOKENS.ink,
                margin: 0,
                marginBottom: 10,
              }}
            >
              Quick question first
            </h2>
            <p
              style={{
                fontFamily: 'Albert Sans, system-ui, sans-serif',
                fontSize: 16,
                lineHeight: 1.55,
                color: TOKENS.body,
                margin: 0,
                marginBottom: 24,
              }}
            >
              Are you a Singapore Citizen or Permanent Resident?
            </p>
            <div style={{ display: 'flex', gap: 12 }}>
              <button
                type="button"
                onClick={() => setEligibility('eligible')}
                style={{
                  flex: 1,
                  height: 56,
                  borderRadius: RADIUS.pill,
                  backgroundColor: accent,
                  color: onAccent,
                  border: 'none',
                  cursor: 'pointer',
                  fontFamily: 'Albert Sans, system-ui, sans-serif',
                  fontWeight: 600,
                  fontSize: 16,
                  boxShadow: `0 4px 14px ${TOKENS.accentShadow || 'rgba(209, 112, 41, 0.18)'}`,
                }}
              >
                Yes, I am
              </button>
              <button
                type="button"
                onClick={() => setEligibility('no')}
                style={{
                  flex: 1,
                  height: 56,
                  borderRadius: RADIUS.pill,
                  backgroundColor: TOKENS.inputBg || '#ffffff',
                  color: TOKENS.body,
                  border: `1px solid ${TOKENS.hairline}`,
                  cursor: 'pointer',
                  fontFamily: 'Albert Sans, system-ui, sans-serif',
                  fontWeight: 600,
                  fontSize: 16,
                }}
              >
                No
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    );
  }

  // Financial-consultant exclusion gate (campaign.design_config.excludeAdvisors):
  // a Yes/No screening card shown before the form, after the SG/PR gate so both
  // can stack. "No" reveals + animates the form in; "Yes" shows a polite,
  // reversible not-eligible message. No gate when excludeAdvisors is off.
  if (excludeAdvisors && advisorAck !== 'public') {
    return (
      <AnimatePresence mode="wait">
        {advisorAck === 'advisor' ? (
          <motion.div
            key="advisor-ineligible"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
          >
            <h2
              style={{
                fontFamily: headingFont,
                fontWeight: 800,
                fontSize: 'clamp(24px, 5.5vw, 30px)',
                lineHeight: 1.15,
                color: TOKENS.ink,
                margin: 0,
                marginBottom: 12,
              }}
            >
              Thanks for your interest
            </h2>
            <p
              style={{
                fontFamily: 'Albert Sans, system-ui, sans-serif',
                fontSize: 16,
                lineHeight: 1.55,
                color: TOKENS.body,
                margin: 0,
                marginBottom: 20,
              }}
            >
              This promotion is for members of the public. It is not available to
              financial advisors, consultants, or insurance agents.
            </p>
            <button
              type="button"
              onClick={() => setAdvisorAck(null)}
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                color: TOKENS.muted,
                fontSize: 14,
                fontFamily: 'Albert Sans, system-ui, sans-serif',
                textDecoration: 'underline',
                textUnderlineOffset: 3,
              }}
            >
              ← I picked the wrong option
            </button>
          </motion.div>
        ) : (
          <motion.div
            key="advisor-gate"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
          >
            <h2
              style={{
                fontFamily: headingFont,
                fontWeight: 800,
                fontSize: 'clamp(24px, 5.5vw, 30px)',
                lineHeight: 1.15,
                color: TOKENS.ink,
                margin: 0,
                marginBottom: 10,
              }}
            >
              Quick question first
            </h2>
            <p
              style={{
                fontFamily: 'Albert Sans, system-ui, sans-serif',
                fontSize: 16,
                lineHeight: 1.55,
                color: TOKENS.body,
                margin: 0,
                marginBottom: 24,
              }}
            >
              Are you a financial advisor, consultant, or insurance agent?
            </p>
            <div style={{ display: 'flex', gap: 12 }}>
              <button
                type="button"
                onClick={() => setAdvisorAck('public')}
                style={{
                  flex: 1,
                  height: 56,
                  borderRadius: RADIUS.pill,
                  backgroundColor: accent,
                  color: onAccent,
                  border: 'none',
                  cursor: 'pointer',
                  fontFamily: 'Albert Sans, system-ui, sans-serif',
                  fontWeight: 600,
                  fontSize: 16,
                  boxShadow: `0 4px 14px ${TOKENS.accentShadow || 'rgba(209, 112, 41, 0.18)'}`,
                }}
              >
                No, I am not
              </button>
              <button
                type="button"
                onClick={() => setAdvisorAck('advisor')}
                style={{
                  flex: 1,
                  height: 56,
                  borderRadius: RADIUS.pill,
                  backgroundColor: TOKENS.inputBg || '#ffffff',
                  color: TOKENS.body,
                  border: `1px solid ${TOKENS.hairline}`,
                  cursor: 'pointer',
                  fontFamily: 'Albert Sans, system-ui, sans-serif',
                  fontWeight: 600,
                  fontSize: 16,
                }}
              >
                Yes
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    );
  }

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
      >
      {/* Confirmed eligibility — shown above the form once they pass the SG/PR gate */}
      {sgPrOnly && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            marginBottom: 20,
            padding: '10px 14px',
            borderRadius: 12,
            backgroundColor: accent + '12',
            border: `1px solid ${accent}33`,
          }}
        >
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              fontFamily: 'Albert Sans, system-ui, sans-serif',
              fontSize: 13.5,
              fontWeight: 500,
              color: TOKENS.body,
            }}
          >
            <span
              aria-hidden="true"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 18,
                height: 18,
                borderRadius: '50%',
                backgroundColor: accent,
                color: onAccent,
                fontSize: 11,
                flexShrink: 0,
              }}
            >
              ✓
            </span>
            Confirmed: Singaporean or PR
          </span>
          <button
            type="button"
            onClick={() => setEligibility(null)}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              color: accent,
              fontWeight: 600,
              fontSize: 13.5,
              fontFamily: 'Albert Sans, system-ui, sans-serif',
              textDecoration: 'underline',
              textUnderlineOffset: 3,
              flexShrink: 0,
            }}
          >
            Edit
          </button>
        </div>
      )}
      <form onSubmit={handleSubmit}>
        {/* Heavy-serif heading */}
        <h2
          style={{
            fontFamily: headingFont,
            fontWeight: 800,
            fontSize: 'clamp(28px, 6.5vw, 34px)',
            lineHeight: 1.1,
            letterSpacing: '-0.015em',
            color: TOKENS.ink,
            margin: 0,
            // Tight gap down to the sub-headline / required-fields note, which
            // always follow the heading.
            marginBottom: 10,
          }}
        >
          {formHeadline || 'Get Started'}
        </h2>

        {/* Operator promo copy — optional. whiteSpace: pre-line honours newlines
            typed into the multi-line sub-headline textarea (single-line copy is
            unaffected). */}
        {formSubheadline && (
          <p
            style={{
              fontFamily: 'Albert Sans, system-ui, sans-serif',
              fontSize: 15,
              lineHeight: 1.55,
              color: TOKENS.body,
              margin: 0,
              marginBottom: 6,
              whiteSpace: 'pre-line',
            }}
          >
            {formSubheadline}
          </p>
        )}

        {/* Required-fields note — always rendered, independent of the sub-headline
            (clearing the promo copy must not hide it). The public form always has
            at least one compulsory field (phone is always required), so the note
            always has a referent. Muted + smaller so it reads as a form helper. */}
        <p
          style={{
            fontFamily: 'Albert Sans, system-ui, sans-serif',
            fontSize: 13,
            lineHeight: 1.5,
            color: TOKENS.muted,
            margin: 0,
            marginBottom: 28,
          }}
        >
          All fields marked with{' '}
          <span style={{ color: TOKENS.required, fontWeight: 600 }}>*</span> are required.
        </p>

        {/* Fields */}
        <div>
          {fieldOrder.map((item, index) => {
            if (typeof item === 'string') return renderField(item);
            if (item.columns && Array.isArray(item.columns)) {
              // Multi-column rows collapse to one column under 480px (real
              // phones ~390px) via .lc-field-row; minmax(0,1fr) prevents long
              // labels overflowing. Single-column rows render as a plain block.
              if (item.columns.length > 1) {
                return (
                  <div key={item.id || index} className="lc-field-row">
                    {item.columns.map((colId) => renderField(colId))}
                  </div>
                );
              }
              return <div key={item.id || index}>{item.columns.map((colId) => renderField(colId))}</div>;
            }
            return null;
          })}
        </div>

        {/* Inline error (form-level) */}
        {error && otpState !== 'pending' && (
          <div
            style={{
              marginTop: 4,
              marginBottom: 16,
              padding: '12px 16px',
              borderRadius: 14,
              backgroundColor: TOKENS.required + '15',
              color: TOKENS.required,
              fontSize: 13.5,
              fontFamily: 'Albert Sans, system-ui, sans-serif',
            }}
          >
            {error}
          </div>
        )}

        {/* Preview notice (neutral) — only shown in previewMode after a submit attempt */}
        {previewNotice && (
          <div
            style={{
              marginTop: 4,
              marginBottom: 16,
              padding: '12px 16px',
              borderRadius: 14,
              backgroundColor: TOKENS.storyCard,
              color: TOKENS.body,
              border: `1px solid ${TOKENS.hairline}`,
              fontSize: 13.5,
              fontFamily: 'Albert Sans, system-ui, sans-serif',
            }}
          >
            {previewNotice}
          </div>
        )}

        {/* Agree-all consent — layered presentation: ONE summary sentence
            inline (chrome, not hashed) + the full clause list and campaign
            T&Cs in ConsentAgreementDialog. The evidence strings are unchanged
            (CONSENT_COPY.clause*, rendered in the dialog); sponsored campaigns
            keep the named-sponsor line ON the page ("named on this page").
            The DNC gate above is a separate consent and stays independent. */}
        <div style={{ marginTop: 8, marginBottom: 24 }}>
          <p
            style={{
              margin: '0 0 10px',
              fontFamily: 'Albert Sans, system-ui, sans-serif',
              fontSize: 13.5,
              lineHeight: 1.55,
              color: TOKENS.body,
            }}
          >
            {sponsoredClause ? CONSENT_INLINE.summarySponsored : CONSENT_INLINE.summaryBase}
            <button
              type="button"
              onClick={() => setConsentOpen(true)}
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
              {CONSENT_INLINE.summaryLinkText}
            </button>
            {CONSENT_INLINE.summarySuffix}
          </p>
          {sponsoredClause && (
            <p
              style={{
                margin: '0 0 10px',
                fontFamily: 'Albert Sans, system-ui, sans-serif',
                fontSize: 12,
                lineHeight: 1.5,
                color: TOKENS.muted,
              }}
            >
              {sponsorNameLine(campaign?.design_config)}
            </p>
          )}
          <ConsentCheckbox
            checked={consentAll}
            onChange={setConsentAll}
            accent={accent}
            id="consent_all"
            required
          >
            {CONSENT_INLINE.checkboxLabel} <span style={{ color: TOKENS.required }}>*</span>
          </ConsentCheckbox>
        </div>

        {/* Submit button — pill, left-aligned narrower (Goodies SG pattern) */}
        <button
          type="submit"
          disabled={submitDisabled}
          style={{
            height: 56,
            paddingLeft: 36,
            paddingRight: 36,
            borderRadius: RADIUS.pill,
            backgroundColor: submitDisabled ? (TOKENS.disabledBg || TOKENS.hairline) : accent,
            color: submitDisabled ? (TOKENS.onDisabled || onAccent) : onAccent,
            border: 'none',
            cursor: submitDisabled ? 'not-allowed' : 'pointer',
            fontFamily: 'Albert Sans, system-ui, sans-serif',
            fontWeight: 600,
            fontSize: 16,
            letterSpacing: '0.005em',
            boxShadow: submitDisabled ? 'none' : `0 4px 14px ${TOKENS.accentShadow || 'rgba(209, 112, 41, 0.18)'}`,
            transition: 'background-color 200ms ease, opacity 200ms ease, transform 120ms ease',
            opacity: submitDisabled ? 0.6 : 1,
          }}
          onMouseEnter={(e) => {
            if (!submitDisabled) e.currentTarget.style.backgroundColor = TOKENS.accentDeep;
          }}
          onMouseLeave={(e) => {
            if (!submitDisabled) e.currentTarget.style.backgroundColor = accent;
          }}
        >
          {loading === 'submitting' ? 'Submitting…' : ctaLabel || 'Submit Now'}
        </button>
      </form>
      </motion.div>

      {/* The full agreement (clause list + campaign T&Cs). Its "I agree" is a
          real consent gesture — the dialog shows the ENTIRE deal, so agreeing
          there ticks the block's checkbox. */}
      <ConsentAgreementDialog
        open={consentOpen}
        onOpenChange={setConsentOpen}
        designConfig={campaign?.design_config}
        termsContent={termsContent}
        themeColor={accent}
        onAgree={() => {
          setConsentAll(true);
          setConsentOpen(false);
        }}
      />
    </>
  );
}

function ConsentCheckbox({ id, checked, onChange, children, accent, required }) {
  const { tokens: TOKENS, radius: RADIUS, onAccent } = useCampaignTheme();
  return (
    <label
      htmlFor={id}
      style={{
        display: 'flex',
        gap: 12,
        marginBottom: 16,
        cursor: 'pointer',
        alignItems: 'flex-start',
      }}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        required={required}
        style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 0, height: 0 }}
      />
      <span
        aria-hidden="true"
        style={{
          flexShrink: 0,
          width: 22,
          height: 22,
          marginTop: 1,
          borderRadius: RADIUS.checkbox,
          backgroundColor: checked ? accent : (TOKENS.inputBg || '#ffffff'),
          border: `1px solid ${checked ? accent : TOKENS.hairline}`,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'background-color 160ms ease, border-color 160ms ease',
        }}
      >
        {checked && (
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
            <path d="M3 6.8L5.5 9.2L10 4" stroke={onAccent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      <span
        style={{
          fontFamily: 'Albert Sans, system-ui, sans-serif',
          fontSize: 13.5,
          lineHeight: 1.55,
          color: TOKENS.body,
        }}
      >
        {children}
      </span>
    </label>
  );
}
