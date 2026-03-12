import { CheckCircle2, Loader2, X } from "lucide-react";

function PreviewField({ label, textColor, children }) {
  return (
    <div>
      <label className="block text-gray-700 text-sm font-medium mb-1.5" style={{ color: textColor }}>{label}</label>
      {children}
    </div>
  );
}

export default function PreviewFieldRenderer({
  fieldId,
  currentDesign,
  previewFormData,
  setPreviewFormData,
  previewPhoneVerification,
  setPreviewPhoneVerification,
  previewErrors,
  formatPhoneDisplay,
  handlePreviewPhoneChange,
  handlePreviewSendOTP,
  handleVerifyOtp,
  handlePreviewInputChange,
  handlePreviewDOBChange,
}) {
  const textColor = currentDesign.textColor;
  const themeColor = currentDesign.themeColor;

  if (fieldId === 'name') {
    return (
      <PreviewField label="Full Name" textColor={textColor}>
        <div className="relative">
          <input type="text" value={previewFormData.name}
            onChange={(e) => setPreviewFormData(prev => ({ ...prev, name: e.target.value }))}
            placeholder="John Tan"
            className={`w-full h-10 bg-gray-50 border border-gray-200 rounded-md px-3 text-gray-900 text-sm placeholder:text-gray-400 focus:outline-none focus:bg-white focus:ring-1 focus:ring-gray-300 transition-all ${previewFormData.name.trim().length >= 2 ? 'pr-10' : ''}`}
          />
          {previewFormData.name.trim().length >= 2 && <CheckCircle2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-green-500" />}
        </div>
      </PreviewField>
    );
  }

  if (fieldId === 'phone') {
    return (
      <PreviewField label="Phone Number" textColor={textColor}>
        <div className="grid grid-cols-12 gap-2">
          <div className="col-span-8 relative">
            <div className="flex h-10 bg-gray-50 rounded-md border border-gray-200 overflow-hidden focus-within:bg-white focus-within:ring-1 focus-within:ring-gray-300 transition-all">
              <div className="px-3 bg-gray-100 flex items-center border-r border-gray-200 gap-1">
                <span className="text-sm">🇸🇬</span>
                <span className="text-gray-600 text-sm font-medium">+65</span>
              </div>
              <input type="tel" value={formatPhoneDisplay(previewFormData.phone)}
                onChange={(e) => handlePreviewPhoneChange(e.target.value)}
                placeholder="9123 4567"
                className="bg-transparent border-0 focus:ring-0 focus:outline-none h-full px-3 text-sm flex-1 placeholder:text-gray-400"
                maxLength={9} disabled={previewPhoneVerification.isVerified}
              />
              {previewFormData.phone.length === 8 && previewPhoneVerification.isVerified && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2"><CheckCircle2 className="w-4 h-4 text-green-500" /></div>
              )}
            </div>
          </div>
          <div className="col-span-4">
            {!previewPhoneVerification.isVerified ? (
              <button type="button" onClick={handlePreviewSendOTP}
                disabled={previewPhoneVerification.isSending || previewFormData.phone.length !== 8 || previewPhoneVerification.error || (previewPhoneVerification.hasSentCode && !previewPhoneVerification.canResend)}
                className="w-full h-10 text-white text-sm font-medium disabled:opacity-50 rounded-md transition-colors flex items-center justify-center hover:opacity-90"
                style={{ backgroundColor: themeColor }}>
                {previewPhoneVerification.isSending ? <Loader2 className="w-4 h-4 animate-spin" />
                  : !previewPhoneVerification.hasSentCode ? 'Verify'
                  : !previewPhoneVerification.canResend ? `Resend (${previewPhoneVerification.resendCooldown}s)` : 'Resend'}
              </button>
            ) : (
              <div className="w-full h-10 bg-green-50 border border-green-200 rounded-md flex items-center justify-center">
                <CheckCircle2 className="w-4 h-4 text-green-600" />
              </div>
            )}
          </div>
        </div>
        {previewPhoneVerification.error && <p className="text-red-500 text-xs mt-1">{previewPhoneVerification.error}</p>}
        {/* OTP Section */}
        <div className={`transition-all duration-300 ease-out overflow-hidden ${previewPhoneVerification.showOtpInput ? 'max-h-48 opacity-100 mt-3' : 'max-h-0 opacity-0'}`}>
          <div className="p-3 bg-gray-50 rounded-md border border-gray-200">
            <div className="flex items-center justify-between mb-2">
              <div>
                <h4 className="font-medium text-gray-900 text-xs">Enter Code</h4>
                <p className="text-[10px] text-gray-500">Sent to +65 {formatPhoneDisplay(previewFormData.phone)}</p>
              </div>
              <button type="button" className="text-gray-400 hover:text-gray-600 p-1"
                onClick={() => setPreviewPhoneVerification(prev => ({ ...prev, showOtpInput: false }))}>
                <X className="w-3 h-3" />
              </button>
            </div>
            <div className="flex gap-2">
              <input type="text" maxLength={6} value={previewPhoneVerification.otpCode}
                onChange={(e) => setPreviewPhoneVerification(prev => ({ ...prev, otpCode: e.target.value.replace(/\D/g, '') }))}
                placeholder="123456"
                className="flex-1 h-9 bg-white border border-gray-200 rounded-md px-2 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-300 text-center tracking-widest text-sm"
              />
              <button type="button" onClick={handleVerifyOtp}
                disabled={previewPhoneVerification.otpCode.length !== 6 || previewPhoneVerification.isVerifying}
                className="h-9 px-4 text-white rounded-md text-xs font-medium disabled:opacity-50 transition-colors flex items-center justify-center hover:opacity-90"
                style={{ backgroundColor: themeColor }}>
                {previewPhoneVerification.isVerifying ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      </PreviewField>
    );
  }

  if (fieldId === 'email') {
    return (
      <PreviewField label="Email" textColor={textColor}>
        <div className="relative">
          <input type="email" value={previewFormData.email}
            onChange={(e) => handlePreviewInputChange('email', e.target.value)}
            placeholder="you@example.com"
            className={`w-full h-10 bg-gray-50 border ${previewErrors.email ? 'border-red-300' : 'border-gray-200'} rounded-md px-3 text-gray-900 text-sm placeholder:text-gray-400 focus:outline-none focus:bg-white focus:ring-1 focus:ring-gray-300 transition-all ${/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(previewFormData.email) ? 'pr-10' : ''}`}
          />
          {/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(previewFormData.email) && <CheckCircle2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-green-500" />}
        </div>
        {previewErrors.email && <p className="text-red-500 text-xs mt-1">{previewErrors.email}</p>}
      </PreviewField>
    );
  }

  if (fieldId === 'dob') {
    return (
      <PreviewField label="Date of Birth" textColor={textColor}>
        <div className="relative">
          <input type="text" value={previewFormData.date_of_birth}
            onChange={(e) => handlePreviewDOBChange(e.target.value)}
            placeholder="DD/MM/YYYY"
            className={`w-full h-10 bg-gray-50 border ${previewErrors.date_of_birth ? 'border-red-300' : 'border-gray-200'} rounded-md px-3 text-gray-900 text-sm placeholder:text-gray-400 focus:outline-none focus:bg-white focus:ring-1 focus:ring-gray-300 transition-all ${previewFormData.date_of_birth.length === 10 && !previewErrors.date_of_birth ? 'pr-10' : ''}`}
            maxLength={10}
          />
          {previewFormData.date_of_birth.length === 10 && !previewErrors.date_of_birth && <CheckCircle2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-green-500" />}
        </div>
        {previewErrors.date_of_birth && <p className="text-red-500 text-xs mt-1">{previewErrors.date_of_birth}</p>}
      </PreviewField>
    );
  }

  if (fieldId === 'postal_code') {
    return (
      <PreviewField label="Postal Code" textColor={textColor}>
        <div className="relative">
          <input type="text" maxLength={6} value={previewFormData.postal_code}
            onChange={(e) => handlePreviewInputChange('postal_code', e.target.value.replace(/\D/g, ''))}
            placeholder="520230"
            className={`w-full h-10 bg-gray-50 border ${previewErrors.postal_code ? 'border-red-300' : 'border-gray-200'} rounded-md px-3 text-gray-900 text-sm placeholder:text-gray-400 focus:outline-none focus:bg-white focus:ring-1 focus:ring-gray-300 transition-all ${previewFormData.postal_code.length === 6 ? 'pr-10' : ''}`}
          />
          {previewFormData.postal_code.length === 6 && <CheckCircle2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-green-500" />}
        </div>
        {previewErrors.postal_code && <p className="text-red-500 text-xs mt-1">{previewErrors.postal_code}</p>}
      </PreviewField>
    );
  }

  if (fieldId === 'education_level') {
    return (
      <PreviewField label="Education" textColor={textColor}>
        <div className="relative">
          <select value={previewFormData.education_level}
            onChange={(e) => setPreviewFormData(prev => ({ ...prev, education_level: e.target.value }))}
            className="w-full h-10 bg-gray-50 border border-gray-200 rounded-md px-3 text-gray-900 text-sm focus:outline-none focus:bg-white focus:ring-1 focus:ring-gray-300 transition-all appearance-none">
            <option value="" disabled>Select education</option>
            <option value="Secondary School or below">Secondary School or below</option>
            <option value="O Levels">O Levels</option>
            <option value="Diploma">Diploma</option>
            <option value="Degree">Degree</option>
            <option value="Masters and above">Masters and above</option>
          </select>
          <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-700">
            <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" /></svg>
          </div>
        </div>
      </PreviewField>
    );
  }

  if (fieldId === 'monthly_income') {
    return (
      <PreviewField label="Income" textColor={textColor}>
        <div className="relative">
          <select value={previewFormData.monthly_income}
            onChange={(e) => setPreviewFormData(prev => ({ ...prev, monthly_income: e.target.value }))}
            className="w-full h-10 bg-gray-50 border border-gray-200 rounded-md px-3 text-gray-900 text-sm focus:outline-none focus:bg-white focus:ring-1 focus:ring-gray-300 transition-all appearance-none">
            <option value="" disabled>Select income</option>
            <option value="<$3000">&lt;$3000</option>
            <option value="$3000 - $4999">$3000 - $4999</option>
            <option value="$5000 - $7999">$5000 - $7999</option>
            <option value=">$8000">&gt;$8000</option>
          </select>
          <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-700">
            <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" /></svg>
          </div>
        </div>
      </PreviewField>
    );
  }

  return null;
}
