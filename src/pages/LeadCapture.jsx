
import { useState, useEffect } from "react";
import { useLocation, Link } from "react-router-dom";
import { Campaign } from "@/api/entities";
import { assignLead } from "@/api/functions";
import CampaignSignupForm from "../components/campaigns/CampaignSignupForm";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CheckCircle, ArrowLeft } from "lucide-react";
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
            const submitData = {
                prospectData: formData,
                campaignId: campaign.id,
                qrTagId: qrTag?.id || null
            };
            
            const result = await assignLead(submitData);
            if (result.data.success) {
                setSubmitted(true);
            } else {
                setError(result.data.message || 'Submission failed. Please try again.');
            }
        } catch (err) {
            setError("An error occurred. Please try again later.");
        }
    };

    // Remove initial loading animation; render immediately with conditional content

    const design = campaign?.design_config || {};

    return (
        <div className={`min-h-screen ${getBackgroundClass(design)}`}>
            {design?.imageUrl && (
                <div className="w-full h-56 lg:h-72">
                    <img 
                        src={resolveImageUrl(design.imageUrl)} 
                        alt="Campaign Header" 
                        className="w-full h-full object-cover" 
                    />
                </div>
            )}
            <div className={`flex items-center justify-center ${getSpacingClass(design)}`}>
                <div className="w-full" style={{ maxWidth: `${design.formWidth || 400}px` }}>
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
                            onSubmit={handleSubmit}
                        />
                    ) : null}
                </div>
            </div>
        </div>
    );
}
