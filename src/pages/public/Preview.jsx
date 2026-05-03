import { useEffect, useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { apiClient } from '@/api/client';
import CampaignSignupForm from '@/components/campaigns/CampaignSignupForm';
import TypingLoader from '@/components/ui/TypingLoader';
import CheckCircle from 'lucide-react/icons/check-circle';
import AlertTriangle from 'lucide-react/icons/alert-triangle';
import ShareCampaignDialog from '@/components/campaigns/ShareCampaignDialog';
import LeadCaptureLayout from '@/components/campaigns/LeadCaptureLayout';

export default function PublicPreview() {
 const { slug } = useParams();
 const [snapshot, setSnapshot] = useState(null);
 const [loading, setLoading] = useState(true);
 const [error, setError] = useState(null);
 const [submitted, setSubmitted] = useState(false);
 const [shareOpen, setShareOpen] = useState(false);

 useEffect(() => {
 let mounted = true;
 (async () => {
 try {
 setLoading(true);
 const res = await apiClient.get(`/previews/slug/${slug}`);
 if (mounted) setSnapshot(res.data?.snapshot || null);
 } catch (e) {
 setError('Preview not found or expired.');
 } finally {
 if (mounted) setLoading(false);
 }
 })();
 return () => {
 mounted = false;
 };
 }, [slug]);

 const design = useMemo(() => snapshot?.design_config || {}, [snapshot]);

 const longShareUrl = useMemo(() => window.location.href, []);

 // Ensure preview pages are not indexed
 useEffect(() => {
 const meta = document.querySelector('meta[name="robots"]') || document.createElement('meta');
 meta.setAttribute('name', 'robots');
 meta.setAttribute('content', 'noindex,nofollow');
 if (!meta.parentElement) document.head.appendChild(meta);
 }, []);

 const handleSubmit = async (formData) => {
 try {
 const body = {
 firstName: (formData.name || '').split(' ').slice(0, -1).join(' ') || formData.name || '',
 lastName: (formData.name || '').split(' ').slice(-1).join(' ') || '',
 email: formData.email,
 phone: formData.phone,
 leadSource: 'website',
 campaignId: snapshot?.id,
 };
 const res = await apiClient.post('/prospects', body);
 if (res.success) {
 setSubmitted(true);
 setShareOpen(true);
 } else setError(res.message || 'Submission failed');
 } catch (e) {
 setError(e.message || 'Submission failed');
 }
 };

 if (loading) return <TypingLoader />;

 if (error) {
 return (
 <div className="min-h-screen flex items-center justify-center p-8">
 <div className="bg-card p-8 rounded-lg shadow-xl text-center border">
 <AlertTriangle className="w-16 h-16 text-destructive mx-auto mb-4"/>
 <h2 className="text-2xl font-bold text-foreground">An Error Occurred</h2>
 <p className="text-muted-foreground mt-2">{error}</p>
 </div>
 </div>
 );
 }

 return (
 <LeadCaptureLayout design={design} maxWidth={design.formWidth}>
 <Title title={`Preview • ${snapshot?.name || 'Campaign'}`} />
 {submitted ? (
 <div className="text-center py-8">
 <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-success/15 mb-4 animate-in zoom-in duration-300">
 <CheckCircle className="h-8 w-8 text-success"/>
 </div>
 <h2 className="text-2xl font-bold text-foreground mb-2">Thank You!</h2>
 <p className="text-muted-foreground">Your submission has been received.</p>
 </div>
 ) : (
 <CampaignSignupForm
 themeColor={design.themeColor || '#3B82F6'}
 formHeadline={design.formHeadline || 'Sign Up Now'}
 formSubheadline={design.formSubheadline || 'Fill out the form to get started.'}
 headlineSize={design.headlineSize || 20}
 campaignId={snapshot?.id}
 onSubmit={handleSubmit}
 campaign={{ ...snapshot, design_config: design, min_age: snapshot?.min_age, max_age: snapshot?.max_age }}
 alignment={design.alignment}
 textColor={design.textColor}
 termsContent={design.termsContent}
 />
 )}
 <ShareCampaignDialog
 open={shareOpen}
 onOpenChange={setShareOpen}
 campaignName={snapshot?.name}
 campaignId={snapshot?.id}
 longShareUrl={longShareUrl}
 />
 </LeadCaptureLayout>
 );
}

function Title({ title }) {
 useEffect(() => {
 const prev = document.title;
 document.title = title;
 return () => {
 document.title = prev;
 };
 }, [title]);
 return null;
}
