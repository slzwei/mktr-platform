import { TOKENS, RADIUS } from '@/components/campaigns/LeadCaptureLayout';

/**
 * Per-field renderer for the public lead-capture form.
 *
 * Visual style: pill-shape inputs (border-radius 999px), no inline icons,
 * thin warm border, slight cream fill. Required asterisks use a distinct red
 * (TOKENS.required) so they read differently from the action color.
 *
 * The phone field's Verify button + verified badge live here, but the OTP
 * modal itself is rendered once at the form level — see CampaignSignupForm.
 */

const inputBaseStyle = {
  width: '100%',
  height: 52,
  paddingLeft: 22,
  paddingRight: 22,
  fontSize: 16, // 16px to prevent iOS auto-zoom on focus
  fontFamily: 'Albert Sans, system-ui, sans-serif',
  color: TOKENS.ink,
  backgroundColor: '#FFFCF6',
  border: `1px solid ${TOKENS.hairline}`,
  borderRadius: RADIUS.pill,
  outline: 'none',
  transition: 'border-color 200ms ease, box-shadow 200ms ease',
  WebkitAppearance: 'none',
};

const focusRingStyle = (themeColor) => ({
  borderColor: themeColor || TOKENS.accent,
  boxShadow: `0 0 0 3px ${(themeColor || TOKENS.accent) + '22'}`,
});

const errorRingStyle = {
  borderColor: TOKENS.required,
  boxShadow: `0 0 0 3px ${TOKENS.required}22`,
};

function Label({ htmlFor, required, optional, children }) {
  return (
    <label
      htmlFor={htmlFor}
      style={{
        display: 'block',
        fontFamily: 'Albert Sans, system-ui, sans-serif',
        fontSize: 14,
        fontWeight: 500,
        color: TOKENS.body,
        marginBottom: 8,
        marginLeft: 6,
      }}
    >
      {children}
      {required && (
        <span style={{ color: TOKENS.required, marginLeft: 4 }} aria-hidden="true">
          *
        </span>
      )}
      {optional && (
        <span style={{ color: TOKENS.muted, marginLeft: 6, fontSize: 12, fontWeight: 400 }}>(optional)</span>
      )}
    </label>
  );
}

function ErrorText({ children }) {
  return (
    <div
      style={{
        marginTop: 6,
        marginLeft: 6,
        fontSize: 13,
        color: TOKENS.required,
        fontFamily: 'Albert Sans, system-ui, sans-serif',
      }}
    >
      {children}
    </div>
  );
}

function HintText({ children }) {
  return (
    <div
      style={{
        marginTop: 6,
        marginLeft: 6,
        fontSize: 12,
        color: TOKENS.muted,
        fontFamily: 'Albert Sans, system-ui, sans-serif',
      }}
    >
      {children}
    </div>
  );
}

