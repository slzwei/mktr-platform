
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
    Loader2,
    AlertCircle,
    X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion, AnimatePresence } from "framer-motion";
import OTPVerification from "@/components/campaigns/signup/OTPVerification";

export default function FieldRenderer({
    fieldId,
    formData,
    themeColor,
    textStyle,
    visibleFields,
    requiredFields,
    handleFormChange,
    // Phone/OTP props
    displayPhone,
    otpState,
    loading,
    handleSendOtp,
    // OTP panel props
    otp,
    setOtp,
    handleVerifyOtp,
    handleCancelOtp,
    showSuccessTick,
    resendCooldown,
    error,
    // DOB props
    handleDobBlur,
    dobIncomplete,
    ageError,
    renderAgeRestrictionHint,
}) {
    // Skip if field is hidden via visibleFields
    const isVisible = fieldId === 'name' || fieldId === 'email' || visibleFields[fieldId] !== false;
    if (!isVisible) return null;

    switch (fieldId) {
        case 'name':
            return (
                <div key={fieldId} className="space-y-1.5">
                    <Label htmlFor="name" style={textStyle}>Full Name {requiredFields.name !== false && '*'}</Label>
                    <div className="relative group">
                        <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 group-focus-within:text-gray-800 transition-colors" />
                        <Input
                            id="name"
                            placeholder="John Tan"
                            className="pl-10 h-11 text-base bg-gray-50/50 border-gray-200 focus:bg-white focus:border-gray-300 focus:ring-2 focus:ring-offset-0 transition-all rounded-xl"
                            style={{ '--tw-ring-color': themeColor + '33' }}
                            value={formData.name}
                            onChange={(e) => handleFormChange('name', e.target.value)}
                            required
                        />
                    </div>
                </div>
            );
        case 'phone':
            return (
                <div key={fieldId} className="space-y-1.5">
                    <Label htmlFor="phone" style={textStyle}>Phone Number {requiredFields.phone !== false && '*'}</Label>
                    <div className="flex items-center gap-2">
                        <div className="flex-grow flex shadow-sm rounded-xl overflow-hidden active-ring focus-within:ring-2 focus-within:ring-offset-0 transition-all" style={{ '--tw-ring-color': themeColor + '33' }}>
                            <div className="flex items-center px-3.5 bg-gray-50 border border-r-0 border-gray-200 text-sm font-medium text-gray-600 whitespace-nowrap">
                                🇸🇬 +65
                            </div>
                            <div className="relative flex-grow group">
                                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 group-focus-within:text-gray-800 transition-colors" />
                                <Input
                                    id="phone"
                                    type="tel"
                                    placeholder="9123 4567"
                                    className="pl-10 h-11 text-base rounded-l-none border-l-0 border-gray-200 focus:ring-0 bg-white"
                                    value={displayPhone(formData.phone)}
                                    onChange={(e) => handleFormChange('phone', e.target.value)}
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
                                disabled={loading === 'sending' || formData.phone.length !== 8}
                                className="h-11 px-6 font-semibold shadow-sm hover:shadow transition-all rounded-xl min-w-[100px]"
                                style={{ backgroundColor: formData.phone.length === 8 ? themeColor : '#E5E7EB', color: formData.phone.length === 8 ? '#fff' : '#9CA3AF' }}
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
                                className="flex items-center justify-center gap-2 text-white font-medium text-sm px-4 h-11 bg-green-500 rounded-xl shadow-sm min-w-[100px]"
                                initial={{ scale: 0.9, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                            >
                                <CheckCircle2 className="w-5 h-5" />
                                <span>Verified</span>
                            </motion.div>
                        )}
                    </div>
                    {/* OTP Logic */}
                    <OTPVerification
                        otpState={otpState}
                        otp={otp}
                        setOtp={setOtp}
                        loading={loading}
                        error={error}
                        showSuccessTick={showSuccessTick}
                        resendCooldown={resendCooldown}
                        displayPhone={displayPhone}
                        phone={formData.phone}
                        themeColor={themeColor}
                        textStyle={textStyle}
                        handleVerifyOtp={handleVerifyOtp}
                        handleCancelOtp={handleCancelOtp}
                        handleSendOtp={handleSendOtp}
                    />

                    <AnimatePresence>
                        {/* Error display for when OTP is not expanded but there is an error (e.g. failed send) */}
                        {error && otpState !== 'pending' && (
                            <motion.div
                                className="flex items-center gap-2 text-xs text-red-600 bg-red-50 p-3 rounded-xl border border-red-100 mt-2"
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: 'auto' }}
                                exit={{ opacity: 0, height: 0 }}
                            >
                                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                                <span style={textStyle}>{error}</span>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            );
        case 'email':
            return (
                <div key={fieldId} className="space-y-1.5">
                    <Label htmlFor="email" style={textStyle}>Email Address {requiredFields.email !== false && '*'}</Label>
                    <div className="relative group">
                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 group-focus-within:text-gray-800 transition-colors" />
                        <Input
                            id="email"
                            type="email"
                            placeholder="you@example.com"
                            className="pl-10 h-11 text-base bg-gray-50/50 border-gray-200 focus:bg-white focus:border-gray-300 focus:ring-2 focus:ring-offset-0 transition-all rounded-xl"
                            style={{ '--tw-ring-color': themeColor + '33' }}
                            value={formData.email}
                            onChange={(e) => handleFormChange('email', e.target.value)}
                            required
                        />
                    </div>
                </div>
            );
        case 'dob':
            return (
                <div key={fieldId} className="space-y-1.5">
                    <Label htmlFor="dob" style={textStyle}>Date of Birth {requiredFields.dob !== false && (requiredFields.dob === 'optional' ? '(optional)' : '*')}</Label>
                    <div className="relative group">
                        <CalendarIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 group-focus-within:text-gray-800 transition-colors" />
                        <Input
                            id="dob"
                            type="tel"
                            inputMode="numeric"
                            placeholder="DD/MM/YYYY"
                            className={`pl-10 h-11 text-base bg-gray-50/50 border-gray-200 focus:bg-white focus:border-gray-300 focus:ring-2 focus:ring-offset-0 transition-all rounded-xl ${(dobIncomplete || ageError) ? 'border-red-300 ring-2 ring-red-100' : ''}`}
                            style={!(dobIncomplete || ageError) ? { '--tw-ring-color': themeColor + '33' } : {}}
                            value={formData.date_of_birth}
                            onChange={(e) => handleFormChange('date_of_birth', e.target.value)}
                            onBlur={handleDobBlur}
                            maxLength={10}
                        />
                    </div>
                    <AnimatePresence>
                        {(ageError || dobIncomplete) && (
                            <motion.div
                                className="flex items-center gap-1.5 text-xs text-red-600 font-medium ml-1"
                                initial={{ opacity: 0, y: -5 }}
                                animate={{ opacity: 1, y: 0 }}
                            >
                                <AlertCircle className="w-3.5 h-3.5" />
                                <span style={textStyle}>{ageError || 'Please enter full year (DDMMYYYY)'}</span>
                            </motion.div>
                        )}
                    </AnimatePresence>
                    {(!ageError && !dobIncomplete && renderAgeRestrictionHint()) && (
                        <div className="text-[11px] text-gray-400 pt-0.5 ml-1" style={textStyle}>
                            {renderAgeRestrictionHint()}
                        </div>
                    )}
                </div>
            );
        case 'postal_code':
            return (
                <div key={fieldId} className="space-y-1.5">
                    <Label htmlFor="postal_code" style={textStyle}>Postal Code {requiredFields.postal_code !== false && (requiredFields.postal_code === 'optional' ? '(optional)' : '*')}</Label>
                    <div className="relative group">
                        <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 group-focus-within:text-gray-800 transition-colors" />
                        <Input
                            id="postal"
                            placeholder="520230"
                            className="pl-10 h-11 text-base bg-gray-50/50 border-gray-200 focus:bg-white focus:border-gray-300 focus:ring-2 focus:ring-offset-0 transition-all rounded-xl"
                            style={{ '--tw-ring-color': themeColor + '33' }}
                            maxLength={6}
                            value={formData.postal_code}
                            onChange={(e) => handleFormChange('postal_code', e.target.value.replace(/\D/g, '').slice(0, 6))}
                        />
                    </div>
                </div>
            );
        case 'education_level':
            return (
                <div key={fieldId} className="space-y-1.5">
                    <Label htmlFor="education_level" style={textStyle}>Highest Education {requiredFields.education_level !== false && (requiredFields.education_level === 'optional' ? '(optional)' : '*')}</Label>
                    <Select
                        value={formData.education_level}
                        onValueChange={(value) => handleFormChange('education_level', value)}
                    >
                        <SelectTrigger className="h-11 text-base bg-gray-50/50 border-gray-200 focus:ring-2 focus:ring-offset-0 rounded-xl" style={{ '--tw-ring-color': themeColor + '33' }}>
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
                <div key={fieldId} className="space-y-1.5">
                    <Label htmlFor="monthly_income" style={textStyle}>Last Drawn Salary {requiredFields.monthly_income !== false && (requiredFields.monthly_income === 'optional' ? '(optional)' : '*')}</Label>
                    <Select
                        value={formData.monthly_income}
                        onValueChange={(value) => handleFormChange('monthly_income', value)}
                    >
                        <SelectTrigger className="h-11 text-base bg-gray-50/50 border-gray-200 focus:ring-2 focus:ring-offset-0 rounded-xl" style={{ '--tw-ring-color': themeColor + '33' }}>
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
}
