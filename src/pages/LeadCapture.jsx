
import { useState, useEffect, useMemo } from "react";
import { useLocation, Link } from "react-router-dom";
import { Campaign } from "@/api/entities";
import CampaignSignupForm from "../components/campaigns/CampaignSignupForm";
import { Button } from "@/components/ui/button";
import ShareCampaignDialog from "../components/campaigns/ShareCampaignDialog";
import AlertTriangle from "lucide-react/icons/alert-triangle";
import CheckCircle from "lucide-react/icons/check-circle";
import ArrowLeft from "lucide-react/icons/arrow-left";
import TypingLoader from "../components/ui/TypingLoader";
import { apiClient } from "@/api/client";
import LeadCaptureLayout from "../components/campaigns/LeadCaptureLayout";

export default function LeadCapture() {
    const location = useLocation();
    const [campaign, setCampaign] = useState(null);
    const [qrTag, setQrTag] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [submitted, setSubmitted] = useState(false);
    const [shareOpen, setShareOpen] = useState(false);
    const [referralMarked, setReferralMarked] = useState(false);
    const [duplicateDetected, setDuplicateDetected] = useState(false);
    const [duplicateCountdown, setDuplicateCountdown] = useState(5);

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
        return campaign ? `${baseUrl}/LeadCapture?campaign_id=${campaign.id}&ref=1` : window.location.href;
    }, [campaign]);

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

    return (
        <LeadCaptureLayout design={design} maxWidth={design.formWidth} showTrustFooter>
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
                                <Link to={"/Dashboard"}>
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
                    alignment={design.alignment}
                    textColor={design.textColor}
                    termsContent={design.termsContent}
                />
            ) : (
                <div className="py-20 text-center">
                    <TypingLoader className="mx-auto" />
                    <p className="text-xs text-gray-400 mt-4 animate-pulse">Loading secure experience...</p>
                </div>
            )}

            <ShareCampaignDialog
                open={shareOpen}
                onOpenChange={setShareOpen}
                campaignName={campaign?.name}
                campaignId={campaign?.id}
                longShareUrl={longShareUrl}
            />
        </LeadCaptureLayout>
    );
}
