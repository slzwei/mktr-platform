import { useEffect, useState, useMemo, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { apiClient } from '@/api/client';
import CampaignSignupForm from '@/components/campaigns/CampaignSignupForm';
import { QuizGate } from '@/components/campaigns/CampaignQuiz';
import TypingLoader from '@/components/ui/TypingLoader';
import AlertTriangle from 'lucide-react/icons/alert-triangle';
import ShareCampaignDialog from '@/components/campaigns/ShareCampaignDialog';
import LeadCaptureLayout from '@/components/campaigns/LeadCaptureLayout';
import { deriveLeadCaptureContent } from '@/components/campaigns/leadCaptureContent';
import GuidedReviewPage from '@/components/campaigns/guided-review/GuidedReviewPage';

export default function PublicPreview() {
 const { slug } = useParams();
 const formRef = useRef(null);
 const [snapshot, setSnapshot] = useState(null);
 const [loading, setLoading] = useState(true);
 const [error, setError] = useState(null);
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

 // Same derived slots as the live /LeadCapture page so /p/:slug matches it.
 const content = useMemo(
 () => deriveLeadCaptureContent({ name: snapshot?.name, design_config: design }),
 [snapshot, design]
 );

 const primaryCta = content.primaryCtaData
 ? {
 label: content.primaryCtaData.label,
 color: content.primaryCtaData.color,
 onClick: () => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
 }
 : null;

 const longShareUrl = useMemo(() => window.location.href, []);

 // Ensure preview pages are not indexed
 useEffect(() => {
 const meta = document.querySelector('meta[name="robots"]') || document.createElement('meta');
 meta.setAttribute('name', 'robots');
 meta.setAttribute('content', 'noindex,nofollow');
 if (!meta.parentElement) document.head.appendChild(meta);
 }, []);

 // /p/:slug is an admin preview, not a live capture surface. The form runs in
 // previewMode and short-circuits before this handler, so it never creates a
 // real prospect. Kept as a defensive no-op guard.
 const handleSubmit = async () => {
 /* no-op: preview must not create prospects */
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

 const previewForm = (
 <div ref={formRef}>
 <QuizGate quiz={design.quiz} themeColor={design.themeColor || '#3B82F6'} previewMode>
 <CampaignSignupForm
 previewMode
 themeColor={design.themeColor || '#3B82F6'}
 formHeadline={design.formHeadline || 'Sign Up Now'}
 formSubheadline={design.formSubheadline}
 campaignId={snapshot?.id}
 onSubmit={handleSubmit}
 campaign={{ ...snapshot, design_config: design, min_age: snapshot?.min_age, max_age: snapshot?.max_age }}
 termsContent={design.termsContent}
 ctaLabel={design.ctaText || 'Submit Now'}
 />
 </QuizGate>
 </div>
 );

 const shareDialog = (
 <ShareCampaignDialog
 open={shareOpen}
 onOpenChange={setShareOpen}
 campaignName={snapshot?.name}
 campaignId={snapshot?.id}
 longShareUrl={longShareUrl}
 />
 );

 if (snapshot?.type === 'guided_review') {
 return (
 <>
 <Title title={`Preview • ${snapshot?.name || 'Campaign'}`} />
 <GuidedReviewPage
 config={design.guidedReview}
 campaignName={snapshot?.name}
 onCta={() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
 >
 {previewForm}
 </GuidedReviewPage>
 {shareDialog}
 </>
 );
 }

 return (
 <LeadCaptureLayout
 design={design}
 maxWidth={design.formWidth}
 wordmark={content.wordmark}
 story={content.story}
 primaryCta={primaryCta}
 regulatoryFooter={content.regulatoryFooter}
 brand={content.brand}
 >
 <Title title={`Preview • ${snapshot?.name || 'Campaign'}`} />
 {previewForm}
 {shareDialog}
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