export default function FieldRenderer({
  fieldId,
  formData,
  themeColor,
  visibleFields,
  requiredFields,
  handleFormChange,
  // Phone props
  displayPhone,
  otpState,
  loading,
  handleSendOtp,
  phoneOtpPanel,
  // DOB props
  handleDobBlur,
  dobIncomplete,
  ageError,
  renderAgeRestrictionHint,
}) {
  // name / email / phone are always visible. Phone is the lead pipeline's
  // identity/dedup key (phone+OTP), so it can never be hidden via config.
  const isVisible =
    fieldId === 'name' || fieldId === 'email' || fieldId === 'phone' || visibleFields[fieldId] !== false;
  if (!isVisible) return null;

  const reqLevel = (key) => {
    const v = requiredFields[key];
    if (v === false) return { required: false, optional: true };
    if (v === 'optional') return { required: false, optional: true };
    if (v === true) return { required: true, optional: false };
    return { required: true, optional: false };
  };

  switch (fieldId) {
    case 'name':
      return (
        <div style={{ marginBottom: 20 }}>
          <Label htmlFor="name" required={reqLevel('name').required !== false}>
            Full Name
          </Label>
          <input
            id="name"
            type="text"
            placeholder="John Tan"
            value={formData.name}
            onChange={(e) => handleFormChange('name', e.target.value)}
            required
            style={inputBaseStyle}
            onFocus={(e) => Object.assign(e.target.style, focusRingStyle(themeColor))}
            onBlur={(e) => {
              e.target.style.borderColor = TOKENS.hairline;
              e.target.style.boxShadow = 'none';
            }}
          />
        </div>
      );

    case 'email':
      return (
        <div style={{ marginBottom: 20 }}>
          <Label htmlFor="email" {...reqLevel('email')}>
            Email Address
          </Label>
          <input
            id="email"
            type="email"
            placeholder="you@example.com"
            value={formData.email}
            onChange={(e) => handleFormChange('email', e.target.value)}
            required
            style={inputBaseStyle}
            onFocus={(e) => Object.assign(e.target.style, focusRingStyle(themeColor))}
            onBlur={(e) => {
              e.target.style.borderColor = TOKENS.hairline;
              e.target.style.boxShadow = 'none';
            }}
          />
        </div>
      );

    case 'phone':
      return (
        <div style={{ marginBottom: 20 }}>
          <Label htmlFor="phone" required>
            Phone Number
          </Label>
          <div style={{ display: 'flex', gap: 10, alignItems: 'stretch' }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <span
                style={{
                  position: 'absolute',
                  left: 22,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  fontSize: 16,
                  color: TOKENS.body,
                  pointerEvents: 'none',
                  fontFamily: 'Albert Sans, system-ui, sans-serif',
                }}
              >
                +65
              </span>
              <input
                id="phone"
                type="tel"
                inputMode="numeric"
                placeholder="9123 4567"
                value={displayPhone(formData.phone)}
                onChange={(e) => handleFormChange('phone', e.target.value)}
                disabled={otpState !== 'idle'}
                required
                maxLength={9}
                style={{ ...inputBaseStyle, paddingLeft: 64 }}
                onFocus={(e) => Object.assign(e.target.style, focusRingStyle(themeColor))}
                onBlur={(e) => {
                  e.target.style.borderColor = TOKENS.hairline;
                  e.target.style.boxShadow = 'none';
                }}
              />
            </div>
            {otpState === 'idle' && (
              <button
                type="button"
                onClick={handleSendOtp}
                disabled={loading === 'sending' || formData.phone.length !== 8}
                style={{
                  height: 52,
                  paddingLeft: 22,
                  paddingRight: 22,
                  borderRadius: RADIUS.pill,
                  border: 'none',
                  cursor: formData.phone.length === 8 ? 'pointer' : 'not-allowed',
                  fontFamily: 'Albert Sans, system-ui, sans-serif',
                  fontWeight: 600,
                  fontSize: 14,
                  color: '#ffffff',
                  backgroundColor: formData.phone.length === 8 ? themeColor || TOKENS.accent : TOKENS.hairline,
                  transition: 'background-color 200ms ease',
                  whiteSpace: 'nowrap',
                  minWidth: 100,
                }}
              >
                {loading === 'sending' ? '…' : 'Verify'}
              </button>
            )}
            {otpState === 'verified' && (
              <div
                style={{
                  height: 52,
                  paddingLeft: 18,
                  paddingRight: 22,
                  borderRadius: RADIUS.pill,
                  backgroundColor: TOKENS.success + '22',
                  color: TOKENS.success,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  fontFamily: 'Albert Sans, system-ui, sans-serif',
                  fontWeight: 600,
                  fontSize: 14,
                  minWidth: 100,
                  justifyContent: 'center',
                }}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                  <path
                    d="M3 7L6 10L11 4"
                    stroke={TOKENS.success}
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <span>Verified</span>
              </div>
            )}
          </div>
          {phoneOtpPanel}
        </div>
      );

    case 'dob':
      return (
        <div style={{ marginBottom: 20 }}>
          <Label htmlFor="dob" {...reqLevel('dob')}>
            Date of Birth
          </Label>
          <input
            id="dob"
            type="tel"
            inputMode="numeric"
            placeholder="DD / MM / YYYY"
            value={formData.date_of_birth}
            onChange={(e) => handleFormChange('date_of_birth', e.target.value)}
            onBlur={handleDobBlur}
            maxLength={10}
            style={{
              ...inputBaseStyle,
              ...(ageError || dobIncomplete ? errorRingStyle : {}),
            }}
            onFocus={(e) => {
              if (!ageError && !dobIncomplete) Object.assign(e.target.style, focusRingStyle(themeColor));
            }}
          />
          {(ageError || dobIncomplete) && <ErrorText>{ageError || 'Please enter a complete date (DD/MM/YYYY).'}</ErrorText>}
          {!ageError && !dobIncomplete && renderAgeRestrictionHint() && <HintText>{renderAgeRestrictionHint()}</HintText>}
        </div>
      );

    case 'postal_code':
      return (
        <div style={{ marginBottom: 20 }}>
          <Label htmlFor="postal_code" {...reqLevel('postal_code')}>
            Postal Code
          </Label>
          <input
            id="postal_code"
            type="tel"
            inputMode="numeric"
            placeholder="520230"
            maxLength={6}
            value={formData.postal_code}
            onChange={(e) => handleFormChange('postal_code', e.target.value.replace(/\D/g, '').slice(0, 6))}
            style={inputBaseStyle}
            onFocus={(e) => Object.assign(e.target.style, focusRingStyle(themeColor))}
            onBlur={(e) => {
              e.target.style.borderColor = TOKENS.hairline;
              e.target.style.boxShadow = 'none';
            }}
          />
        </div>
      );

    case 'education_level':
      return (
        <div style={{ marginBottom: 20 }}>
          <Label htmlFor="education_level" {...reqLevel('education_level')}>
            Highest Education
          </Label>
          <div style={{ position: 'relative' }}>
            <select
              id="education_level"
              value={formData.education_level}
              onChange={(e) => handleFormChange('education_level', e.target.value)}
              style={{
                ...inputBaseStyle,
                appearance: 'none',
                paddingRight: 44,
                color: formData.education_level ? TOKENS.ink : TOKENS.muted,
                cursor: 'pointer',
              }}
              onFocus={(e) => Object.assign(e.target.style, focusRingStyle(themeColor))}
              onBlur={(e) => {
                e.target.style.borderColor = TOKENS.hairline;
                e.target.style.boxShadow = 'none';
              }}
            >
              <option value="" disabled>
                Select education level
              </option>
              <option value="Secondary School or below">Secondary School or below</option>
              <option value="O Levels">O Levels</option>
              <option value="Diploma">Diploma</option>
              <option value="Degree">Degree</option>
              <option value="Masters and above">Masters and above</option>
            </select>
            <SelectChevron />
          </div>
        </div>
      );

    case 'monthly_income':
      return (
        <div style={{ marginBottom: 20 }}>
          <Label htmlFor="monthly_income" {...reqLevel('monthly_income')}>
            Last Drawn Salary
          </Label>
          <div style={{ position: 'relative' }}>
            <select
              id="monthly_income"
              value={formData.monthly_income}
              onChange={(e) => handleFormChange('monthly_income', e.target.value)}
              style={{
                ...inputBaseStyle,
                appearance: 'none',
                paddingRight: 44,
                color: formData.monthly_income ? TOKENS.ink : TOKENS.muted,
                cursor: 'pointer',
              }}
              onFocus={(e) => Object.assign(e.target.style, focusRingStyle(themeColor))}
              onBlur={(e) => {
                e.target.style.borderColor = TOKENS.hairline;
                e.target.style.boxShadow = 'none';
              }}
            >
              <option value="" disabled>
                Select salary range
              </option>
              <option value="<$3000">{'<'}$3,000</option>
              <option value="$3000 - $4999">$3,000 – $4,999</option>
              <option value="$5000 - $7999">$5,000 – $7,999</option>
              <option value=">$8000">{'>'}$8,000</option>
            </select>
            <SelectChevron />
          </div>
        </div>
      );

    default:
      return null;
  }
}

function SelectChevron() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden="true"
      style={{ position: 'absolute', right: 22, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}
    >
      <path d="M3 5L7 9L11 5" stroke={TOKENS.body} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
