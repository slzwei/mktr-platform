import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { auth, apiClient } from '@/api/client';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { motion, AnimatePresence } from "framer-motion";
import {
  Loader2,
  CheckCircle2,
  X,
  AlertCircle,
  Phone
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
  const [error, setError] = useState('');
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
          setError(err.message || "Invalid or expired invitation link.");
        } finally {
          setVerifying(false);
        }
      };
      fetchInviteInfo();
    } else {
      setVerifying(false);
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
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-pulse flex flex-col items-center">
          <div className="h-4 w-48 bg-gray-200 rounded mb-4"></div>
          <div className="h-2 w-32 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  if (error && !email && !fullName) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <Card className="w-full max-w-md border-red-100 shadow-sm">
          <CardHeader className="p-6 text-center">
            <div className="mx-auto w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mb-4">
              <span className="text-xl">⚠️</span>
            </div>
            <h1 className="text-xl font-semibold text-gray-900">Invalid Invitation</h1>
          </CardHeader>
          <CardContent className="p-6 pt-0 text-center">
            <p className="text-gray-600 mb-6">{error}</p>
            <Button onClick={() => navigate('/')} variant="outline" className="w-full">
              Return to Home
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="p-6">
          <h1 className="text-xl font-semibold">Accept Invitation</h1>
          <p className="text-sm text-gray-600">Create your password to activate your account.</p>
        </CardHeader>
        <CardContent className="p-6 pt-0">
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                className="bg-gray-100 text-gray-500 cursor-not-allowed"
                readOnly
                disabled
              />
            </div>
            <div>
              <Label htmlFor="fullName">Full Name</Label>
              <Input
                id="fullName"
                value={fullName}
                // Allow editing name if needed, or keep locked if strictly from invite
                // Current logic seems to prefer locked if present
                className="bg-gray-100 text-gray-500 cursor-not-allowed"
                readOnly
                disabled
              />
            </div>

            {/* Custom Phone Input with OTP */}
            <div className="space-y-1.5">
              <Label htmlFor="phone">Phone Number</Label>
              <div className="flex items-center gap-2">
                <div className="flex-grow flex shadow-sm rounded-md overflow-hidden border border-input focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
                  <div className="flex items-center px-3 bg-muted border-r text-sm text-muted-foreground whitespace-nowrap">
                    🇸🇬 +65
                  </div>
                  <div className="relative flex-grow">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <Input
                      id="phone"
                      type="tel"
                      placeholder="9123 4567"
                      className="pl-10 h-10 border-0 focus-visible:ring-0 rounded-none shadow-none"
                      value={displayPhone(phone)}
                      onChange={handlePhoneChange}
                      disabled={otpState !== 'idle'}
                      required
                      maxLength={9}
                    />
                  </div>
                </div>

                {otpState === 'idle' && (
                  <Button
                    type="button"
                    onClick={handleSendOtp}
                    disabled={otpLoading === 'sending' || phone.length !== 8}
                    className="min-w-[80px]"
                    variant={phone.length === 8 ? "default" : "secondary"}
                  >
                    {otpLoading === 'sending' ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      'Verify'
                    )}
                  </Button>
                )}

                {otpState === 'verified' && (
                  <motion.div
                    className="flex items-center justify-center gap-2 text-white font-medium text-sm px-4 h-10 bg-green-500 rounded-md shadow-sm min-w-[80px]"
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                  >
                    <CheckCircle2 className="w-5 h-5" />
                    <span className="hidden sm:inline">Verified</span>
                  </motion.div>
                )}
              </div>

              {/* OTP Expanded Section */}
              <AnimatePresence>
                {otpState === 'pending' && (
                  <motion.div
                    className="overflow-hidden"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.3, ease: "circOut" }}
                  >
                    <div className={`mt-3 p-4 rounded-xl border bg-gray-50/80 backdrop-blur-sm space-y-4 ${otpError ? 'border-red-200 ring-4 ring-red-50' : 'border-gray-200 shadow-inner'}`}>
                      <div className="flex items-center justify-between">
                        <div>
                          <Label className="text-sm font-bold text-gray-900">Enter Verification Code</Label>
                          <p className="text-xs text-gray-500 mt-0.5">Sent to +65 {displayPhone(phone)}</p>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={handleCancelOtp}
                          className="h-8 w-8 p-0 text-gray-400 hover:text-gray-600 rounded-full"
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </div>

                      <div className="flex flex-col items-center justify-center py-2">
                        <div className="relative">
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
                            <InputOTPGroup className="gap-2">
                              <InputOTPSlot index={0} className="h-12 w-10 sm:h-14 sm:w-12 text-lg bg-white border-gray-200 rounded-lg shadow-sm focus:border-gray-400 focus:ring-1 focus:ring-gray-400 transition-all" />
                              <InputOTPSlot index={1} className="h-12 w-10 sm:h-14 sm:w-12 text-lg bg-white border-gray-200 rounded-lg shadow-sm focus:border-gray-400 focus:ring-1 focus:ring-gray-400 transition-all" />
                              <InputOTPSlot index={2} className="h-12 w-10 sm:h-14 sm:w-12 text-lg bg-white border-gray-200 rounded-lg shadow-sm focus:border-gray-400 focus:ring-1 focus:ring-gray-400 transition-all" />
                            </InputOTPGroup>
                            <div className="w-2" />
                            <InputOTPGroup className="gap-2">
                              <InputOTPSlot index={3} className="h-12 w-10 sm:h-14 sm:w-12 text-lg bg-white border-gray-200 rounded-lg shadow-sm focus:border-gray-400 focus:ring-1 focus:ring-gray-400 transition-all" />
                              <InputOTPSlot index={4} className="h-12 w-10 sm:h-14 sm:w-12 text-lg bg-white border-gray-200 rounded-lg shadow-sm focus:border-gray-400 focus:ring-1 focus:ring-gray-400 transition-all" />
                              <InputOTPSlot index={5} className="h-12 w-10 sm:h-14 sm:w-12 text-lg bg-white border-gray-200 rounded-lg shadow-sm focus:border-gray-400 focus:ring-1 focus:ring-gray-400 transition-all" />
                            </InputOTPGroup>
                          </InputOTP>

                          <AnimatePresence>
                            {showSuccessTick && (
                              <motion.div
                                className="absolute inset-0 flex items-center justify-center bg-white/90 backdrop-blur-[1px] rounded-xl z-10"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                              >
                                <div className="bg-green-100 rounded-full p-3 shadow-lg scale-110">
                                  <CheckCircle2 className="w-8 h-8 text-green-600" />
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>

                        {otpLoading === 'verifying' && (
                          <div className="flex items-center justify-center gap-2 text-sm text-gray-500 mt-4 animate-pulse">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            <span>Verifying...</span>
                          </div>
                        )}
                      </div>

                      <div className="text-center pt-1">
                        <p className="text-xs text-gray-500">
                          Didn't receive it?{' '}
                          <button
                            type="button"
                            onClick={handleSendOtp}
                            disabled={resendCooldown > 0 || otpLoading === 'sending'}
                            className="font-semibold text-gray-900 hover:underline disabled:text-gray-400 disabled:no-underline"
                          >
                            {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : (otpLoading === 'sending' ? 'Sending...' : 'Resend Code')}
                          </button>
                        </p>
                      </div>

                      <AnimatePresence>
                        {otpError && (
                          <motion.div
                            className="flex items-start gap-3 p-3 text-sm text-red-600 bg-red-50 rounded-xl border border-red-100"
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                          >
                            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                            <span className="leading-snug font-medium">{otpError}</span>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <AnimatePresence>
                {otpError && otpState !== 'pending' && (
                  <motion.div
                    className="flex items-center gap-2 text-xs text-red-600 bg-red-50 p-2 rounded-md border border-red-100 mt-2"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                  >
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    <span>{otpError}</span>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div>
              <Label htmlFor="dateOfBirth">Date of Birth <span className="text-gray-400 font-normal ml-1">(Optional)</span></Label>
              <Input
                id="dateOfBirth"
                type="date"
                value={dateOfBirth}
                onChange={(e) => setDateOfBirth(e.target.value)}
              />
            </div>

            <div className="pt-2 border-t border-gray-100 mt-4">
              <Label htmlFor="password">Create Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="confirm">Confirm Password</Label>
              <Input
                id="confirm"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                className="mt-1"
              />
            </div>

            {error && <div className="text-red-600 text-sm bg-red-50 p-2 rounded">{error}</div>}

            <Button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 mt-2" disabled={loading}>
              {loading ? 'Submitting…' : 'Accept Invitation'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
