import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import PhoneIcon from 'lucide-react/icons/phone';
import ShieldCheck from 'lucide-react/icons/shield-check';
import CheckCircle2 from 'lucide-react/icons/check-circle-2';
import AlertCircle from 'lucide-react/icons/alert-circle';
import X from 'lucide-react/icons/x';
import Loader2 from 'lucide-react/icons/loader-2';
import CarIcon from 'lucide-react/icons/car';
import UserIcon from 'lucide-react/icons/user';
import BuildingIcon from 'lucide-react/icons/building-2';
import { AnimatePresence, motion } from 'framer-motion';
import { isValidSgMobile } from '@/utils/validation';
import LoadingButton from '@/components/onboarding/LoadingButton';

export default function StepProfile({
  role,
  changeRole,
  firstName,
  setFirstName,
  lastName,
  setLastName,
  phone,
  setPhone,
  dob,
  handleDobChange,
  dobIncomplete,
  ageError,
  companyName,
  setCompanyName,
  otp,
  setOtp,
  otpState,
  loadingPhase,
  resendCooldown,
  showSuccessTick,
  handleSendOtp,
  handleVerifyOtp,
  handleCancelOtp,
  sanitizePhoneInput,
  errors,
  setErrors,
  setDobIncomplete,
  loading,
  saveBasic,
  user,
}) {
  return (
    <div className="w-full flex-shrink-0 p-6 space-y-4">
      <div>
        <label className="block text-sm text-gray-600 mb-1">I am signing up as</label>
        <div className="grid grid-cols-3 gap-2">
          <button onClick={() => changeRole('agent')} className={`rounded p-3 flex flex-col items-center ${role === 'agent' ? 'border-2 border-black bg-orange-300' : 'border border-gray-200 bg-orange-100'}`}>
            <UserIcon className="h-5 w-5" />
            <span className={`text-xs mt-1 ${role === 'agent' ? 'font-bold' : ''}`}>Salesperson</span>
          </button>
          <button onClick={() => changeRole('driver_partner')} className={`rounded p-3 flex flex-col items-center ${role === 'driver_partner' ? 'border-2 border-black bg-blue-300' : 'border border-gray-200 bg-blue-100'}`}>
            <CarIcon className="h-5 w-5" />
            <span className={`text-xs mt-1 ${role === 'driver_partner' ? 'font-bold' : ''}`}>Driver</span>
          </button>
          <button onClick={() => changeRole('fleet_owner')} className={`rounded p-3 flex flex-col items-center ${role === 'fleet_owner' ? 'border-2 border-black bg-green-300' : 'border border-gray-200 bg-green-100'}`}>
            <BuildingIcon className="h-5 w-5" />
            <span className={`text-xs mt-1 ${role === 'fleet_owner' ? 'font-bold' : ''}`}>Fleet Owner</span>
          </button>
        </div>
      </div>
      <AnimatePresence>
        {role && (
          <motion.div
            key="profile-fields"
            initial={{ height: 0, opacity: 0, y: -8 }}
            animate={{ height: 'auto', opacity: 1, y: 0 }}
            exit={{ height: 0, opacity: 0, y: -8 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            style={{ overflow: 'hidden' }}
          >
            {errors._server && (
              <div className="text-red-600 text-sm mb-2">{errors._server}</div>
            )}
            <div className="space-y-2">
              <label className="block text-sm text-gray-600">Full name</label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <input
                    className={`w-full border rounded p-2 ${errors.firstName ? 'border-red-500' : ''}`}
                    value={firstName}
                    onChange={e => { setFirstName(e.target.value); if (errors.firstName) setErrors(prev => ({ ...prev, firstName: undefined })); }}
                    placeholder="First name"
                    name="given-name"
                    autoComplete="given-name"
                    aria-invalid={!!errors.firstName}
                  />
                  {errors.firstName && <div className="text-red-600 text-xs mt-1">{errors.firstName}</div>}
                </div>
                <div>
                  <input
                    className={`w-full border rounded p-2 ${errors.lastName ? 'border-red-500' : ''}`}
                    value={lastName}
                    onChange={e => { setLastName(e.target.value); if (errors.lastName) setErrors(prev => ({ ...prev, lastName: undefined })); }}
                    placeholder="Last name"
                    name="family-name"
                    autoComplete="family-name"
                    aria-invalid={!!errors.lastName}
                  />
                  {errors.lastName && <div className="text-red-600 text-xs mt-1">{errors.lastName}</div>}
                </div>
              </div>
              <div className="mt-2">
                <label className="block text-sm text-gray-600 mb-1">Email (from Google)</label>
                <input
                  className="w-full border rounded p-2 bg-gray-100 text-gray-700 cursor-not-allowed"
                  value={user?.email || ''}
                  disabled
                  readOnly
                  tabIndex={-1}
                  aria-readonly="true"
                />
              </div>
              <Label className="block text-sm text-gray-600 mb-1">Handphone number</Label>
              <div className="flex items-center gap-1">
                <div className="flex-grow flex">
                  <div className="flex items-center px-3 bg-gray-50 border border-r-0 rounded-l-md h-9 text-sm font-medium text-gray-700 whitespace-nowrap">
                    {"\uD83C\uDDF8\uD83C\uDDEC"} +65
                  </div>
                  <div className="relative flex-grow">
                    <PhoneIcon className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <Input
                      type="tel"
                      inputMode="numeric"
                      placeholder=""
                      className={`pl-8 h-9 text-sm rounded-l-none border-l-0 ${errors.phone ? 'border-red-500' : ''}`}
                      value={phone.length <= 4 ? phone : `${phone.slice(0, 4)} ${phone.slice(4)}`}
                      onChange={(e) => {
                        const v = sanitizePhoneInput(e.target.value);
                        setPhone(v);
                        let msg;
                        if (v.length === 0) {
                          msg = undefined;
                        } else if (!/^[3689]/.test(v)) {
                          msg = 'Must start with 3, 6, 8, or 9';
                        } else if (v.length < 8) {
                          msg = 'Enter 8 digits';
                        } else if (!isValidSgMobile(v)) {
                          msg = 'Invalid Singapore mobile number';
                        }
                        setErrors(prev => ({ ...prev, phone: msg }));
                      }}
                      disabled={otpState !== 'idle'}
                      maxLength={9}
                      name="tel"
                      autoComplete="tel"
                      aria-invalid={!!errors.phone}
                    />
                  </div>
                </div>
                {otpState === 'idle' && (
                  <Button
                    type="button"
                    onClick={handleSendOtp}
                    disabled={loadingPhase === 'sending' || !isValidSgMobile(phone)}
                    className="w-28 h-9 bg-black hover:bg-gray-800 text-white text-sm"
                  >
                    {loadingPhase === 'sending' ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Verify'}
                  </Button>
                )}
                {otpState === 'verified' && (
                  <motion.div
                    key="verified-ok"
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 24 }}
                    className="flex items-center justify-center gap-2 text-white font-medium text-sm w-28 h-9 bg-green-500 rounded-md"
                  >
                    <CheckCircle2 className="w-5 h-5" />
                    <motion.span
                      initial={{ scale: 1 }}
                      animate={{ scale: [1, 1.08, 1], filter: ['brightness(1)', 'brightness(1.2)', 'brightness(1)'] }}
                      transition={{ duration: 0.9, times: [0, 0.5, 1] }}
                    >
                      OK
                    </motion.span>
                  </motion.div>
                )}
              </div>
              {errors.phone && <div className="text-red-600 text-xs mt-1">{errors.phone}</div>}
              <AnimatePresence initial={false}>
                {otpState === 'pending' && (
                  <motion.div
                    key="otp-panel"
                    initial={{ height: 0, opacity: 0, y: -8 }}
                    animate={{ height: 'auto', opacity: 1, y: 0 }}
                    exit={{ height: 0, opacity: 0, y: -8 }}
                    transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                    style={{ overflow: 'hidden' }}
                    className="space-y-2 p-3 bg-gray-50 rounded-lg border mt-2"
                  >
                    <div className="flex items-center justify-between">
                      <Label className="text-sm font-medium text-gray-800">Enter Code</Label>
                      <Button type="button" variant="ghost" size="sm" onClick={handleCancelOtp} className="text-gray-500 hover:text-gray-700 h-6 px-1">
                        <X className="w-3 h-3" />
                      </Button>
                    </div>
                    <p className="text-xs text-gray-500 !-mt-1">Sent to +65 {phone.length <= 4 ? phone : `${phone.slice(0, 4)} ${phone.slice(4)}`}</p>
                    <div className="flex items-center gap-2">
                      <div className="relative flex-grow">
                        <ShieldCheck className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                        <Input
                          type="tel"
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          placeholder="123456"
                          className="pl-8 tracking-wider h-9 text-sm"
                          maxLength={6}
                          value={otp}
                          onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        />
                      </div>
                      <Button type="button" size="sm" onClick={handleVerifyOtp} disabled={loadingPhase === 'verifying' || showSuccessTick} className={`h-9 px-4 text-sm w-28 ${showSuccessTick ? 'bg-green-500 hover:bg-green-600 text-white' : ''}`}>
                        {showSuccessTick ? <CheckCircle2 className="w-5 h-5" /> : (loadingPhase === 'verifying' ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Confirm')}
                      </Button>
                    </div>
                    <div className="text-center text-xs text-gray-500 pt-1">
                      Didn't receive a code?{' '}
                      <Button type="button" variant="link" size="sm" onClick={handleSendOtp} disabled={resendCooldown > 0} className="h-auto p-0 text-xs font-semibold text-blue-600 hover:text-blue-800 disabled:text-gray-500 disabled:no-underline">
                        {resendCooldown > 0 ? (resendCooldown > 60 ? `Wait ${Math.ceil(resendCooldown / 60)} min` : `Resend in ${resendCooldown}s`) : 'Resend now'}
                      </Button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
              {(role === 'agent' || role === 'driver_partner') && (
                <>
                  <label className="block text-sm text-gray-600">Date of birth</label>
                  <Input
                    type="tel"
                    inputMode="numeric"
                    placeholder="DD/MM/YYYY"
                    className={`w-full border rounded p-2 ${errors.dob || dobIncomplete ? 'border-red-500 focus:border-red-500 focus:ring-red-500' : ''}`}
                    value={dob}
                    onChange={e => handleDobChange(e.target.value)}
                    onBlur={() => {
                      const digits = dob.replace(/\D/g, '');
                      setDobIncomplete(digits.length > 0 && digits.length !== 8);
                    }}
                    maxLength={10}
                    name="bday"
                    autoComplete="bday"
                    aria-invalid={!!(errors.dob || dobIncomplete)}
                  />
                  {(errors.dob || dobIncomplete || ageError) && (
                    <div className="flex items-center gap-1 text-xs text-red-600 bg-red-50 p-1.5 rounded border mt-1">
                      <AlertCircle className="w-3 h-3" />
                      <span>{errors.dob || ageError || 'Please enter full year (DDMMYYYY)'}</span>
                    </div>
                  )}
                </>
              )}
              {(role === 'agent' || role === 'fleet_owner') && (
                <>
                  <label className="block text-sm text-gray-600">Company Name (optional)</label>
                  <input className="w-full border rounded p-2" value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder="Company" name="organization" autoComplete="organization" />
                </>
              )}
            </div>
            <div className="flex justify-end mt-2">
              <LoadingButton loading={loading} onClick={saveBasic}>Continue</LoadingButton>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
