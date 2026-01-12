import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Prospect } from '@/api/entities';
import { auth } from '@/api/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Phone, MessageCircle, Mail, Calendar, MapPin } from 'lucide-react';

export default function ProspectDetailPage() {
    const { id } = useParams();
    const navigate = useNavigate();
    const [prospect, setProspect] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [agentName, setAgentName] = useState('');

    useEffect(() => {
        loadProspect();
        loadAgentName();
    }, [id]);

    async function loadAgentName() {
        try {
            const user = await auth.getCurrentUser();
            setAgentName(user.firstName || 'Agent');
        } catch (err) {
            console.error('Failed to load agent name:', err);
        }
    }

    async function loadProspect() {
        try {
            setLoading(true);
            setError(null);

            const data = await Prospect.getById(id);
            setProspect(data);

            // Track view
            await trackView(id);
        } catch (err) {
            console.error('Failed to load prospect:', err);
            if (err.message?.includes('403') || err.message?.includes('404')) {
                setError('You do not have permission to view this prospect.');
            } else {
                setError('Failed to load prospect details. Please try again.');
            }
        } finally {
            setLoading(false);
        }
    }

    async function trackView(prospectId) {
        try {
            await Prospect.trackView(prospectId);
        } catch (err) {
            // Silent fail - don't block page load if tracking fails
            console.error('Failed to track view:', err);
        }
    }

    const handleWhatsApp = () => {
        if (!prospect?.phone) return;

        const campaignName = prospect.campaign?.name || 'our campaign';
        const message = encodeURIComponent(
            `Hi ${prospect.firstName}, this is ${agentName} from ${campaignName}. Thank you for your interest!`
        );

        // Singapore number format - add 65 if not present
        const phone = prospect.phone.startsWith('65') ? prospect.phone : `65${prospect.phone}`;
        window.open(`https://wa.me/${phone}?text=${message}`, '_blank');
    };

    const handleCall = () => {
        if (!prospect?.phone) return;

        // Singapore number format
        const phone = prospect.phone.startsWith('65') ? `+${prospect.phone}` : `+65${prospect.phone}`;
        window.location.href = `tel:${phone}`;
    };

    const formatDate = (dateString) => {
        if (!dateString) return 'N/A';
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        });
    };

    const formatTime = (dateString) => {
        if (!dateString) return 'N/A';
        const date = new Date(dateString);
        return date.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        });
    };

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto mb-4"></div>
                    <p className="text-gray-600">Loading prospect details...</p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
                <Card className="max-w-md w-full">
                    <CardContent className="pt-6">
                        <div className="text-center">
                            <div className="text-red-500 text-5xl mb-4">⚠️</div>
                            <h2 className="text-xl font-semibold text-gray-900 mb-2">Access Denied</h2>
                            <p className="text-gray-600 mb-6">{error}</p>
                            <Button onClick={() => navigate('/MyProspects')} className="w-full">
                                <ArrowLeft className="mr-2 h-4 w-4" />
                                Back to My Prospects
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            </div>
        );
    }

    if (!prospect) return null;

    return (
        <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 p-4 md:p-8">
            <div className="max-w-2xl mx-auto">
                {/* Header */}
                <div className="mb-6">
                    <Button
                        variant="ghost"
                        onClick={() => navigate('/MyProspects')}
                        className="mb-4 text-gray-700 hover:text-gray-900"
                    >
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        Back to My Prospects
                    </Button>

                    <div className="bg-white/80 backdrop-blur-sm rounded-lg p-6 shadow-lg border border-white/20">
                        <div className="flex items-start justify-between mb-2">
                            <h1 className="text-3xl font-bold text-gray-900">
                                {prospect.firstName} {prospect.lastName}
                            </h1>
                            <Badge variant="secondary" className="ml-2">
                                {prospect.leadStatus || 'New'}
                            </Badge>
                        </div>
                        {prospect.campaign && (
                            <Badge className="bg-indigo-100 text-indigo-800 hover:bg-indigo-200">
                                📢 {prospect.campaign.name}
                            </Badge>
                        )}
                    </div>
                </div>

                {/* Contact Info Card */}
                <Card className="mb-6 shadow-xl border-white/20 bg-white/90 backdrop-blur-sm">
                    <CardHeader>
                        <CardTitle className="text-xl">Contact Information</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex items-center">
                            <Phone className="h-5 w-5 text-indigo-600 mr-3" />
                            <div>
                                <p className="text-sm text-gray-500">Phone</p>
                                <p className="text-lg font-semibold text-gray-900">{prospect.phone || 'N/A'}</p>
                            </div>
                        </div>

                        <div className="flex items-center">
                            <Mail className="h-5 w-5 text-indigo-600 mr-3" />
                            <div>
                                <p className="text-sm text-gray-500">Email</p>
                                <p className="text-lg font-semibold text-gray-900">{prospect.email || 'N/A'}</p>
                            </div>
                        </div>

                        <div className="flex items-center">
                            <Calendar className="h-5 w-5 text-indigo-600 mr-3" />
                            <div>
                                <p className="text-sm text-gray-500">Signed Up</p>
                                <p className="text-lg font-semibold text-gray-900">
                                    {formatDate(prospect.createdAt)} at {formatTime(prospect.createdAt)}
                                </p>
                            </div>
                        </div>

                        {prospect.location?.postalCode && (
                            <div className="flex items-center">
                                <MapPin className="h-5 w-5 text-indigo-600 mr-3" />
                                <div>
                                    <p className="text-sm text-gray-500">Postal Code</p>
                                    <p className="text-lg font-semibold text-gray-900">{prospect.location.postalCode}</p>
                                </div>
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* Action Buttons */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                    <Button
                        onClick={handleWhatsApp}
                        disabled={!prospect.phone}
                        size="lg"
                        className="h-16 text-lg bg-green-600 hover:bg-green-700 text-white shadow-lg hover:shadow-xl transition-all"
                    >
                        <MessageCircle className="mr-2 h-5 w-5" />
                        WhatsApp Message
                    </Button>

                    <Button
                        onClick={handleCall}
                        disabled={!prospect.phone}
                        size="lg"
                        className="h-16 text-lg bg-blue-600 hover:bg-blue-700 text-white shadow-lg hover:shadow-xl transition-all"
                    >
                        <Phone className="mr-2 h-5 w-5" />
                        Call Now
                    </Button>
                </div>

                {/* Additional Info */}
                {prospect.notes && (
                    <Card className="shadow-xl border-white/20 bg-white/90 backdrop-blur-sm">
                        <CardHeader>
                            <CardTitle className="text-xl">Notes</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <p className="text-gray-700 whitespace-pre-wrap">{prospect.notes}</p>
                        </CardContent>
                    </Card>
                )}
            </div>
        </div>
    );
}
