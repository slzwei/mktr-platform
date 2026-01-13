
import { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
    Calendar as CalendarIcon,
    Phone,
    User,
    Mail,
    MapPin,
    CheckCircle2,
    ShieldCheck,
    Loader2,
    AlertCircle,
    X,
    ChevronRight
} from "lucide-react";
import { apiClient } from "@/api/client";
import { motion, AnimatePresence } from "framer-motion";
import MarketingConsentDialog from "@/components/legal/MarketingConsentDialog";
import {
    InputOTP,
    InputOTPGroup,
    InputOTPSlot,
    InputOTPSeparator,
} from "@/components/ui/input-otp";
import { REGEXP_ONLY_DIGITS } from "input-otp";

export default function CampaignSignupForm({ themeColor, formHeadline, formSubheadline, headlineSize, campaignId, onSubmit, campaign }) {
    const visibleFields = campaign?.design_config?.visibleFields || {};
    const requiredFields = campaign?.design_config?.requiredFields || {};
    const fieldOrder = campaign?.design_config?.fieldOrder || ['name', 'phone', 'email', 'dob', 'postal_code', 'education_level', 'monthly_income'];

    const [formData, setFormData] = useState({
        name: '',
        email: '',
        phone: '', // Now just the 8-digit number
        postal_code: '',
        date_of_birth: '', // Now stored as string in DD/MM/YYYY format
        education_level: '',
        monthly_income: ''
    });
    const [otp, setOtp] = useState('');
    const [otpState, setOtpState] = useState('idle'); // 'idle', 'pending', 'verified'
    const [loading, setLoading] = useState(null); // 'sending', 'verifying', 'submitting'
    const [error, setError] = useState('');
    const [ageError, setAgeError] = useState(''); // New: Age validation error
    const [dobIncomplete, setDobIncomplete] = useState(false); // New: Track incomplete DOB format
    const [resendCooldown, setResendCooldown] = useState(0);
    const [showSuccessTick, setShowSuccessTick] = useState(false);
    const [consentOpen, setConsentOpen] = useState(false);

    useEffect(() => {
        let timer;
        if (resendCooldown > 0) {
            timer = setTimeout(() => setResendCooldown(prev => prev - 1), 1000);
        }
        return () => clearTimeout(timer);
    }, [resendCooldown]);

    // New: Format date input as DD/MM/YYYY
    const formatDateInput = (value) => {
        // Remove all non-digits
        let digits = value.replace(/\D/g, '');

        // Limit to 8 digits (DDMMYYYY)
        digits = digits.slice(0, 8);

        // Add slashes at appropriate positions
        if (digits.length >= 3) {
            digits = digits.slice(0, 2) + '/' + digits.slice(2);
        }
        if (digits.length >= 6) {
            digits = digits.slice(0, 5) + '/' + digits.slice(5);
        }

        return digits;
    };

    // New: Calculate age from DD/MM/YYYY format
    const calculateAge = (dateString) => {
        if (!dateString || dateString.length !== 10) return null;

        const [day, month, year] = dateString.split('/').map(Number);
        // Basic validation for numbers and reasonable year range
        if (isNaN(day) || isNaN(month) || isNaN(year) || day < 1 || day > 31 || month < 1 || month > 12 || year < 1900 || year > new Date().getFullYear()) {
            return null;
        }

        const birthDate = new Date(year, month - 1, day);
        // Check for invalid date (e.g., Feb 30)
        if (birthDate.getDate() !== day || birthDate.getMonth() !== month - 1 || birthDate.getFullYear() !== year) {
            return null;
        }

        const today = new Date();
        let age = today.getFullYear() - birthDate.getFullYear();
        const monthDiff = today.getMonth() - birthDate.getMonth();

        if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
            age--;
        }

        return age;
    };

    // Enhanced: Validate age against campaign range with immediate feedback
    const validateAge = (dateString) => {
        if (!campaign) { // If campaign object is not provided, no age validation is performed
            setAgeError('');
            return;
        }

        const digitsOnly = dateString.replace(/\D/g, '');

        // Check for incomplete date format (but allow empty)
        if (digitsOnly.length > 0 && digitsOnly.length !== 8) {
            setAgeError('Please enter full year in DDMMYYYY format');
            return;
        }

        // If no digits entered, clear error
        if (digitsOnly.length === 0) {
            setAgeError('');
            return;
        }

        // Check for invalid date format (exactly 8 digits but invalid date)
        if (digitsOnly.length === 8) {
            const day = parseInt(digitsOnly.slice(0, 2), 10);
            const month = parseInt(digitsOnly.slice(2, 4), 10);
            const year = parseInt(digitsOnly.slice(4, 8), 10);

            // Basic range validation
            if (day < 1 || day > 31 || month < 1 || month > 12 || year < 1900 || year > new Date().getFullYear()) {
                setAgeError('Please enter a valid date');
                return;
            }

            // Check for invalid dates (e.g., Feb 30, Apr 31)
            const testDate = new Date(year, month - 1, day);
            if (testDate.getDate() !== day || testDate.getMonth() !== month - 1 || testDate.getFullYear() !== year) {
                setAgeError('Please enter a valid date');
                return;
            }
        }

        const age = calculateAge(dateString);
        if (age === null) { // If date string is invalid or incomplete, no age error (yet)
            setAgeError('');
            return;
        }

        const hasMinAge = campaign.min_age !== undefined && campaign.min_age !== null;
        const hasMaxAge = campaign.max_age !== undefined && campaign.max_age !== null;
        const minAge = hasMinAge ? campaign.min_age : 0;
        const maxAge = hasMaxAge ? campaign.max_age : 150; // Default max age if not specified

        if (hasMinAge && age < minAge) {
            setAgeError(`Must be at least ${minAge} years old`);
            return;
        }
        if (hasMaxAge && age > maxAge) {
            setAgeError(`Only available for ages ${hasMinAge ? `${minAge}-` : ''}${maxAge}`);
            return;
        }

        setAgeError('');
    };

    const renderAgeRestrictionHint = () => {
        if (!campaign) return null;
        const hasMinAge = campaign.min_age !== undefined && campaign.min_age !== null;
        const hasMaxAge = campaign.max_age !== undefined && campaign.max_age !== null;
        if (!hasMinAge && !hasMaxAge) return null;
        const hint = hasMinAge && hasMaxAge
            ? `Only available for ages ${campaign.min_age}-${campaign.max_age}`
            : hasMinAge
                ? `Only available for ages ${campaign.min_age}+`
                : `Only available for ages up to ${campaign.max_age}`;
        return hint;
    };

    // New: Handle DOB field blur to check for incomplete format
    const handleDobBlur = () => {
        const digitsOnly = formData.date_of_birth.replace(/\D/g, '');
        // Set dobIncomplete to true if it's not exactly 8 digits (but has some content)
        if (digitsOnly.length > 0 && digitsOnly.length !== 8) {
            setDobIncomplete(true);
        } else {
            setDobIncomplete(false);
        }
    };

    const handleFormChange = (key, value) => {
        if (key === 'phone') {
            // Remove all non-digits first
            let digits = value.replace(/\D/g, '');

            // Handle Singapore country code removal - be more aggressive about detecting +65
            if (digits.startsWith('65') && digits.length > 8) {
                // This is likely +65XXXXXXXX format, remove the country code
                digits = digits.substring(2);
            }

            // Take only the first 8 digits for Singapore mobile number
            const finalNumber = digits.slice(0, 8);

            setFormData(prev => ({ ...prev, phone: finalNumber }));
        } else if (key === 'date_of_birth') {
            const formattedDate = formatDateInput(value);
            setFormData(prev => ({ ...prev, [key]: formattedDate }));

            // Clear incomplete state when user continues typing beyond 6 digits
            const digitsOnly = formattedDate.replace(/\D/g, '');
            if (digitsOnly.length !== 6 && dobIncomplete) {
                setDobIncomplete(false);
            }

            // Validate immediately as user types
            validateAge(formattedDate);
        } else {
            setFormData(prev => ({ ...prev, [key]: value }));
        }
    };

    // Format phone number for display: XXXX XXXX
    // This function is purely for user-facing display.
    const displayPhone = (value) => {
        if (value.length <= 4) {
            return value;
        }
        return `${value.slice(0, 4)} ${value.slice(4)}`;
    };

    // Get full phone number for backend (+65XXXXXXXX)
    const getFullPhoneNumber = () => {
        return `+65${formData.phone}`;
    };

    const handleSendOtp = async () => {
        // Validate that formData.phone contains exactly 8 digits
        if (formData.phone.length !== 8) {
            setError("Please enter a valid 8-digit Singapore phone number.");
            return;
        }

        // Validate the first digit of the 8-digit number (e.g., 9 for mobile)
        const firstDigit = formData.phone[0];
        if (!['3', '6', '8', '9'].includes(firstDigit)) {
            setError("Invalid number. Must start with 3, 6, 8, or 9.");
            return;
        }

        setLoading('sending');
        setError('');

        const phoneNumber = getFullPhoneNumber();

        try {
            // Call sendOtp with just the phone number string and campaignId
            const response = await apiClient.post('/verify/send', {
                phone: formData.phone,
                countryCode: '+65',
                campaignId: campaignId
            }, { skipAuth: true });

            const result = response;

            if (result.success) {
                setOtpState('pending');
                setResendCooldown(30); // Start cooldown timer
            } else {
                // Handle non-successful responses where status is not an error that throws
                setError(result.message || "Failed to send verification code. Please try again.");
            }
        } catch (err) {
            console.error('Send OTP error:', err);

            // Handle different error types, specifically HTTP status codes
            let errorMessage = "Unable to send verification code. Please try again.";

            // Axios/apiClient error structure often puts response data in err.response.data
            // or err.data
            const respData = err.response?.data || err.data;

            if (err.response?.status === 429) {
                errorMessage = "Too many verification attempts. Please wait 10 minutes before trying again.";
                setResendCooldown(600); // 10 minutes
            } else if (respData?.message) {
                errorMessage = respData.message;
                // Set cooldown if server explicitly provides a retryAfter duration
                if (respData.retryAfter) {
                    setResendCooldown(respData.retryAfter);
                }
            } else if (err.message) {
                errorMessage = err.message;
            }

            setError(errorMessage);
        }
        setLoading(null);
    };

    const handleVerifyOtp = async (codeToVerify) => {
        // Use the passed code if available (from auto-verify), otherwise use state
        const code = (typeof codeToVerify === 'string' ? codeToVerify : otp);

        if (!code || code.length < 6) {
            setError("Please enter the 6-digit OTP.");
            return;
        }
        setLoading('verifying');
        setError('');

        const phoneNumber = getFullPhoneNumber();

        try {
            // Call verifyOtp with phoneNumber string and otp string
            const response = await apiClient.post('/verify/check', {
                phone: formData.phone,
                code: code,
                countryCode: '+65'
            }, { skipAuth: true });
            const result = response;
            // Our backend returns { success: true, data: { verified: true/false, status: 'approved' } }

            const isVerified = result.success && (result.data?.verified === true || result.data?.status === 'approved');

            if (isVerified) {
                setLoading(null); // Stop spinner
                setShowSuccessTick(true);
                setError(''); // Clear error on successful verification
                // After showing the tick for a moment, proceed to hide the OTP form
                setTimeout(() => {
                    setOtpState('verified');
                    setShowSuccessTick(false); // Reset for future use
                }, 1200);
            } else {
                let userFriendlyError = result?.message || "Verification failed. Please try again.";
                // Provide a more helpful message for the common error
                if (userFriendlyError.includes("incorrect") || result.data?.status === 'pending') {
                    userFriendlyError = "Incorrect code. Please double-check and try again. Codes are time-sensitive.";
                }
                setError(userFriendlyError);
                setOtp(''); // Clear the OTP input on failure
                setLoading(null);
            }
        } catch (err) {
            console.error('Verification error:', err);
            // Handle different error structures
            let errorMessage = "Verification failed. Please try again.";

            const respData = err.response?.data || err.data;

            if (respData?.message) {
                errorMessage = respData.message;
            } else if (err.message) {
                errorMessage = err.message;
            } else if (typeof err === 'string') {
                errorMessage = err;
            }

            setError(errorMessage);
            setOtp(''); // Clear the OTP input on failure
            setLoading(null);
        }
    };

    const handleCancelOtp = () => {
        setOtpState('idle');
        setOtp('');
        setError('');
        setResendCooldown(0); // Reset cooldown if cancelled
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        // Basic client-side validation before submission
        if (!formData.name || !formData.email) {
            setError('Please fill in all required fields.');
            return;
        }

        if (visibleFields.phone !== false && !formData.phone) {
            setError('Please enter your phone number.');
            return;
        }

        if (visibleFields.phone !== false && otpState !== 'verified') {
            setError('Please verify your phone number before submitting.');
            return;
        }

        // Validate DOB format for full 10 characters before submission (if provided)
        if (visibleFields.dob !== false && formData.date_of_birth && formData.date_of_birth.length > 0 && formData.date_of_birth.length !== 10) {
            setError('Please enter a complete date of birth (DD/MM/YYYY).');
            return;
        }

        // Check age validation error
        if (visibleFields.dob !== false && ageError) {
            setError('Please correct the date of birth to meet the age requirements.');
            return;
        }

        // Check incomplete DOB format
        if (visibleFields.dob !== false && dobIncomplete) {
            setError('Please enter a complete date of birth (DD/MM/YYYY).');
            return;
        }

        // Validate required fields
        if (visibleFields.dob !== false && requiredFields.dob && (!formData.date_of_birth || formData.date_of_birth.length !== 10)) {
            setError('Date of Birth is required.');
            return;
        }
        if (visibleFields.postal_code !== false && requiredFields.postal_code && !formData.postal_code) {
            setError('Postal Code is required.');
            return;
        }
        if (visibleFields.education_level === true && requiredFields.education_level && !formData.education_level) {
            setError('Highest Education is required.');
            return;
        }
        if (visibleFields.monthly_income === true && requiredFields.monthly_income && !formData.monthly_income) {
            setError('Last Drawn Salary is required.');
            return;
        }

        setLoading('submitting');
        setError('');

        // Convert DD/MM/YYYY to YYYY-MM-DD for backend
        let dobFormatted = null;
        if (formData.date_of_birth && formData.date_of_birth.length === 10) {
            const [day, month, year] = formData.date_of_birth.split('/');
            // Re-validate parsed date to ensure it's a real date (e.g. Feb 30)
            const parsedDate = new Date(Number(year), Number(month) - 1, Number(day));
            if (parsedDate.getDate() === Number(day) && parsedDate.getMonth() === Number(month) - 1 && parsedDate.getFullYear() === Number(year)) {
                dobFormatted = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
            } else {
                setError('Please enter a valid date of birth.');
                setLoading(null);
                return;
            }
        }

        const dataToSubmit = {
            ...formData,
            // Send phone number without '+' (e.g., 6591234567) if phone is visible, else null
            phone: (visibleFields.phone !== false) ? getFullPhoneNumber().substring(1) : null,
            date_of_birth: (visibleFields.dob !== false) ? dobFormatted : null,
            postal_code: (visibleFields.postal_code !== false) ? formData.postal_code : null,
            education_level: (visibleFields.education_level === true) ? formData.education_level : null,
            monthly_income: (visibleFields.monthly_income === true) ? formData.monthly_income : null,
            campaign_id: campaignId // Include campaign ID if available from props
        };

        try {
            await onSubmit(dataToSubmit); // Call the onSubmit prop passed from parent
            // Optionally, reset form or show success message
            // setFormData({ name: '', email: '', phone: '', postal_code: '', date_of_birth: null });
            // setOtp('');
            // setOtpState('idle');
            // setError('');
            // alert('Form submitted successfully!'); // Or display success message in UI
        } catch (err) {
            const errorMessage = err.response?.data?.message || err.message || "Submission failed.";
            setError(errorMessage);
        }
        setLoading(null);
    };

    const renderField = (fieldId) => {
        // Skip if field is hidden via visibleFields
        // Note: 'name' and 'email' might not be in visibleFields in historically, so default to true if missing?
        // Or assume name/email match the logic in DesignEditor where they might be mandatory.
        // Based on DesignEditor, logic was:
        // const isVisible = fieldId === 'name' || fieldId === 'email' || visibleFields[fieldId] !== false;

        const isVisible = fieldId === 'name' || fieldId === 'email' || visibleFields[fieldId] !== false;
        if (!isVisible) return null;

        switch (fieldId) {
            case 'name':
                return (
                    <div key={fieldId} className="space-y-1">
                        <Label htmlFor="name" className="text-xs font-medium">Full Name</Label>
                        <div className="relative">
                            <User className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400" />
                            <Input
                                id="name"
                                placeholder="John Tan"
                                className="pl-7 h-8 text-sm"
                                value={formData.name}
                                onChange={(e) => handleFormChange('name', e.target.value)}
                                required
                            />
                        </div>
                    </div>
                );
            case 'phone':
                return (
                    <div key={fieldId} className="space-y-1">
                        <Label htmlFor="phone" className="text-xs font-medium">Phone Number</Label>
                        <div className="flex items-center gap-1">
                            <div className="flex-grow flex">
                                <div className="flex items-center px-3 bg-gray-50 border border-r-0 rounded-l-md h-8 text-sm font-medium text-gray-700 whitespace-nowrap">
                                    🇸🇬 +65
                                </div>
                                <div className="relative flex-grow group">
                                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 group-focus-within:text-blue-500 transition-colors" />
                                    <Input
                                        id="phone"
                                        type="tel"
                                        placeholder="9123 4567"
                                        className="pl-7 h-8 text-sm rounded-l-none border-l-0"
                                        value={displayPhone(formData.phone)} // Display formatted phone
                                        onChange={(e) => handleFormChange('phone', e.target.value)} // Store raw phone digits
                                        disabled={otpState !== 'idle'}
                                        required
                                        maxLength={9} // 8 digits + 1 space
                                    />
                                </div>
                            </div>
                            {otpState === 'idle' && (
                                <Button
                                    type="button" // Important: Prevent form submission
                                    onClick={handleSendOtp}
                                    disabled={loading === 'sending' || formData.phone.length !== 8}
                                    className="w-28 h-8 bg-black hover:bg-gray-800 text-white font-medium text-sm"
                                >
                                    {loading === 'sending' ? (
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                    ) : (
                                        'Verify'
                                    )}
                                </Button>
                            )}
                            {otpState === 'verified' && (
                                <motion.div
                                    className="flex items-center justify-center gap-2 text-white font-medium text-sm w-28 h-8 bg-green-500 rounded-md"
                                    initial={{ scale: 0, opacity: 0 }}
                                    animate={{ scale: 1, opacity: 1 }}
                                    transition={{
                                        type: "spring",
                                        stiffness: 500,
                                        damping: 25,
                                        duration: 0.3
                                    }}
                                >
                                    <motion.div
                                        initial={{ scale: 0, rotate: -180 }}
                                        animate={{ scale: 1, rotate: 0 }}
                                        transition={{
                                            delay: 0.1,
                                            type: "spring",
                                            stiffness: 600,
                                            damping: 20
                                        }}
                                    >
                                        <CheckCircle2 className="w-5 h-5" />
                                    </motion.div>
                                    <span>OK</span>
                                </motion.div>
                            )}
                        </div>
                        {/* OTP Logic - Renamed 'phone' to keep consistent with block logic */}
                        {
                            otpState === 'pending' && (
                                <motion.div
                                    className="pt-4 pb-2"
                                    initial={{ opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: 'auto' }}
                                    exit={{ opacity: 0, height: 0 }}
                                    transition={{ duration: 0.3, ease: "easeInOut" }}
                                >
                                    <div className={`p-3 rounded-lg border bg-white/50 backdrop-blur-sm shadow-sm space-y-3 ${error ? 'border-red-200 ring-4 ring-red-50' : 'border-gray-100'}`}>
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <Label htmlFor="otp" className="text-sm font-semibold text-gray-800">Verify your number</Label>
                                                <p className="text-[11px] text-gray-500 mt-0.5">Enter code sent to +65 {displayPhone(formData.phone)}</p>
                                            </div>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                onClick={handleCancelOtp}
                                                className="h-8 w-8 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full"
                                            >
                                                <X className="w-4 h-4" />
                                            </Button>
                                        </div>

                                        <div className="flex flex-col items-center justify-center space-y-4 py-2">
                                            <div className="relative">
                                                <InputOTP
                                                    maxLength={6}
                                                    value={otp}
                                                    onChange={(value) => {
                                                        setOtp(value);
                                                        if (value.length === 6) {
                                                            // Auto-verify when full, passing the value directly to avoid stale state
                                                            handleVerifyOtp(value);
                                                        }
                                                    }}
                                                    pattern={REGEXP_ONLY_DIGITS}
                                                    disabled={loading === 'verifying' || showSuccessTick}
                                                >
                                                    <InputOTPGroup>
                                                        <InputOTPSlot index={0} className="h-10 w-9 sm:h-12 sm:w-10 bg-white" />
                                                        <InputOTPSlot index={1} className="h-10 w-9 sm:h-12 sm:w-10 bg-white" />
                                                        <InputOTPSlot index={2} className="h-10 w-9 sm:h-12 sm:w-10 bg-white" />
                                                    </InputOTPGroup>
                                                    <InputOTPSeparator />
                                                    <InputOTPGroup>
                                                        <InputOTPSlot index={3} className="h-10 w-9 sm:h-12 sm:w-10 bg-white" />
                                                        <InputOTPSlot index={4} className="h-10 w-9 sm:h-12 sm:w-10 bg-white" />
                                                        <InputOTPSlot index={5} className="h-10 w-9 sm:h-12 sm:w-10 bg-white" />
                                                    </InputOTPGroup>
                                                </InputOTP>

                                                {/* Success Overlay Animation */}
                                                <AnimatePresence>
                                                    {showSuccessTick && (
                                                        <motion.div
                                                            className="absolute inset-0 flex items-center justify-center bg-white/80 backdrop-blur-[1px] rounded-md z-10"
                                                            initial={{ opacity: 0 }}
                                                            animate={{ opacity: 1 }}
                                                            exit={{ opacity: 0 }}
                                                        >
                                                            <motion.div
                                                                initial={{ scale: 0.5, opacity: 0 }}
                                                                animate={{ scale: 1, opacity: 1 }}
                                                                transition={{ type: 'spring', stiffness: 400, damping: 15 }}
                                                            >
                                                                <div className="bg-green-500 rounded-full p-2 shadow-lg">
                                                                    <CheckCircle2 className="w-6 h-6 text-white" />
                                                                </div>
                                                            </motion.div>
                                                        </motion.div>
                                                    )}
                                                </AnimatePresence>
                                            </div>

                                            {loading === 'verifying' && (
                                                <div className="flex items-center justify-center gap-2 text-sm text-gray-500 py-1">
                                                    <Loader2 className="w-3 h-3 animate-spin" />
                                                    <span>Verifying...</span>
                                                </div>
                                            )}
                                        </div>

                                        <div className="text-center">
                                            <p className="text-xs text-gray-500">
                                                Didn't receive code?{' '}
                                                <button
                                                    type="button"
                                                    onClick={handleSendOtp}
                                                    disabled={resendCooldown > 0 || loading === 'sending'}
                                                    className="font-semibold text-blue-600 hover:text-blue-700 disabled:text-gray-400 disabled:cursor-not-allowed transition-colors"
                                                >
                                                    {resendCooldown > 0 ? (
                                                        resendCooldown > 60 ?
                                                            `Wait ${Math.ceil(resendCooldown / 60)}m` :
                                                            `Resend in ${resendCooldown}s`
                                                    ) : (
                                                        loading === 'sending' ? 'Sending...' : 'Resend now'
                                                    )}
                                                </button>
                                            </p>
                                        </div>

                                        <AnimatePresence>
                                            {error && (
                                                <motion.div
                                                    className="flex items-start gap-3 p-3 text-sm text-red-600 bg-red-50 rounded-lg border border-red-100"
                                                    initial={{ opacity: 0, y: -5, height: 0 }}
                                                    animate={{ opacity: 1, y: 0, height: 'auto' }}
                                                    exit={{ opacity: 0, y: -5, height: 0 }}
                                                >
                                                    <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                                                    <span className="leading-snug">{error}</span>
                                                </motion.div>
                                            )}
                                        </AnimatePresence>
                                    </div>
                                </motion.div>
                            )}

                        {
                            error && otpState !== 'pending' && (
                                <motion.div
                                    className="flex items-center gap-2 text-xs text-red-600 bg-red-50 p-2 rounded border mt-2"
                                    initial={{ opacity: 0, y: -10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ duration: 0.2 }}
                                >
                                    <AlertCircle className="w-3 h-3" />
                                    <span>{error}</span>
                                </motion.div>
                            )
                        }
                    </div>
                );
            case 'email':
                return (
                    <div key={fieldId} className="space-y-1">
                        <Label htmlFor="email" className="text-xs font-medium">Email</Label>
                        <div className="relative">
                            <Mail className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400" />
                            <Input
                                id="email"
                                type="email"
                                placeholder="you@example.com"
                                className="pl-7 h-8 text-sm"
                                value={formData.email}
                                onChange={(e) => handleFormChange('email', e.target.value)}
                                required
                            />
                        </div>
                    </div>
                );
            case 'dob':
                return (
                    <div key={fieldId} className="space-y-1">
                        <Label htmlFor="dob" className="text-xs font-medium">Date of Birth{!requiredFields.dob && <span className="text-gray-400 font-normal"> (optional)</span>}</Label>
                        <div className="relative">
                            <CalendarIcon className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400" />
                            <Input
                                id="dob"
                                type="tel"
                                inputMode="numeric"
                                placeholder="DD/MM/YYYY"
                                className={`pl-7 h-8 text-sm ${(dobIncomplete || ageError) ? 'border-red-500 focus:border-red-500 focus:ring-red-500' : ''}`}
                                value={formData.date_of_birth}
                                onChange={(e) => handleFormChange('date_of_birth', e.target.value)}
                                onBlur={handleDobBlur}
                                maxLength={10}
                            />
                        </div>
                        {(ageError || dobIncomplete) && (
                            <motion.div
                                className="flex items-center gap-1 text-xs text-red-600 bg-red-50 p-1.5 rounded border"
                                initial={{ opacity: 0, y: -10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.2 }}
                            >
                                <AlertCircle className="w-3 h-3" />
                                <span>{ageError || 'Please enter full year (DDMMYYYY)'}</span>
                            </motion.div>
                        )}
                        {(!ageError && !dobIncomplete && renderAgeRestrictionHint()) && (
                            <div className="text-[11px] text-gray-500 pt-1">
                                {renderAgeRestrictionHint()}
                            </div>
                        )}
                    </div>
                );
            case 'postal_code':
                return (
                    <div key={fieldId} className="space-y-1">
                        <Label htmlFor="postal" className="text-xs font-medium">Postal Code{!requiredFields.postal_code && <span className="text-gray-400 font-normal"> (optional)</span>}</Label>
                        <div className="relative">
                            <MapPin className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400" />
                            <Input
                                id="postal"
                                placeholder="520230"
                                className="pl-7 h-8 text-sm"
                                maxLength={6}
                                value={formData.postal_code}
                                onChange={(e) => handleFormChange('postal_code', e.target.value.replace(/\D/g, '').slice(0, 6))}
                            />
                        </div>
                    </div>
                );
            case 'education_level':
                return (
                    <div key={fieldId} className="space-y-1">
                        <Label htmlFor="education" className="text-xs font-medium">Highest Education{!requiredFields.education_level && <span className="text-gray-400 font-normal"> (optional)</span>}</Label>
                        <Select
                            value={formData.education_level}
                            onValueChange={(value) => handleFormChange('education_level', value)}
                        >
                            <SelectTrigger className="h-8 text-sm">
                                <SelectValue placeholder="Select education level" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="Secondary School or below">Secondary School or below</SelectItem>
                                <SelectItem value="O Levels">O Levels</SelectItem>
                                <SelectItem value="Diploma">Diploma</SelectItem>
                                <SelectItem value="Degree">Degree</SelectItem>
                                <SelectItem value="Masters and above">Masters and above</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                );
            case 'monthly_income':
                return (
                    <div key={fieldId} className="space-y-1">
                        <Label htmlFor="income" className="text-xs font-medium">Last Drawn Salary{!requiredFields.monthly_income && <span className="text-gray-400 font-normal"> (optional)</span>}</Label>
                        <Select
                            value={formData.monthly_income}
                            onValueChange={(value) => handleFormChange('monthly_income', value)}
                        >
                            <SelectTrigger className="h-8 text-sm">
                                <SelectValue placeholder="Select salary range" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="<$3000">&lt;$3000</SelectItem>
                                <SelectItem value="$3000 - $4999">$3000 - $4999</SelectItem>
                                <SelectItem value="$5000 - $7999">$5000 - $7999</SelectItem>
                                <SelectItem value=">$8000">&gt;$8000</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                );
            default:
                return null;
        }
    };

    return (
        <form onSubmit={handleSubmit}>
            <div className="text-center mb-4">
                <h2
                    className="font-bold text-gray-900"
                    style={{ fontSize: `${headlineSize || 20}px` }}
                >
                    {formHeadline}
                </h2>
                <p className="text-sm text-gray-600 mt-1">{formSubheadline}</p>
            </div>

            <div className="space-y-3">
                {fieldOrder.map((item, index) => {
                    // Handle legacy flat array strings
                    if (typeof item === 'string') {
                        return renderField(item);
                    }

                    // Handle new row object structure: { id: 'row-x', columns: ['left', 'right'] }
                    if (item.columns && Array.isArray(item.columns)) {
                        return (
                            <div key={item.id || index} className={`grid gap-3 ${item.columns.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                                {item.columns.map(colId => {
                                    // If we are in a 2-col row, we need to make sure the field itself doesn't have internal margins that look bad.
                                    // renderField returns a div with "space-y-1" or "mb-3". 
                                    // The grid gap-3 takes care of spacing between columns.
                                    return renderField(colId);
                                })}
                            </div>
                        );
                    }
                    return null;
                })}
            </div>

            <Button
                type="submit"
                className="w-full text-sm py-4 font-semibold shadow-md hover:shadow-lg transition-all duration-200 mt-4"
                style={{ backgroundColor: themeColor }}
                disabled={
                    otpState !== 'verified' ||
                    loading === 'submitting' ||
                    ageError !== '' ||
                    dobIncomplete
                }
            >
                {loading === 'submitting' ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : 'Submit'}
            </Button>
            <p className="text-xs text-gray-500 text-center pt-1">
                By signing up, you agree to our{' '}
                <button
                    type="button"
                    onClick={() => setConsentOpen(true)}
                    className="text-blue-600 hover:underline"
                >
                    Terms & Conditions
                </button>
                .
            </p>

            <MarketingConsentDialog open={consentOpen} onOpenChange={setConsentOpen} />
        </form >
    );
}
