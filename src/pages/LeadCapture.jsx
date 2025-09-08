
import { useState, useEffect } from "react";
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
    if (!design) return 'bg-gray-50';
    switch (design.backgroundStyle) {
        case 'gradient':
            return 'bg-gradient-to-br from-gray-50 to-white';
        case 'solid':
            return 'bg-gray-50';
        case 'pattern':
            return 'bg-gray-100 bg-opacity-75';
        default:
            return 'bg-gray-50';
    }
};

const getSpacingClass = (design) => {
    if (!design) return 'py-12 px-6';
    switch (design.spacing) {
        case 'tight': return 'py-6 px-4';
        case 'normal': return 'py-8 px-6';
        case 'relaxed': return 'py-12 px-8';
        default: return 'py-8 px-6';
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
                    // Fallback for legacy preview links
                    fetchedCampaign = await Campaign.get(params.get('campaign_id'));
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

    const handleSubmit = async (formData) => {
        try {
            // Map form fields to backend schema
            const name = (formData.name || '').trim();
            const [firstName, ...rest] = name.split(/\s+/);
            const lastName = rest.join(' ') || '-';

            const payload = {
                firstName,
                lastName,
                email: formData.email,
                phone: formData.phone, // already like 65XXXXXXXX from child form
                leadSource: qrTag?.id ? 'qr_code' : 'website',
                campaignId: campaign?.id || null,
                qrTagId: qrTag?.id || null
            };

            const result = await apiClient.post('/prospects', payload);
            if (result?.success) {
                setSubmitted(true);
                setShareOpen(true);
            } else {
                setError(result?.message || 'Submission failed. Please try again.');
            }
        } catch (err) {
            setError(err?.message || 'An error occurred. Please try again later.');
        }
    };

    // Remove initial loading animation; render immediately with conditional content

    const design = campaign?.design_config || {};

    return (
        <div className={`min-h-screen ${getBackgroundClass(design)}`}>
            <div className={`flex items-center justify-center ${getSpacingClass(design)}`}>
                <div className="w-full" style={{ maxWidth: `${design.formWidth || 400}px` }}>
                    {design?.imageUrl && (
                        <div className="w-full h-56 lg:h-72 mb-6">
                            <img 
                                src={resolveImageUrl(design.imageUrl)} 
                                alt="Campaign Header" 
                                className="w-full h-full object-contain rounded-md" 
                            />
                        </div>
                    )}
                    {submitted ? (
                        <div className="bg-white p-8 rounded-lg shadow-xl text-center border">
                            <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
                            <h2 className="text-2xl font-bold text-gray-900">Thank You!</h2>
                            <p className="text-gray-600 mt-2">Your submission has been received. We will be in touch shortly.</p>
                        </div>
                    ) : error ? (
                        <div className="bg-white p-8 rounded-lg shadow-xl text-center border">
                            <AlertTriangle className="w-16 h-16 text-red-500 mx-auto mb-4" />
                            <h2 className="text-2xl font-bold text-gray-900">An Error Occurred</h2>
                            <p className="text-gray-600 mt-2">{error}</p>
                            <Link to={createPageUrl("Dashboard")}>
                                <Button variant="outline" className="mt-6">
                                    <ArrowLeft className="w-4 h-4 mr-2" />
                                    Go Back
                                </Button>
                            </Link>
                        </div>
                    ) : campaign ? (
                        <CampaignSignupForm
                            themeColor={design.themeColor || '#3B82F6'}
                            formHeadline={design.formHeadline || 'Sign Up Now'}
                            formSubheadline={design.formSubheadline || 'Fill out the form to get started.'}
                            headlineSize={design.headlineSize || 20}
                            campaignId={campaign.id}
                            campaign={campaign}
                            onSubmit={handleSubmit}
                        />
                    ) : null}
                    <Dialog open={shareOpen} onOpenChange={(v) => { setShareOpen(v); if (!v) setCopied(false); }}>
                        <DialogContent className="sm:max-w-md">
                            <DialogHeader>
                                <DialogTitle className="text-lg">Share this campaign</DialogTitle>
                                <DialogDescription>Invite friends and family to participate.</DialogDescription>
                            </DialogHeader>
                            <div className="space-y-4">
                                <div className="p-3 bg-gray-50 rounded-lg border flex items-center justify-between gap-2">
                                    <div className="text-[11px] sm:text-sm break-all text-gray-800 leading-snug">
                                        {(() => {
                                            const baseUrl = window.location.origin;
                                            const url = campaign ? `${baseUrl}${createPageUrl('LeadCapture?campaign_id=' + campaign.id)}` : window.location.href;
                                            return url;
                                        })()}
                                    </div>
                                    <Button
                                        variant={copied ? 'default' : 'outline'}
                                        className={`shrink-0 transition-all ${copied ? 'bg-green-500 hover:bg-green-600 text-white scale-105' : 'hover:scale-105'}`}
                                        onClick={async () => {
                                            const baseUrl = window.location.origin;
                                            const url = campaign ? `${baseUrl}${createPageUrl('LeadCapture?campaign_id=' + campaign.id)}` : window.location.href;
                                            try {
                                                await navigator.clipboard.writeText(url);
                                                setCopied(true);
                                                setTimeout(() => setCopied(false), 1500);
                                            } catch (_) {}
                                        }}
                                    >
                                        {copied ? 'Copied!' : 'Copy link'}
                                    </Button>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                    <Button
                                        onClick={() => {
                                            const baseUrl = window.location.origin;
                                            const url = campaign ? `${baseUrl}${createPageUrl('LeadCapture?campaign_id=' + campaign.id)}` : window.location.href;
                                            const text = `Check this out: ${url}`;
                                            window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
                                        }}
                                        className="bg-green-600 hover:bg-green-700 text-white flex items-center gap-2"
                                    >
                                        <img src="https://cdn.jsdelivr.net/npm/simple-icons@v9/icons/whatsapp.svg" alt="WhatsApp" className="w-4 h-4 invert" />
                                        WhatsApp
                                    </Button>
                                    <Button
                                        onClick={() => {
                                            const baseUrl = window.location.origin;
                                            const url = campaign ? `${baseUrl}${createPageUrl('LeadCapture?campaign_id=' + campaign.id)}` : window.location.href;
                                            const text = `Check this out: ${url}`;
                                            window.open(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`, '_blank');
                                        }}
                                        className="bg-blue-500 hover:bg-blue-600 text-white flex items-center gap-2"
                                    >
                                        <img src="https://cdn.jsdelivr.net/npm/simple-icons@v9/icons/telegram.svg" alt="Telegram" className="w-4 h-4 invert" />
                                        Telegram
                                    </Button>
                                </div>
                            </div>
                            <DialogFooter className="mt-2">
                                <Button variant="secondary" onClick={() => setShareOpen(false)}>Close</Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                </div>
            </div>
        </div>
    );
}
