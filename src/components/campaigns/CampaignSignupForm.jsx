
import React, { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  X
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";
import { sendOtp, verifyOtp } from "../lib/customFunctions";
import { motion } from "framer-motion";

export default function CampaignSignupForm({ themeColor, formHeadline, formSubheadline, headlineSize, campaignId, onSubmit, campaign }) {
    const [formData, setFormData] = useState({
        name: '',
        email: '',
        phone: '', // Now just the 8-digit number
        postal_code: '',
        date_of_birth: '', // Now stored as string in DD/MM/YYYY format
    });
    const [otp, setOtp] = useState('');
    const [otpState, setOtpState] = useState('idle'); // 'idle', 'pending', 'verified'
    const [loading, setLoading] = useState(null); // 'sending', 'verifying', 'submitting'
    const [error, setError] = useState('');
    const [ageError, setAgeError] = useState(''); // New: Age validation error
    const [dobIncomplete, setDobIncomplete] = useState(false); // New: Track incomplete DOB format
    const [resendCooldown, setResendCooldown] = useState(0);
    const [showSuccessTick, setShowSuccessTick] = useState(false);

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

    // New: Validate age against campaign range
    const validateAge = (dateString) => {
        if (!campaign) { // If campaign object is not provided, no age validation is performed
            setAgeError('');
            return;
        }
        
        // Check if user entered incomplete date (not exactly 8 digits)
        const digitsOnly = dateString.replace(/\D/g, '');
        if (digitsOnly.length > 0 && digitsOnly.length !== 8) {
            setAgeError('Please enter full year in DDMMYYYY format');
            return;
        }

        const age = calculateAge(dateString);
        if (age === null) { // If date string is invalid or incomplete, no age error (yet)
            setAgeError('');
            return;
        }
        
        const minAge = campaign.min_age || 0;
        const maxAge = campaign.max_age || 150; // Default max age if not specified
        
        if (age < minAge || age > maxAge) {
            setAgeError(`Age should be between ${minAge} to ${maxAge} years old.`);
        } else {
            setAgeError('');
        }
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
            // Call sendOtp with just the phone number string
            const response = await sendOtp(phoneNumber);
            
            const result = response.data || response; // `result` will be the actual payload
            
            if (result.success) {
                setOtpState('pending');
                setResendCooldown(30); // Start cooldown timer
            } else {
                // Handle non-successful responses where status is not an error that throws
                if (response.status === 429) { 
                    setError(result.message || "Too many attempts. Please wait before trying again.");
                    setResendCooldown(600); // 10 minutes cooldown for rate limiting
                } else {
                    setError(result.message || "Failed to send verification code. Please try again.");
                }
            }
        } catch (err) {
            console.error('Send OTP error:', err);
            
            // Handle different error types, specifically HTTP status codes
            let errorMessage = "Unable to send verification code. Please try again.";
            
            if (err.response?.status === 429) {
                errorMessage = "Too many verification attempts. Please wait 10 minutes before trying again.";
                setResendCooldown(600); // 10 minutes
            } else if (err.response?.data?.message) {
                errorMessage = err.response.data.message;
                // Set cooldown if server explicitly provides a retryAfter duration
                if (err.response.data.retryAfter) {
                    setResendCooldown(err.response.data.retryAfter);
                }
            } else if (err.message) {
                errorMessage = err.message;
            }
            
            setError(errorMessage);
        }
        setLoading(null);
    };

    const handleVerifyOtp = async () => {
        if (otp.length < 6) {
            setError("Please enter the 6-digit OTP.");
            return;
        }
        setLoading('verifying');
        setError('');
        
        const phoneNumber = getFullPhoneNumber();

        try {
            // Call verifyOtp with phoneNumber string and otp string
            const response = await verifyOtp(phoneNumber, otp); 
            const result = response.data || response; // `result` will be the actual payload
            
            if (result && result.success) {
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
                if (userFriendlyError.includes("incorrect")) {
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
            
            if (err.response?.data?.message) {
                errorMessage = err.response.data.message;
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
        if (!formData.name || !formData.email || !formData.phone) {
            setError('Please fill in all required fields.');
            return;
        }

        if (otpState !== 'verified') {
            setError('Please verify your phone number before submitting.');
            return;
        }

        // Validate DOB format for full 10 characters before submission
        if (formData.date_of_birth && formData.date_of_birth.length !== 10) {
            setError('Please enter a complete date of birth (DD/MM/YYYY).');
            return;
        }

        // Check age validation error
        if (ageError) {
            setError('Please correct the date of birth to meet the age requirements.');
            return;
        }

        // Check incomplete DOB format
        if (dobIncomplete) {
            setError('Please enter a complete date of birth (DD/MM/YYYY).');
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
            // Send phone number without '+' (e.g., 6591234567)
            phone: getFullPhoneNumber().substring(1), 
            date_of_birth: dobFormatted,
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
                <div className="space-y-1">
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

                <div className="space-y-1">
                    <Label htmlFor="phone" className="text-xs font-medium">Phone Number</Label>
                    <div className="flex items-center gap-1">
                        <div className="flex-grow flex">
                            <div className="flex items-center px-3 bg-gray-50 border border-r-0 rounded-l-md h-8 text-sm font-medium text-gray-700 whitespace-nowrap">
                                🇸🇬 +65
                            </div>
                            <div className="relative flex-grow">
                                <Phone className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400" />
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
                </div>

                {otpState === 'pending' && (
                    <motion.div 
                        className="space-y-2 p-3 bg-gray-50 rounded-lg border"
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        transition={{ duration: 0.2 }}
                    >
                        <div className="flex items-center justify-between">
                            <Label htmlFor="otp" className="text-sm font-medium text-gray-800">Enter Code</Label>
                            <Button
                                type="button" // Important: Prevent form submission
                                variant="ghost"
                                size="sm"
                                onClick={handleCancelOtp}
                                className="text-gray-500 hover:text-gray-700 h-6 px-1"
                            >
                                <X className="w-3 h-3" />
                            </Button>
                        </div>
                        <p className="text-xs text-gray-500 !-mt-1">Sent to +65 {displayPhone(formData.phone)}</p>
                        <div className="flex items-center gap-2">
                            <div className="relative flex-grow">
                                <ShieldCheck className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                                <Input
                                    id="otp"
                                    type="tel" // Added for numeric keyboard on mobile
                                    inputMode="numeric" // Added for numeric keyboard on mobile
                                    autoComplete="one-time-code" // Added for OTP autofill
                                    placeholder="123456"
                                    className="pl-8 tracking-wider h-9 text-sm"
                                    maxLength={6}
                                    value={otp}
                                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                                />
                            </div>
                            <Button 
                                type="button"
                                size="sm" 
                                onClick={handleVerifyOtp} 
                                disabled={loading === 'verifying' || showSuccessTick}
                                className={`h-9 px-4 text-sm w-28 transition-colors duration-300 ${showSuccessTick ? 'bg-green-500 hover:bg-green-600' : ''}`}
                            >
                                {showSuccessTick ? (
                                    <motion.div
                                        initial={{ scale: 0, rotate: -90 }}
                                        animate={{ scale: 1, rotate: 0 }}
                                        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                                    >
                                        <CheckCircle2 className="w-5 h-5 text-white" />
                                    </motion.div>
                                ) : loading === 'verifying' ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                    'Confirm'
                                )}
                            </Button>
                        </div>
                        <div className="text-center text-xs text-gray-500 pt-1">
                            Didn't receive a code?{' '}
                            <Button
                                type="button"
                                variant="link"
                                size="sm"
                                onClick={handleSendOtp}
                                disabled={resendCooldown > 0}
                                className="h-auto p-0 text-xs font-semibold text-blue-600 hover:text-blue-800 disabled:text-gray-500 disabled:no-underline"
                            >
                                {resendCooldown > 0 ? 
                                    (resendCooldown > 60 ? 
                                        `Wait ${Math.ceil(resendCooldown / 60)} min` : 
                                        `Resend in ${resendCooldown}s`
                                    ) : 
                                    'Resend now'
                                }
                            </Button>
                        </div>
                    </motion.div>
                )}

                {error && (
                    <motion.div 
                        className="flex items-center gap-2 text-xs text-red-600 bg-red-50 p-2 rounded border"
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.2 }}
                    >
                        <AlertCircle className="w-3 h-3" />
                        <span>{error}</span>
                    </motion.div>
                )}

                <div className="space-y-1">
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

                <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                        <Label htmlFor="dob" className="text-xs font-medium">Date of Birth</Label>
                        <div className="relative">
                            <CalendarIcon className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400" />
                            <Input
                                id="dob"
                                type="tel" // Use tel for numeric keyboard on mobile
                                inputMode="numeric" // Ensure numeric keyboard
                                placeholder="DD/MM/YYYY"
                                className={`pl-7 h-8 text-sm ${dobIncomplete ? 'border-red-500 focus:border-red-500 focus:ring-red-500' : ''}`}
                                value={formData.date_of_birth}
                                onChange={(e) => handleFormChange('date_of_birth', e.target.value)}
                                onBlur={handleDobBlur} // Add this
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
                    </div>
                    <div className="space-y-1">
                        <Label htmlFor="postal" className="text-xs font-medium">Postal Code</Label>
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
                    By signing up, you agree to our Terms of Service.
                </p>
            </div>
        </form>
    );
}
