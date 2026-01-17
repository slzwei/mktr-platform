
import { useState, useEffect, useMemo } from "react";
import { useLocation, Link } from "react-router-dom";
import { Campaign } from "@/api/entities";
import CampaignSignupForm from "../components/campaigns/CampaignSignupForm";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import AlertTriangle from "lucide-react/icons/alert-triangle";
import CheckCircle from "lucide-react/icons/check-circle";
import ArrowLeft from "lucide-react/icons/arrow-left";
import { createPageUrl } from "@/utils";
import TypingLoader from "../components/ui/TypingLoader";
import { apiClient } from "@/api/client";

const getBackgroundClass = (design) => {
    if (!design) return { className: 'bg-gray-50', style: {} };

    const type = design.backgroundType || 'preset'; // 'preset' | 'custom'

    if (type === 'custom') {
        return {
            className: '', // No specific class, rely on style
            style: { backgroundColor: design.backgroundColor || '#f9fafb' }
        };
    }

    // Backwards compatibility for existing designs
    const style = design.backgroundStyle || 'gradient';

    switch (style) {
        case 'gradient': // Modern default
            return { className: 'bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-blue-50 via-white to-gray-50', style: {} };
        case 'solid_slate': // Corporate
            return { className: 'bg-slate-50', style: {} };
        case 'simple_gray': // Simple
            return { className: 'bg-white', style: {} };
        case 'solid': // Legacy
            return { className: 'bg-gray-50', style: {} };
        case 'pattern': // Legacy
            return { className: 'bg-gray-50 bg-[url("https://www.transparenttextures.com/patterns/cubes.png")]', style: {} };
        default:
            return { className: 'bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-gray-50 via-gray-50 to-gray-100', style: {} };
    }
};

const getCardClass = (design) => {
    // If specific template is selected, enforce its card style
    // Otherwise default to modern rounded
    const template = design?.layoutTemplate || 'modern';

    switch (template) {
        case 'corporate':
            return 'bg-white shadow-md border border-gray-200 rounded-lg overflow-hidden';
        case 'simple':
            return 'bg-transparent border-none shadow-none rounded-none overflow-visible';
        case 'modern':
        default:
            return 'bg-white/80 backdrop-blur-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-white/50 rounded-3xl overflow-hidden';
    }
};

