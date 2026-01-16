import { useState, useEffect } from 'react';
import { auth, apiClient } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { toast } from '@/components/ui/use-toast';
import { Loader2, Mail, Phone, Calendar, User, ShieldCheck, CheckCircle2, AlertCircle, X, Lock } from 'lucide-react';
import { sendOtp, verifyOtp } from '@/components/lib/customFunctions';
import { motion } from 'framer-motion';

export default function AgentProfile() {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    // Profile Form State
    const [formData, setFormData] = useState({
        firstName: '',
        lastName: '',
        email: '',
        phone: '', // 8-digit local
        dateOfBirth: ''
    });
    const [originalPhone, setOriginalPhone] = useState('');
    const [submittingProfile, setSubmittingProfile] = useState(false);

    // OTP State
    const [otp, setOtp] = useState('');
    const [otpState, setOtpState] = useState('idle'); // 'idle' | 'pending' | 'verified'
    const [otpLoading, setOtpLoading] = useState(false); // boolean
    const [resendCooldown, setResendCooldown] = useState(0);
    const [otpError, setOtpError] = useState('');

    // Password Form State
    const [passwordData, setPasswordData] = useState({
        currentPassword: '',
        newPassword: '',
        confirmPassword: ''
    });
    const [submittingPassword, setSubmittingPassword] = useState(false);

    useEffect(() => {
        loadUser();
    }, []);

    useEffect(() => {
        let timer;
        if (resendCooldown > 0) {
            timer = setTimeout(() => setResendCooldown((v) => v - 1), 1000);
        }
        return () => clearTimeout(timer);
    }, [resendCooldown]);

    const loadUser = async () => {
        try {
            const currentUser = await auth.getCurrentUser();
            setUser(currentUser);

            const rawPhone = (currentUser.phone || '').replace(/\D/g, '');
            const localPhone = rawPhone.startsWith('65') ? rawPhone.slice(2, 10) : rawPhone.slice(0, 8);

            setFormData({
                firstName: currentUser.firstName || '',
                lastName: currentUser.lastName || '',
                email: currentUser.email || '',
                phone: localPhone,
                dateOfBirth: currentUser.dateOfBirth || ''
            });
            setOriginalPhone(localPhone);
        } catch (error) {
            toast({
                variant: "destructive",
                title: "Error loading profile",
                description: error.message
            });
        } finally {
            setLoading(false);
        }
    };

    const handleProfileChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handlePhoneChange = (e) => {
        let val = e.target.value.replace(/\D/g, '');
        if (val.startsWith('65') && val.length > 8) val = val.slice(2);
        val = val.slice(0, 8);
        setFormData(prev => ({ ...prev, phone: val }));

        // Reset OTP if phone changes back to original or to a new number
        if (otpState === 'verified' && val !== originalPhone) {
            setOtpState('idle'); // Require re-verification if they change it again after verifying
        } else if (val === originalPhone) {
            setOtpState('idle'); // Back to original, no validation needed
            setOtpError('');
        }
    };

    const handleSendOtp = async () => {
        if (formData.phone.length !== 8) {
            setOtpError('Please enter a valid 8-digit Singapore number.');
            return;
        }
        setOtpLoading(true);
        setOtpError('');
        try {
            const fullPhone = `+65${formData.phone}`;
            const resp = await sendOtp(fullPhone);
            if (resp.success || resp.data?.success) {
                setOtpState('pending');
                setResendCooldown(30);
                toast({ title: "OTP Sent", description: `Code sent to ${fullPhone}` });
            } else {
                setOtpError(resp.message || 'Failed to send OTP.');
            }
        } catch (e) {
            setOtpError(e.message);
        } finally {
            setOtpLoading(false);
        }
    };

    const handleVerifyOtp = async () => {
        if (otp.length < 6) return;
        setOtpLoading(true);
        setOtpError('');
        try {
            const fullPhone = `+65${formData.phone}`;
            const resp = await verifyOtp(fullPhone, otp);
            if (resp.success || resp.data?.success) {
                setOtpState('verified');
                toast({ title: "Phone Verified", description: "You can now save your profile." });
                setOtp('');
            } else {
                setOtpError(resp.message || 'Invalid OTP.');
            }
        } catch (e) {
            setOtpError(e.message);
        } finally {
            setOtpLoading(false);
        }
    };

    const handleUpdateProfile = async (e) => {
        e.preventDefault();
        setSubmittingProfile(true);

        try {
            // Validation
            const phoneChanged = formData.phone !== originalPhone;
            if (phoneChanged && otpState !== 'verified') {
                setOtpError('Please verify your new phone number first.');
                setSubmittingProfile(false);
                return;
            }

            const payload = {
                firstName: formData.firstName,
                lastName: formData.lastName,
                dateOfBirth: formData.dateOfBirth,
                // Only include email/phone if changed, though backend handles idempotency reasonably well.
                // Be careful with email if it's google linked (frontend should probably disable or warn).
                email: formData.email,
            };

            if (phoneChanged) {
                payload.phone = `65${formData.phone}`;
            }

            await apiClient.put('/auth/profile', payload);

            // Update local state
            const updatedUser = await auth.getCurrentUser(true); // force refresh
            setUser(updatedUser);
            setOriginalPhone(formData.phone);
            setOtpState('idle');

            toast({
                title: "Profile Updated",
                description: "Your personal information has been saved successfully.",
            });
        } catch (error) {
            console.error(error);
            toast({
                variant: "destructive",
                title: "Update Failed",
                description: error.message || "Could not update profile.",
            });
        } finally {
            setSubmittingProfile(false);
        }
    };

    const handleUpdatePassword = async (e) => {
        e.preventDefault();
        if (passwordData.newPassword !== passwordData.confirmPassword) {
            toast({
                variant: "destructive",
                title: "Passwords do not match",
                description: "Please ensure your new password and confirmation match."
            });
            return;
        }
        if (passwordData.newPassword.length < 6) {
            toast({
                variant: "destructive",
                title: "Password too short",
                description: "Password must be at least 6 characters."
            });
            return;
        }

        setSubmittingPassword(true);
        try {
            await apiClient.put('/auth/change-password', {
                currentPassword: passwordData.currentPassword,
                newPassword: passwordData.newPassword
            });

            setPasswordData({ currentPassword: '', newPassword: '', confirmPassword: '' });
            toast({
                title: "Password Changed",
                description: "Your password has been updated securely.",
            });
        } catch (error) {
            toast({
                variant: "destructive",
                title: "Password Update Failed",
                description: error.message || "Please check your current password.",
            });
        } finally {
            setSubmittingPassword(false);
        }
    };

    if (loading) {
        return (
            <div className="flex h-screen items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            </div>
        );
    }

    const phoneChanged = formData.phone !== originalPhone;
    const isGoogleUser = !!user?.googleSub;

    return (
        <div className="max-w-4xl mx-auto p-6 space-y-8 animate-in fade-in duration-500">
            <div className="space-y-2">
                <h1 className="text-3xl font-bold tracking-tight text-gray-900">Profile Settings</h1>
                <p className="text-gray-500">Manage your personal information and account security.</p>
            </div>

            <div className="grid gap-8">

                {/* Personal Details Card */}
                <Card className="border-gray-200 shadow-sm overflow-hidden">
                    <CardHeader className="bg-gray-50/50 border-b border-gray-100 pb-4">
                        <div className="flex items-center gap-2">
                            <div className="p-2 bg-blue-100 rounded-lg">
                                <User className="w-5 h-5 text-blue-600" />
                            </div>
                            <div>
                                <CardTitle className="text-lg">Personal Information</CardTitle>
                                <CardDescription>Update your contact details and public profile.</CardDescription>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="pt-6">
                        <form id="profile-form" onSubmit={handleUpdateProfile} className="space-y-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="space-y-2">
                                    <Label htmlFor="firstName">First Name</Label>
                                    <Input
                                        id="firstName"
                                        name="firstName"
                                        value={formData.firstName}
                                        onChange={handleProfileChange}
                                        placeholder="e.g. John"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="lastName">Last Name</Label>
                                    <Input
                                        id="lastName"
                                        name="lastName"
                                        value={formData.lastName}
                                        onChange={handleProfileChange}
                                        placeholder="e.g. Doe"
                                    />
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="email">Email Address</Label>
                                    <div className="relative">
                                        <Mail className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                                        <Input
                                            id="email"
                                            name="email"
                                            type="email"
                                            value={formData.email}
                                            onChange={handleProfileChange}
                                            className="pl-9 bg-gray-50 text-gray-500"
                                            disabled={isGoogleUser} // Lock email for Google users for simplicity/security
                                            title={isGoogleUser ? "Email linked to Google Account cannot be changed" : ""}
                                        />
                                    </div>
                                    {isGoogleUser && (
                                        <p className="text-[11px] text-gray-400 flex items-center gap-1 mt-1">
                                            <ShieldCheck className="w-3 h-3" />
                                            Linked to Google Account
                                        </p>
                                    )}
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="dateOfBirth">Date of Birth</Label>
                                    <div className="relative">
                                        <Calendar className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                                        <Input
                                            id="dateOfBirth"
                                            name="dateOfBirth"
                                            type="date"
                                            value={formData.dateOfBirth}
                                            onChange={handleProfileChange}
                                            className="pl-9"
                                        />
                                    </div>
                                </div>

                                <div className="space-y-2 md:col-span-2">
                                    <Label htmlFor="phone">Phone Number</Label>
                                    <div className="flex gap-3 items-start">
                                        <div className="relative flex-1">
                                            <div className="absolute left-3 top-2.5 flex items-center gap-2">
                                                <span className="text-gray-500 text-sm font-medium">🇸🇬 +65</span>
                                            </div>
                                            <Input
                                                id="phone"
                                                name="phone"
                                                type="tel"
                                                value={formData.phone}
                                                onChange={handlePhoneChange}
                                                className={`pl-20 ${phoneChanged && otpState !== 'verified' ? 'border-amber-300 focus-visible:ring-amber-200' : ''}`}
                                                maxLength={8}
                                                disabled={otpState === 'pending' || otpState === 'verified'}
                                            />
                                            {/* Status Indicator */}
                                            <div className="absolute right-3 top-2.5">
                                                {!phoneChanged && (
                                                    <div className="flex items-center gap-1.5 text-green-600 text-xs font-medium bg-green-50 px-2 py-0.5 rounded-full">
                                                        <CheckCircle2 className="w-3 h-3" /> Verified
                                                    </div>
                                                )}
                                                {phoneChanged && otpState === 'verified' && (
                                                    <div className="flex items-center gap-1.5 text-green-600 text-xs font-medium bg-green-50 px-2 py-0.5 rounded-full">
                                                        <CheckCircle2 className="w-3 h-3" /> Verified
                                                    </div>
                                                )}
                                                {phoneChanged && otpState === 'idle' && (
                                                    <div className="flex items-center gap-1.5 text-amber-600 text-xs font-medium bg-amber-50 px-2 py-0.5 rounded-full">
                                                        Using New Number
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        {/* Verify Button */}
                                        {phoneChanged && otpState === 'idle' && (
                                            <Button
                                                type="button"
                                                onClick={handleSendOtp}
                                                disabled={otpLoading || formData.phone.length !== 8}
                                                className="bg-slate-900 text-white hover:bg-slate-800"
                                            >
                                                {otpLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Verify'}
                                            </Button>
                                        )}
                                        {/* Cancel / Reset Button during pending */}
                                        {otpState === 'pending' && (
                                            <Button
                                                type="button"
                                                variant="outline"
                                                onClick={() => { setOtpState('idle'); setOtp(''); setOtpError(''); }}
                                            >
                                                Cancel
                                            </Button>
                                        )}
                                        {/* Verified State - Reset Button */}
                                        {phoneChanged && otpState === 'verified' && (
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => { setOtpState('idle'); setFormData(p => ({ ...p, phone: originalPhone })); }}
                                                title="Undo changes"
                                            >
                                                <X className="w-4 h-4 text-gray-500" />
                                            </Button>
                                        )}
                                    </div>

                                    {/* OTP Input Area */}
                                    {otpState === 'pending' && (
                                        <motion.div
                                            initial={{ opacity: 0, height: 0 }}
                                            animate={{ opacity: 1, height: 'auto' }}
                                            className="mt-3 p-4 bg-slate-50 rounded-lg border border-slate-200"
                                        >
                                            <label className="text-sm font-medium text-slate-700 block mb-2">Enter Verification Code</label>
                                            <div className="flex gap-2">
                                                <Input
                                                    className="max-w-[140px] tracking-widest text-center font-mono text-lg"
                                                    placeholder="000000"
                                                    maxLength={6}
                                                    value={otp}
                                                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                                                />
                                                <Button
                                                    type="button"
                                                    onClick={handleVerifyOtp}
                                                    disabled={otp.length < 6 || otpLoading}
                                                    className="min-w-[100px]"
                                                >
                                                    {otpLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Confirm'}
                                                </Button>
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    disabled={resendCooldown > 0}
                                                    onClick={handleSendOtp}
                                                    className="text-xs text-slate-500 hover:text-slate-800"
                                                >
                                                    {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend Code'}
                                                </Button>
                                            </div>
                                            <p className="text-xs text-slate-500 mt-2">
                                                We sent a 6-digit code to +65 {formData.phone}.
                                            </p>
                                        </motion.div>
                                    )}

                                    {otpError && (
                                        <div className="flex items-center gap-2 text-sm text-red-600 mt-2 bg-red-50 p-2 rounded">
                                            <AlertCircle className="w-4 h-4" />
                                            {otpError}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </form>
                    </CardContent>
                    <CardFooter className="bg-gray-50/50 border-t border-gray-100 flex justify-end py-4">
                        <Button type="submit" form="profile-form" disabled={submittingProfile || (phoneChanged && otpState !== 'verified')}>
                            {submittingProfile ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                            Save Changes
                        </Button>
                    </CardFooter>
                </Card>

                {/* Security Card */}
                <Card className="border-gray-200 shadow-sm overflow-hidden">
                    <CardHeader className="bg-gray-50/50 border-b border-gray-100 pb-4">
                        <div className="flex items-center gap-2">
                            <div className="p-2 bg-amber-100 rounded-lg">
                                <Lock className="w-5 h-5 text-amber-600" />
                            </div>
                            <div>
                                <CardTitle className="text-lg">Security & Password</CardTitle>
                                <CardDescription>Ensure your account is protected with a strong password.</CardDescription>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="pt-6">
                        <form id="password-form" onSubmit={handleUpdatePassword} className="space-y-4 max-w-md">
                            <div className="space-y-2">
                                <Label htmlFor="currentPassword">Current Password</Label>
                                <Input
                                    type="password"
                                    id="currentPassword"
                                    value={passwordData.currentPassword}
                                    onChange={(e) => setPasswordData(p => ({ ...p, currentPassword: e.target.value }))}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="newPassword">New Password</Label>
                                <Input
                                    type="password"
                                    id="newPassword"
                                    value={passwordData.newPassword}
                                    onChange={(e) => setPasswordData(p => ({ ...p, newPassword: e.target.value }))}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="confirmPassword">Confirm New Password</Label>
                                <Input
                                    type="password"
                                    id="confirmPassword"
                                    value={passwordData.confirmPassword}
                                    onChange={(e) => setPasswordData(p => ({ ...p, confirmPassword: e.target.value }))}
                                />
                            </div>
                        </form>
                    </CardContent>
                    <CardFooter className="bg-gray-50/50 border-t border-gray-100 flex justify-end py-4">
                        <Button variant="outline" type="submit" form="password-form" disabled={submittingPassword}>
                            {submittingPassword ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                            Update Password
                        </Button>
                    </CardFooter>
                </Card>

            </div>
        </div>
    );
}
