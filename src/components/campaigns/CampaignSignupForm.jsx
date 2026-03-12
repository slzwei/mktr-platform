
import { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Loader2, ChevronRight } from "lucide-react";
import { apiClient } from "@/api/client";
import FieldRenderer from "@/components/campaigns/signup/FieldRenderer";
import ConsentSection from "@/components/campaigns/signup/ConsentSection";
import {
    formatDateInput,
    getAgeValidationError,
    getAgeRestrictionHint,
    displayPhone,
} from "@/components/campaigns/signup/dateUtils";

export default function CampaignSignupForm({ themeColor, formHeadline, formSubheadline, headlineSize, campaignId, onSubmit, campaign, alignment, textColor, termsContent }) {
    const visibleFields = campaign?.design_config?.visibleFields || {};
    const requiredFields = campaign?.design_config?.requiredFields || {};
    const fieldOrder = campaign?.design_config?.fieldOrder || ['name', 'phone', 'email', 'dob', 'postal_code', 'education_level', 'monthly_income'];

    const [formData, setFormData] = useState({
        name: '', email: '', phone: '', postal_code: '',
        date_of_birth: '', education_level: '', monthly_income: ''
    });
    const [otp, setOtp] = useState('');
    const [otpState, setOtpState] = useState('idle');
    const [loading, setLoading] = useState(null);
    const [error, setError] = useState('');
    const [ageError, setAgeError] = useState('');
    const [dobIncomplete, setDobIncomplete] = useState(false);
    const [resendCooldown, setResendCooldown] = useState(0);
    const [showSuccessTick, setShowSuccessTick] = useState(false);
    const [consentOpen, setConsentOpen] = useState(false);

    const textStyle = textColor ? { color: textColor } : {};
    const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    const getFullPhoneNumber = () => `+65${formData.phone}`;
    const renderAgeRestrictionHint = () => getAgeRestrictionHint(campaign);

    useEffect(() => {
        let timer;
        if (resendCooldown > 0) {
            timer = setTimeout(() => setResendCooldown(prev => prev - 1), 1000);
        }
        return () => clearTimeout(timer);
    }, [resendCooldown]);

    const handleDobBlur = () => {
        const digitsOnly = formData.date_of_birth.replace(/\D/g, '');
        setDobIncomplete(digitsOnly.length > 0 && digitsOnly.length !== 8);
    };

    const handleFormChange = (key, value) => {
        if (key === 'phone') {
            let digits = value.replace(/\D/g, '');
            if (digits.startsWith('65') && digits.length > 8) digits = digits.substring(2);
            setFormData(prev => ({ ...prev, phone: digits.slice(0, 8) }));
        } else if (key === 'date_of_birth') {
            const formattedDate = formatDateInput(value);
            setFormData(prev => ({ ...prev, [key]: formattedDate }));
            const digitsOnly = formattedDate.replace(/\D/g, '');
            if (digitsOnly.length !== 6 && dobIncomplete) setDobIncomplete(false);
            setAgeError(getAgeValidationError(formattedDate, campaign));
        } else {
            setFormData(prev => ({ ...prev, [key]: value }));
        }
    };

    const handleSendOtp = async () => {
        if (formData.phone.length !== 8) {
            setError("Please enter a valid 8-digit Singapore phone number.");
            return;
        }
        if (!['3', '6', '8', '9'].includes(formData.phone[0])) {
            setError("Invalid number. Must start with 3, 6, 8, or 9.");
            return;
        }

        setLoading('sending');
        setError('');

        try {
            const response = await apiClient.post('/verify/send', {
                phone: formData.phone, countryCode: '+65', campaignId
            }, { skipAuth: true });

            if (response.success) {
                setOtpState('pending');
                setResendCooldown(30);
            } else {
                setError(response.message || "Failed to send verification code. Please try again.");
            }
        } catch (err) {
            console.error('Send OTP error:', err);
            let errorMessage = "Unable to send verification code. Please try again.";
            const respData = err.response?.data || err.data;

            if (err.response?.status === 429) {
                errorMessage = "Too many verification attempts. Please wait 10 minutes before trying again.";
                setResendCooldown(600);
            } else if (respData?.message) {
                errorMessage = respData.message;
                if (respData.retryAfter) setResendCooldown(respData.retryAfter);
            } else if (err.message) {
                errorMessage = err.message;
            }
            setError(errorMessage);
        }
        setLoading(null);
    };

    const handleVerifyOtp = async (codeToVerify) => {
        const code = (typeof codeToVerify === 'string' ? codeToVerify : otp);
        if (!code || code.length < 6) {
            setError("Please enter the 6-digit OTP.");
            return;
        }
        setLoading('verifying');
        setError('');

        try {
            const response = await apiClient.post('/verify/check', {
                phone: formData.phone, code, countryCode: '+65'
            }, { skipAuth: true });
            const result = response;
            const isVerified = result.success && (result.data?.verified === true || result.data?.status === 'approved');

            if (isVerified) {
                setLoading(null);
                setShowSuccessTick(true);
                setError('');
                setTimeout(() => {
                    setOtpState('verified');
                    setShowSuccessTick(false);
                }, 1200);
            } else {
                let userFriendlyError = result?.message || "Verification failed. Please try again.";
                if (userFriendlyError.includes("incorrect") || result.data?.status === 'pending') {
                    userFriendlyError = "Incorrect code. Please double-check and try again. Codes are time-sensitive.";
                }
                setError(userFriendlyError);
                setOtp('');
                setLoading(null);
            }
        } catch (err) {
            console.error('Verification error:', err);
            let errorMessage = "Verification failed. Please try again.";
            const respData = err.response?.data || err.data;
            if (respData?.message) errorMessage = respData.message;
            else if (err.message) errorMessage = err.message;
            else if (typeof err === 'string') errorMessage = err;
            setError(errorMessage);
            setOtp('');
            setLoading(null);
        }
    };

    const handleCancelOtp = () => {
        setOtpState('idle');
        setOtp('');
        setError('');
        setResendCooldown(0);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        if (!formData.name || !formData.email) { setError('Please fill in all required fields.'); return; }
        if (visibleFields.phone !== false && !formData.phone) { setError('Please enter your phone number.'); return; }
        if (visibleFields.phone !== false && otpState !== 'verified') { setError('Please verify your phone number before submitting.'); return; }
        if (visibleFields.dob !== false && formData.date_of_birth && formData.date_of_birth.length > 0 && formData.date_of_birth.length !== 10) { setError('Please enter a complete date of birth (DD/MM/YYYY).'); return; }
        if (visibleFields.dob !== false && ageError) { setError('Please correct the date of birth to meet the age requirements.'); return; }
        if (visibleFields.dob !== false && dobIncomplete) { setError('Please enter a complete date of birth (DD/MM/YYYY).'); return; }
        if (visibleFields.dob !== false && requiredFields.dob && (!formData.date_of_birth || formData.date_of_birth.length !== 10)) { setError('Date of Birth is required.'); return; }
        if (visibleFields.postal_code !== false && requiredFields.postal_code && !formData.postal_code) { setError('Postal Code is required.'); return; }
        if (visibleFields.education_level === true && requiredFields.education_level && !formData.education_level) { setError('Highest Education is required.'); return; }
        if (visibleFields.monthly_income === true && requiredFields.monthly_income && !formData.monthly_income) { setError('Last Drawn Salary is required.'); return; }

        setLoading('submitting');
        setError('');

        let dobFormatted = null;
        if (formData.date_of_birth && formData.date_of_birth.length === 10) {
            const [day, month, year] = formData.date_of_birth.split('/');
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
            phone: (visibleFields.phone !== false) ? getFullPhoneNumber() : null,
            date_of_birth: (visibleFields.dob !== false) ? dobFormatted : null,
            postal_code: (visibleFields.postal_code !== false) ? formData.postal_code : null,
            education_level: (visibleFields.education_level === true) ? formData.education_level : null,
            monthly_income: (visibleFields.monthly_income === true) ? formData.monthly_income : null,
            campaign_id: campaignId
        };

        try {
            await onSubmit(dataToSubmit);
        } catch (err) {
            setError(err.response?.data?.message || err.message || "Submission failed.");
        }
        setLoading(null);
    };

    const fieldProps = {
        formData, themeColor, textStyle, visibleFields, requiredFields,
        handleFormChange, displayPhone, otpState, loading, handleSendOtp,
        otp, setOtp, handleVerifyOtp, handleCancelOtp, showSuccessTick,
        resendCooldown, error, handleDobBlur, dobIncomplete, ageError,
        renderAgeRestrictionHint,
    };

    const renderField = (fieldId) => <FieldRenderer key={fieldId} fieldId={fieldId} {...fieldProps} />;

    return (
        <form onSubmit={handleSubmit} className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className={`mb-6 text-${alignment || 'center'}`}>
                <h2 className="font-bold text-gray-900 leading-tight" style={{ fontSize: `${headlineSize || 24}px`, ...textStyle }}>
                    {formHeadline}
                </h2>
                <p className="text-base text-gray-500 mt-2" style={textStyle}>{formSubheadline}</p>
            </div>

            <div className="space-y-4">
                {fieldOrder.map((item, index) => {
                    if (typeof item === 'string') return renderField(item);
                    if (item.columns && Array.isArray(item.columns)) {
                        return (
                            <div key={item.id || index} className={`grid gap-4 ${item.columns.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                                {item.columns.map(colId => renderField(colId))}
                            </div>
                        );
                    }
                    return null;
                })}
            </div>

            <Button
                type="submit"
                className="w-full h-12 text-base font-semibold shadow-lg hover:shadow-xl hover:scale-[1.01] active:scale-[0.98] transition-all duration-200 mt-8 rounded-xl"
                style={{ backgroundColor: themeColor }}
                disabled={otpState !== 'verified' || loading === 'submitting' || ageError !== '' || dobIncomplete || !isValidEmail(formData.email)}
            >
                {loading === 'submitting' ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : 'Submit Application'}
                {!loading && <ChevronRight className="w-4 h-4 ml-2 opacity-80" />}
            </Button>

            <ConsentSection consentOpen={consentOpen} setConsentOpen={setConsentOpen} termsContent={termsContent} />
        </form >
    );
}
