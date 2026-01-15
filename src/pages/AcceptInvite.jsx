import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { auth, apiClient } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { motion, AnimatePresence } from "framer-motion";
import {
  Loader2,
  CheckCircle2,
  X,
  AlertCircle,
  Phone,
  ArrowRight,
  ShieldCheck,
  Calendar
} from "lucide-react";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { REGEXP_ONLY_DIGITS } from "input-otp";

export default function AcceptInvite() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token') || '';
  const emailFromLink = searchParams.get('email') || '';

  const [email, setEmail] = useState(emailFromLink);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(''); // Form submission errors
  const [tokenError, setTokenError] = useState(''); // Blocking load errors
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(!!token);

  // OTP State
  const [otp, setOtp] = useState('');
  const [otpState, setOtpState] = useState('idle'); // 'idle', 'pending', 'verified'
  const [otpLoading, setOtpLoading] = useState(null); // 'sending', 'verifying'
  const [otpError, setOtpError] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);
  const [showSuccessTick, setShowSuccessTick] = useState(false);

  // Handle countdown timer
  useEffect(() => {
    let timer;
    if (resendCooldown > 0) {
      timer = setTimeout(() => setResendCooldown(prev => prev - 1), 1000);
    }
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  // Verify token and get user info on mount
  useEffect(() => {
    if (token) {
      const fetchInviteInfo = async () => {
        try {
          const info = await auth.getInviteInfo(token);
          if (info) {
            if (info.email) setEmail(info.email);
            if (info.fullName) setFullName(info.fullName);
            // Default: strip +65 if present for the input field which expects 8 digits
            if (info.phone) {
              const rawPhone = info.phone.replace('+65', '').replace(/\D/g, '');
              // Only set if it looks like a valid SG number fragment, otherwise let user enter
              if (rawPhone.length <= 8) setPhone(rawPhone);
            }
          }
        } catch (err) {
          console.error("Failed to verify invite token:", err);
          setTokenError(err.message || "Invalid or expired invitation link.");
        } finally {
          setVerifying(false);
        }
      };
      fetchInviteInfo();
    } else {
      setVerifying(false); // No token provided
      setTokenError("Missing invitation token.");
    }
  }, [token]);

  useEffect(() => {
    if (emailFromLink && !email) setEmail(emailFromLink);
  }, [emailFromLink]);

  // Phone helpers
  const displayPhone = (value) => {
    if (!value) return '';
    if (value.length <= 4) return value;
    return `${value.slice(0, 4)} ${value.slice(4)}`;
  };

  const getFullPhoneNumber = () => `+65${phone}`;

  const handlePhoneChange = (e) => {
    let value = e.target.value.replace(/\D/g, '');
    // Handle pasted +65...
    if (value.startsWith('65') && value.length > 8) {
      value = value.substring(2);
    }
    setPhone(value.slice(0, 8));
  };

  // OTP Handlers
  const handleSendOtp = async () => {
    if (phone.length !== 8) {
      setOtpError("Please enter a valid 8-digit Singapore phone number.");
      return;
    }
    const firstDigit = phone[0];
    if (!['3', '6', '8', '9'].includes(firstDigit)) {
      setOtpError("Invalid number. Must start with 3, 6, 8, or 9.");
      return;
    }

    setOtpLoading('sending');
    setOtpError('');

    try {
      const response = await apiClient.post('/verify/send', {
        phone: phone,
        countryCode: '+65'
      }, { skipAuth: true });

      if (response.success) {
        setOtpState('pending');
        setResendCooldown(30);
      } else {
        setOtpError(response.message || "Failed to send verification code.");
      }
    } catch (err) {
      console.error('Send OTP error:', err);
      let errorMessage = "Unable to send verification code.";
      const respData = err.response?.data || err.data;
      if (err.response?.status === 429) {
        errorMessage = "Too many attempts. Please wait 10 minutes.";
        setResendCooldown(600);
      } else if (respData?.message) {
        errorMessage = respData.message;
        if (respData.retryAfter) setResendCooldown(respData.retryAfter);
      }
      setOtpError(errorMessage);
    }
    setOtpLoading(null);
  };

  const handleVerifyOtp = async (codeToVerify) => {
    const code = codeToVerify || otp;
    if (!code || code.length < 6) return;

    setOtpLoading('verifying');
    setOtpError('');

    try {
      const response = await apiClient.post('/verify/check', {
        phone: phone,
        code: code,
        countryCode: '+65'
      }, { skipAuth: true });

      const isVerified = response.success && (response.data?.verified === true || response.data?.status === 'approved');

      if (isVerified) {
        setOtpLoading(null);
        setShowSuccessTick(true);
        setOtpError('');
        setTimeout(() => {
          setOtpState('verified');
          setShowSuccessTick(false);
        }, 1200);
      } else {
        setOtpError("Incorrect code. Please try again.");
        setOtp('');
        setOtpLoading(null);
      }
    } catch (err) {
      console.error('Verification error:', err);
      setOtpError(err.message || "Verification failed.");
      setOtp('');
      setOtpLoading(null);
    }
  };

  const handleCancelOtp = () => {
    setOtpState('idle');
    setOtp('');
    setOtpError('');
    setResendCooldown(0);
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!token) return setError('Missing invitation token');
    if (!email) return setError('Email is required');
    if (!password || password.length < 6) return setError('Password must be at least 6 characters');
    if (password !== confirm) return setError('Passwords do not match');

    // Strict requirement: Must verify phone
    if (otpState !== 'verified') {
      return setError('Please verify your phone number to continue.');
    }

    setLoading(true);
    try {
      const resp = await auth.acceptInvite({
        token,
        email,
        password,
        full_name: fullName,
        phone: getFullPhoneNumber(), // Send verified phone
        dateOfBirth: dateOfBirth || undefined
      });
      if (resp.success) {
        const role = resp?.data?.user?.role;
        if (role === 'admin') navigate('/AdminDashboard');
        else if (role === 'agent') navigate('/AgentDashboard');
        else navigate('/');
      }
    } catch (err) {
      setError(err.message || 'Failed to accept invite');
    }
    setLoading(false);
  };

  if (verifying) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50/50 backdrop-blur-sm">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
          <p className="text-sm font-medium text-gray-500">Verifying invitation...</p>
        </div>
      </div>
    );
  }

  if (tokenError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-red-100 overflow-hidden"
        >
          <div className="p-8 text-center space-y-4">
            <div className="mx-auto w-16 h-16 bg-red-50 rounded-full flex items-center justify-center">
              <AlertCircle className="w-8 h-8 text-red-500" />
            </div>
            <h1 className="text-xl font-semibold text-gray-900">Invalid Invitation</h1>
            <p className="text-gray-500">{tokenError}</p>
          </div>
          <div className="p-6 bg-gray-50 border-t border-gray-100">
            <Button onClick={() => navigate('/')} variant="outline" className="w-full h-11">
              Return to Home
            </Button>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#F8FAFC] p-4 sm:p-6 lg:p-8 font-sans">
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="text-center mb-8">
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 mb-2">
              Accept Invitation
            </h1>
            <p className="text-slate-500 text-sm sm:text-base">
              Set up your secure password to activate your account.
            </p>
          </motion.div>
        </div>

        {/* Main Card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden"
        >
          <div className="p-6 sm:p-8">
            <form onSubmit={onSubmit} className="space-y-6">

              {/* Personal Info Section */}
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="fullName" className="text-xs uppercase font-semibold text-slate-500 tracking-wider">
                      Full Name
                    </Label>
                    <Input
                      id="fullName"
                      value={fullName}
                      className="bg-slate-50/50 text-slate-700 border-slate-200 h-11"
                      readOnly
                      disabled
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email" className="text-xs uppercase font-semibold text-slate-500 tracking-wider">
                      Email Address
                    </Label>
                    <Input
                      id="email"
                      type="email"
                      value={email}
                      className="bg-slate-50/50 text-slate-700 border-slate-200 h-11"
                      readOnly
                      disabled
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {/* Phone Input */}
                  <div className="space-y-2 order-1">
                    <Label htmlFor="phone" className="text-xs uppercase font-semibold text-slate-500 tracking-wider">
                      Phone Number <span className="text-red-500">*</span>
                    </Label>
                    <div className="relative group">
                      <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
                        <span className="text-sm font-medium text-slate-400">🇸🇬 +65</span>
                      </div>
                      <Input
                        id="phone"
                        type="tel"
                        value={displayPhone(phone)}
                        onChange={handlePhoneChange}
                        disabled={otpState !== 'idle'}
                        maxLength={9}
                        className={`pl-20 h-11 font-medium transition-all duration-200 ${otpState === 'verified'
                          ? 'bg-green-50/50 border-green-200 text-green-700'
                          : 'focus:ring-2 focus:ring-blue-100 focus:border-blue-400'
                          }`}
                      />
                      {/* Phone Action Button (Inline) */}
                      <div className="absolute inset-y-0 right-1 flex items-center">
                        {otpState === 'idle' && (
                          <Button
                            type="button"
                            onClick={handleSendOtp}
                            disabled={otpLoading === 'sending' || phone.length !== 8}
                            size="sm"
                            className="h-8 px-3 text-xs font-semibold bg-slate-900 text-white hover:bg-slate-800 rounded-lg transition-all shadow-sm"
                          >
                            {otpLoading === 'sending' ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              'Verify'
                            )}
                          </Button>
                        )}
                        {otpState === 'verified' && (
                          <div className="flex items-center gap-1.5 px-3 py-1 bg-green-100 text-green-700 rounded-md mr-1">
                            <CheckCircle2 className="w-4 h-4" />
                            <span className="text-xs font-bold">Verified</span>
                          </div>
                        )}
                      </div>
                    </div>
                    {/* Error Below Phone */}
                    <AnimatePresence>
                      {otpError && otpState !== 'pending' && (
                        <motion.p
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          className="text-xs text-red-500 font-medium flex items-center gap-1 mt-1"
                        >
                          <AlertCircle className="w-3 h-3" /> {otpError}
                        </motion.p>
                      )}
                    </AnimatePresence>
                  </div>

                  {/* DOB Input */}
                  <div className="space-y-2 order-3 sm:order-2">
                    <Label htmlFor="dateOfBirth" className="text-xs uppercase font-semibold text-slate-500 tracking-wider">
                      Birth Date <span className="text-slate-400 font-normal normal-case">(Optional)</span>
                    </Label>
                    <div className="relative">
                      <Input
                        id="dateOfBirth"
                        type="date"
                        value={dateOfBirth}
                        onChange={(e) => setDateOfBirth(e.target.value)}
                        className="h-11 w-full min-w-0" // min-w-0 key for preventing overflow
                        style={{
                          WebkitAppearance: 'none'
                        }}
                      />
                      <Calendar className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                    </div>
                  </div>

                  {/* OTP Expanded Section */}
                  <AnimatePresence>
                    {otpState === 'pending' && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden col-span-1 sm:col-span-2 order-2 sm:order-3"
                      >
                        <div className="bg-slate-50 rounded-xl p-6 border border-slate-200 mt-2 relative">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={handleCancelOtp}
                            className="absolute right-2 top-2 h-8 w-8 text-slate-400 hover:text-slate-600"
                          >
                            <X className="w-4 h-4" />
                          </Button>

                          <div className="text-center mb-6">
                            <h3 className="text-sm font-semibold text-slate-900">Enter Verification Code</h3>
                            <p className="text-xs text-slate-500 mt-1">We sent a 6-digit code to +65 {displayPhone(phone)}</p>
                          </div>

                          <div className="flex justify-center mb-6 relative">
                            <InputOTP
                              maxLength={6}
                              value={otp}
                              onChange={(value) => {
                                setOtp(value);
                                if (value.length === 6) handleVerifyOtp(value);
                              }}
                              pattern={REGEXP_ONLY_DIGITS}
                              disabled={otpLoading === 'verifying' || showSuccessTick}
                            >
                              <InputOTPGroup className="gap-2 sm:gap-3">
                                {[0, 1, 2].map(idx => (
                                  <InputOTPSlot
                                    key={idx}
                                    index={idx}
                                    className="h-12 w-10 sm:h-14 sm:w-12 text-lg bg-white border border-slate-200 shadow-sm rounded-lg focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100 transition-all"
                                  />
                                ))}
                              </InputOTPGroup>
                              <div className="w-2 sm:w-4" />
                              <InputOTPGroup className="gap-2 sm:gap-3">
                                {[3, 4, 5].map(idx => (
                                  <InputOTPSlot
                                    key={idx}
                                    index={idx}
                                    className="h-12 w-10 sm:h-14 sm:w-12 text-lg bg-white border border-slate-200 shadow-sm rounded-lg focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100 transition-all"
                                  />
                                ))}
                              </InputOTPGroup>
                            </InputOTP>

                            <AnimatePresence>
                              {showSuccessTick && (
                                <motion.div
                                  className="absolute inset-0 flex items-center justify-center bg-white/50 backdrop-blur-[1px] rounded-lg z-10"
                                  initial={{ opacity: 0 }}
                                  animate={{ opacity: 1 }}
                                  exit={{ opacity: 0 }}
                                >
                                  <div className="bg-green-500 rounded-full p-2 shadow-lg scale-110">
                                    <CheckCircle2 className="w-8 h-8 text-white" />
                                  </div>
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>

                          {otpLoading === 'verifying' && (
                            <div className="flex items-center justify-center gap-2 text-xs text-blue-600 font-medium animate-pulse mb-4">
                              <Loader2 className="w-3 h-3 animate-spin" />
                              Verifying code...
                            </div>
                          )}

                          <div className="text-center">
                            <p className="text-xs text-slate-500">
                              Didn't receive code?{' '}
                              <button
                                type="button"
                                onClick={handleSendOtp}
                                disabled={resendCooldown > 0 || otpLoading === 'sending'}
                                className="text-blue-600 font-semibold hover:text-blue-700 disabled:text-slate-400 disabled:cursor-not-allowed transition-colors"
                              >
                                {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : (otpLoading === 'sending' ? 'Sending...' : 'Resend Code')}
                              </button>
                            </p>
                          </div>

                          <AnimatePresence>
                            {otpError && (
                              <motion.div
                                initial={{ opacity: 0, y: 5 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0 }}
                                className="mt-4 p-3 bg-red-50 border border-red-100 rounded-lg flex items-start gap-2 text-xs text-red-600"
                              >
                                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                                <span>{otpError}</span>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>

              <div className="border-t border-slate-100 my-6"></div>

              {/* Password Section */}
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="password" className="text-xs uppercase font-semibold text-slate-500 tracking-wider">
                    Create Password <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={6}
                    className="h-11 focus:ring-2 focus:ring-blue-100 transition-all font-medium"
                    placeholder="Min. 6 characters"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm" className="text-xs uppercase font-semibold text-slate-500 tracking-wider">
                    Confirm Password <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="confirm"
                    type="password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    required
                    className="h-11 focus:ring-2 focus:ring-blue-100 transition-all font-medium"
                    placeholder="Re-enter password"
                  />
                </div>
              </div>

              {/* Form Actions */}
              <div className="pt-4">
                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: -5 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mb-4 p-3 rounded-lg bg-red-50 border border-red-100 text-sm text-red-600 flex items-center gap-2"
                  >
                    <AlertCircle className="w-4 h-4" />
                    {error}
                  </motion.div>
                )}

                <Button
                  type="submit"
                  className="w-full h-12 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-base shadow-lg shadow-blue-200 transition-all duration-200 hover:-translate-y-0.5"
                  disabled={loading || otpState !== 'verified'}
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                      Setting up account...
                    </>
                  ) : (
                    <span className="flex items-center justify-center gap-2">
                      Complete Setup <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                    </span>
                  )}
                </Button>

                <p className="text-center text-xs text-slate-400 mt-4 flex items-center justify-center gap-1">
                  <ShieldCheck className="w-3 h-3" /> Secure Registration
                </p>
              </div>

            </form>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