export default function LeadCapture() {
    const location = useLocation();
    const [campaign, setCampaign] = useState(null);
    const [qrTag, setQrTag] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [submitted, setSubmitted] = useState(false);
    const [shareOpen, setShareOpen] = useState(false);
    const [copied, setCopied] = useState(false);
    const [referralMarked, setReferralMarked] = useState(false);
    const [shortening, setShortening] = useState(false);
    const [shortShareUrl, setShortShareUrl] = useState("");
    const [duplicateDetected, setDuplicateDetected] = useState(false);
    const [duplicateCountdown, setDuplicateCountdown] = useState(5);

    const resolveImageUrl = (url) => {
        if (!url) return '';
        if (/^https?:\/\//i.test(url)) return url;
        const apiOrigin = apiClient.baseURL.replace(/\/?api\/?$/, '');
        return `${apiOrigin}${url.startsWith('/') ? url : '/' + url}`;
    };

    // Ensure legacy preview page isn't indexed (only when preview=true)
    useEffect(() => {
        const params = new URLSearchParams(location.search);
        const isPreview = params.get('preview');
        if (isPreview) {
            const meta = document.querySelector('meta[name="robots"]') || document.createElement('meta');
            meta.setAttribute('name', 'robots');
            meta.setAttribute('content', 'noindex,nofollow');
            if (!meta.parentElement) document.head.appendChild(meta);
        }
    }, [location.search]);

    // Fire landing event on mount
    useEffect(() => {
        (async () => {
            try {
                await apiClient.post('/analytics/events', {
                    type: 'landing',
                    meta: { path: '/lead-capture' }
                });
            } catch (e) {
                // ignore
            }
        })();
    }, []);

    useEffect(() => {
        const params = new URLSearchParams(location.search);
        const preview = params.get('preview');

        const fetchAndDelay = async () => {
            try {
                // Resolve current session attribution from backend
                const resp = await apiClient.get('/qrcodes/session');
                let fetchedCampaign = null;
                if (resp?.success && resp.data) {
                    // Prefer embedded campaign payload to avoid a second round-trip
                    if (resp.data.campaign) {
                        fetchedCampaign = resp.data.campaign;
                    } else if (resp.data.campaignId) {
                        fetchedCampaign = await Campaign.get(resp.data.campaignId);
                    }
                    setQrTag({ id: resp.data.qrTagId });
                } else if (params.get('campaign_id')) {
                    // Fallback: public minimal endpoint without auth (works for logged-out users)
                    const cid = params.get('campaign_id');
                    try {
                        const pub = await apiClient.get(`/previews/public/${cid}`);
                        if (pub?.success && pub.data?.campaign) {
                            fetchedCampaign = pub.data.campaign;
                        } else {
                            fetchedCampaign = await Campaign.get(cid);
                        }
                    } catch (_) {
                        fetchedCampaign = await Campaign.get(cid);
                    }
                } else {
                    setError('No campaign or QR code specified.');
                    return;
                }

                if (!preview) {
                    if (!fetchedCampaign || fetchedCampaign.is_active === false) {
                        setError('This campaign is no longer active.');
                        return;
                    }
                }

                setCampaign(fetchedCampaign);
            } catch (err) {
                console.error('Error loading capture page:', err);
                setError('An error occurred while loading the page.');
            }
        };

        fetchAndDelay();
    }, [location.search]);

    // If this is a referral share visit, increment referral count once per session
    useEffect(() => {
        (async () => {
            try {
                const params = new URLSearchParams(location.search);
                const ref = params.get('ref') || params.get('refshare');
                if (ref && campaign && !referralMarked) {
                    await apiClient.post('/analytics/referrals', { campaignId: campaign.id });
                    setReferralMarked(true);
                }
            } catch (_) {
                // ignore referral analytics failure
            }
        })();
    }, [location.search, campaign, referralMarked]);

    const handleSubmit = async (formData) => {
        try {
            const params = new URLSearchParams(location.search);
            const isReferral = !!(params.get('ref') || params.get('refshare'));
            // Map form fields to backend schema
            const name = (formData.name || '').trim();
            const [firstName, ...rest] = name.split(/\s+/);
            const lastName = rest.join(' ');

            // Build payload and omit null/undefined optional IDs to satisfy backend Joi schema
            const basePayload = {
                firstName,
                lastName,
                email: formData.email,
                phone: formData.phone, // already like 65XXXXXXXX from child form
                date_of_birth: formData.date_of_birth,
                postal_code: formData.postal_code,
                education_level: formData.education_level,
                monthly_income: formData.monthly_income,
                leadSource: isReferral ? 'referral' : (qrTag?.id ? 'qr_code' : 'website'),
                campaignId: campaign?.id,
                qrTagId: qrTag?.id
            };

            const payload = Object.fromEntries(
                Object.entries(basePayload).filter(([k, v]) => {
                    // Allow empty string for lastName to support single names
                    if (k === 'lastName' && v === '') return true;
                    return v !== null && v !== undefined && v !== '';
                })
            );

            const result = await apiClient.post('/prospects', payload, { skipAuth: true });
            if (result?.success) {
                setSubmitted(true);
                setShareOpen(true);
            } else {
                setError(result?.message || 'Submission failed. Please try again.');
            }
        } catch (err) {
            const msg = err?.message || '';
            // If duplicate phone for this campaign, show unsuccessful prompt and auto-open share dialog in 5s
            if (/already signed up for this campaign/i.test(msg)) {
                setDuplicateDetected(true);
                setDuplicateCountdown(5);
                setSubmitted(false);
                setShareOpen(false);
                setError('You have already signed up for this campaign. We\'ll open the share options in 5 seconds.');
                return;
            }
            setError(msg || 'An error occurred. Please try again later.');
        }
    };

    // Remove initial loading animation; render immediately with conditional content

    const design = campaign?.design_config || {};

    // Compute canonical long share URL (used as fallback)
    const longShareUrl = useMemo(() => {
        const baseUrl = window.location.origin;
        return campaign ? `${baseUrl}${createPageUrl('LeadCapture?campaign_id=' + campaign.id + '&ref=1')}` : window.location.href;
    }, [campaign]);

    // Attempt to shorten only when the dialog opens (via backend shortlinks)
    useEffect(() => {
        (async () => {
            if (shareOpen) {
                setShortening(true);
                try {
                    const resp = await apiClient.post('/shortlinks', { targetUrl: longShareUrl, campaignId: campaign?.id, purpose: 'share', ttlDays: 90 });
                    const url = resp?.data?.url;
                    const absolute = url?.startsWith('http') ? url : `${window.location.origin}${url}`;
                    setShortShareUrl(absolute || "");
                } catch (_) {
                    setShortShareUrl("");
                }
                setShortening(false);
            } else {
                setShortShareUrl("");
            }
        })();
    }, [shareOpen, longShareUrl]);

    // When duplicate signup detected, start countdown and then open share dialog
    useEffect(() => {
        if (!duplicateDetected) return;
        setDuplicateCountdown(5);
        const interval = setInterval(() => {
            setDuplicateCountdown((prev) => {
                if (prev <= 1) {
                    clearInterval(interval);
                    setShareOpen(true);
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);
        return () => clearInterval(interval);
    }, [duplicateDetected]);

    const background = getBackgroundClass(design);

    return (
        <div className={`min-h-screen py-8 px-4 sm:px-6 lg:px-8 flex flex-col justify-center items-center ${background.className}`} style={background.style}>

            <div className={`w-full max-w-md ${getCardClass(design)}`}>
                {design?.imageUrl && (
                    <div className="w-full relative h-48 sm:h-56 bg-gray-100 border-b border-gray-100/50">
                        <img
                            src={resolveImageUrl(design.imageUrl)}
                            alt="Campaign Header"
                            className="w-full h-full object-cover"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent pointer-events-none" />
                    </div>
                )}

                <div className="p-6 sm:p-8">
                    {submitted ? (
                        <div className="text-center py-8">
                            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100 mb-4 animate-in zoom-in duration-300">
                                <CheckCircle className="h-8 w-8 text-green-600" />
                            </div>
                            <h2 className="text-2xl font-bold text-gray-900 tracking-tight">Success!</h2>
                            <p className="text-gray-500 mt-2 mb-6">Your details have been received securely.</p>
                            <Button className="w-full" variant="outline" onClick={() => setShareOpen(true)}>
                                Share with Friends
                            </Button>
                        </div>
                    ) : error ? (
                        <div className="text-center py-6">
                            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-100 mb-4 animate-in zoom-in duration-300">
                                <AlertTriangle className="h-7 w-7 text-red-600" />
                            </div>
                            {duplicateDetected ? (
                                <>
                                    <h2 className="text-xl font-bold text-gray-900">Already Registered</h2>
                                    <p className="text-gray-500 mt-2 text-sm">{error}</p>
                                    <div className="mt-6">
                                        <p className="text-xs text-gray-400 mb-2">Redirecting in {duplicateCountdown}s...</p>
                                        <Button className="w-full" onClick={() => setShareOpen(true)}>Share Now</Button>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <h2 className="text-xl font-bold text-gray-900">Something went wrong</h2>
                                    <p className="text-gray-500 mt-2 text-sm max-w-xs mx-auto">{error}</p>
                                    <div className="mt-8">
                                        <Link to={createPageUrl("Dashboard")}>
                                            <Button variant="ghost" className="text-gray-600">
                                                <ArrowLeft className="w-4 h-4 mr-2" />
                                                Back to Safe Zone
                                            </Button>
                                        </Link>
                                    </div>
                                </>
                            )}
                        </div>
                    ) : campaign ? (
                        <CampaignSignupForm
                            themeColor={design.themeColor || '#111827'} // Default to a neutral dark/black if not set, for a premium feel
                            formHeadline={design.formHeadline || 'Get Started'}
                            formSubheadline={design.formSubheadline || 'Enter your details below to continue.'}
                            headlineSize={design.headlineSize || 24}
                            campaignId={campaign.id}
                            campaign={campaign}
                            onSubmit={handleSubmit}
                        />
                    ) : (
                        <div className="py-20 text-center">
                            <TypingLoader className="mx-auto" />
                            <p className="text-xs text-gray-400 mt-4 animate-pulse">Loading secure experience...</p>
                        </div>
                    )}
                </div>
            </div>

            {/* Trust Footer */}
            <div className="mt-8 text-center sm:mx-auto sm:w-full sm:max-w-md">
                <div className="flex items-center justify-center gap-4 opacity-60 grayscale transition-all hover:grayscale-0 hover:opacity-100">
                    <div className="flex items-center gap-1.5 text-[10px] text-gray-500 font-medium bg-white/50 backdrop-blur-sm px-2 py-1 rounded-full border border-gray-100">
                        <svg className="w-3 h-3 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                        </svg>
                        SSL Secure Connection
                    </div>
                </div>
                <p className="text-[10px] text-gray-400 mt-4">
                    &copy; {new Date().getFullYear()} MKTR Platform. All rights reserved. <br />
                    By submitting this form, you agree to our Terms of Service and Privacy Policy.
                </p>
            </div>

            <Dialog open={shareOpen} onOpenChange={(v) => { setShareOpen(v); if (!v) setCopied(false); }}>
                <DialogContent className="sm:max-w-md rounded-2xl overflow-hidden border-0 shadow-2xl">
                    <DialogHeader className="bg-gray-50 p-6 border-b border-gray-100">
                        <DialogTitle className="text-xl font-bold text-center">
                            {`Invite Others`}
                        </DialogTitle>
                        <DialogDescription className="text-center text-gray-500 mt-1.5">
                            Use the link below to share "{campaign?.name}" with friends.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="p-6 space-y-6">
                        <div className="bg-gray-50 rounded-xl p-4 border border-gray-200/60 flex items-center gap-3 shadow-inner">
                            <div className="flex-1 min-w-0">
                                <div className="text-sm font-medium text-gray-900 truncate">
                                    {shortening ? 'Creating link...' : (shortShareUrl || longShareUrl)}
                                </div>
                                <div className="text-[10px] text-gray-500 mt-0.5">Unique referral link</div>
                            </div>
                            <Button
                                size="sm"
                                variant={copied ? 'default' : 'secondary'}
                                className={`shrink-0 transition-all ${copied ? 'bg-green-600 hover:bg-green-700 text-white shadow-md' : 'shadow-sm text-gray-700 bg-white hover:bg-gray-50 border border-gray-200'}`}
                                onClick={async () => {
                                    const shareUrl = shortShareUrl || longShareUrl;
                                    try {
                                        await navigator.clipboard.writeText(shareUrl);
                                        setCopied(true);
                                        setTimeout(() => setCopied(false), 2000);
                                    } catch (_) { }
                                }}
                            >
                                {copied ? <CheckCircle className="w-3.5 h-3.5 mr-1" /> : null}
                                {copied ? 'Copied' : 'Copy'}
                            </Button>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <Button
                                onClick={() => {
                                    const url = shortShareUrl || longShareUrl;
                                    const text = campaign?.name ? `Join me in ${campaign.name}! ${url}` : `Check this out: ${url}`;
                                    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
                                }}
                                className="bg-[#25D366] hover:bg-[#20bd5a] text-white border-0 shadow-md transition-transform active:scale-95"
                            >
                                <img src="https://cdn.jsdelivr.net/npm/simple-icons@v9/icons/whatsapp.svg" alt="" className="w-4 h-4 invert mr-2" />
                                WhatsApp
                            </Button>
                            <Button
                                onClick={() => {
                                    const url = shortShareUrl || longShareUrl;
                                    const text = campaign?.name ? `Join me in ${campaign.name}!` : 'Check this out:';
                                    window.open(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`, '_blank');
                                }}
                                className="bg-[#229ED9] hover:bg-[#1f8dbf] text-white border-0 shadow-md transition-transform active:scale-95"
                            >
                                <img src="https://cdn.jsdelivr.net/npm/simple-icons@v9/icons/telegram.svg" alt="" className="w-4 h-4 invert mr-2" />
                                Telegram
                            </Button>
                        </div>
                    </div>
                    <DialogFooter className="p-4 bg-gray-50 border-t border-gray-100 flex justify-center sm:justify-center">
                        <Button variant="ghost" size="sm" onClick={() => setShareOpen(false)} className="text-gray-500 hover:text-gray-900">
                            Close
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
