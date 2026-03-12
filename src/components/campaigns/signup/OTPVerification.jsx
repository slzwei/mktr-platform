
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
    CheckCircle2,
    Loader2,
    AlertCircle,
    X,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import {
    InputOTP,
    InputOTPGroup,
    InputOTPSlot,
} from "@/components/ui/input-otp";
import { REGEXP_ONLY_DIGITS } from "input-otp";

export default function OTPVerification({
    otpState,
    otp,
    setOtp,
    loading,
    error,
    showSuccessTick,
    resendCooldown,
    displayPhone,
    phone,
    themeColor,
    textStyle,
    handleVerifyOtp,
    handleCancelOtp,
    handleSendOtp,
}) {
    return (
        <AnimatePresence>
            {otpState === 'pending' && (
                <motion.div
                    className="overflow-hidden"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.3, ease: "circOut" }}
                >
                    <div className={`mt-3 p-5 rounded-2xl border bg-gray-50/80 backdrop-blur-sm space-y-4 ${error ? 'border-red-200 ring-4 ring-red-50' : 'border-gray-200 shadow-inner'}`}>
                        <div className="flex items-center justify-between">
                            <div>
                                <Label htmlFor="otp" className="text-sm font-bold text-gray-900" style={textStyle}>Enter Verification Code</Label>
                                <p className="text-xs text-gray-500 mt-0.5" style={textStyle}>Sent to +65 {displayPhone(phone)}</p>
                            </div>
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={handleCancelOtp}
                                className="h-8 w-8 p-0 text-gray-400 hover:text-gray-600 hover:bg-gray-200/50 rounded-full"
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
                                        if (value.length === 6) {
                                            handleVerifyOtp(value);
                                        }
                                    }}
                                    pattern={REGEXP_ONLY_DIGITS}
                                    disabled={loading === 'verifying' || showSuccessTick}
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

                            {loading === 'verifying' && (
                                <div className="flex items-center justify-center gap-2 text-sm text-gray-500 mt-4 animate-pulse" style={textStyle}>
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    <span>Verifying secure code...</span>
                                </div>
                            )}
                        </div>

                        <div className="text-center pt-1">
                            <p className="text-xs text-gray-500" style={textStyle}>
                                Didn't receive it?{' '}
                                <button
                                    type="button"
                                    onClick={handleSendOtp}
                                    disabled={resendCooldown > 0 || loading === 'sending'}
                                    className="font-semibold text-gray-900 hover:text-black underline decoration-gray-300 hover:decoration-gray-900 disabled:text-gray-400 disabled:no-underline disabled:cursor-not-allowed transition-all"
                                >
                                    {resendCooldown > 0 ? (
                                        resendCooldown > 60 ?
                                            `Wait ${Math.ceil(resendCooldown / 60)}m` :
                                            `Resend in ${resendCooldown}s`
                                    ) : (
                                        loading === 'sending' ? 'Sending...' : 'Result Code'
                                    )}
                                </button>
                            </p>
                        </div>

                        <AnimatePresence>
                            {error && (
                                <motion.div
                                    className="flex items-start gap-3 p-3 text-sm text-red-600 bg-red-50 rounded-xl border border-red-100"
                                    initial={{ opacity: 0, scale: 0.95 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    exit={{ opacity: 0, scale: 0.95 }}
                                >
                                    <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                                    <span className="leading-snug font-medium" style={textStyle}>{error}</span>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
