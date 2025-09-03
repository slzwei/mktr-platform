
import React, { useState, useEffect } from "react";
import { useLocation, Link } from "react-router-dom";
import { Campaign } from "@/api/entities";
import { QrTag } from "@/api/entities";
import { assignLead } from "@/api/functions";
import { incrementScanCount } from "@/api/functions";
import CampaignSignupForm from "../components/campaigns/CampaignSignupForm";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CheckCircle, ArrowLeft } from "lucide-react";
import { createPageUrl } from "@/utils";
import TypingLoader from "../components/ui/TypingLoader";

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
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [submitted, setSubmitted] = useState(false);

    useEffect(() => {
        const params = new URLSearchParams(location.search);
        const campaignId = params.get('campaign_id');
        const qrTagCode = params.get('qr_tag_id');

        const fetchAndDelay = async () => {
            setLoading(true);
            try {
                // If a QR code is scanned, increment its count immediately.
                if (qrTagCode) {
                    // Fire-and-forget: we don't need to wait for this to finish.
                    incrementScanCount({ qrTagCode }).catch(err => {
                        console.error("Non-blocking error: Failed to increment scan count:", err);
                    });
                }

                let fetchedCampaign;
                let fetchedQrTag = null;

                if (qrTagCode) {
                    const qrTags = await QrTag.filter({ code: qrTagCode });
                    if (qrTags.length === 0) {
                        setError("This link could not be found.");
                        return;
                    }
                    fetchedQrTag = qrTags[0];

                    if (!fetchedQrTag.is_active) {
                        setError("This QR code is no longer active.");
                        return;
                    }

                    fetchedCampaign = await Campaign.get(fetchedQrTag.campaign_id);
                    setQrTag(fetchedQrTag);

                } else if (campaignId) {
                    fetchedCampaign = await Campaign.get(campaignId);
                } else {
                    setError("No campaign or QR code specified.");
                    return;
                }
                
                if (!fetchedCampaign || !fetchedCampaign.is_active) {
                    setError("This campaign is no longer active.");
                    return;
                }
                
                setCampaign(fetchedCampaign);

            } catch (err) {
                console.error("Error loading capture page:", err);
                setError("An error occurred while loading the page.");
            } finally {
                // Short delay to make loading feel smoother
                setTimeout(() => setLoading(false), 1000); 
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

    if (loading) {
        return <TypingLoader />;
    }

    const design = campaign?.design || {};

    return (
        <div className={`min-h-screen ${getBackgroundClass(design)}`}>
            {campaign?.design?.imageUrl && (
                <div className="w-full h-56 lg:h-72">
                    <img 
                        src={campaign.design.imageUrl} 
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
