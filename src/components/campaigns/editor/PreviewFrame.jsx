import { useMemo, useRef } from"react";
import { Eye } from"lucide-react";
import LeadCaptureLayout from"../LeadCaptureLayout";
import CampaignSignupForm from"../CampaignSignupForm";
import { QuizGate } from"../CampaignQuiz";
import { deriveLeadCaptureContent } from"../leadCaptureContent";
import { customerPublicUrl, resolveCustomerHost } from"@/lib/brand";

/**
 * Faithful, read-only campaign preview.
 *
 * Renders the SAME path as the live page (LeadCaptureLayout + CampaignSignupForm)
 * driven by the same deriveLeadCaptureContent helper — so what the operator sees
 * is what the customer gets. `previewMode` stubs all network calls: the inline
 * preview can never send an OTP or create a prospect.
 *
 * Note: this deliberately does NOT simulate a fixed phone-width device frame.
 * CSS @media queries key off the real browser viewport, so a fake phone frame
 * inside a desktop window would lie about responsive stacking. Instead the
 * preview renders the real centered card at the configured form width — matching
 * the live desktop render exactly. The <480px single-column behavior is covered
 * by the .lc-field-row rule and is verifiable on the live page / a narrow window.
 * (An iframe was rejected because the OTP + consent Radix dialogs portal to the
 * top-level document and would escape an iframe.)
 */
export default function PreviewFrame({ currentDesign, campaign }) {
 const formRef = useRef(null);

 // Compose a campaign-shaped object so the form reads the in-progress design
 // (visibleFields / fieldOrder / otpChannel) and the live age rules.
 const previewCampaign = useMemo(
 () => ({ ...campaign, design_config: currentDesign }),
 [campaign, currentDesign]
 );

 const content = useMemo(() => deriveLeadCaptureContent(previewCampaign), [previewCampaign]);

 const primaryCta = content.primaryCtaData
 ? {
 label: content.primaryCtaData.label,
 color: content.primaryCtaData.color,
 onClick: () => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
 }
 : null;

 // Cosmetic chrome host — show the real customer host the page is served from.
 const chromeUrl = customerPublicUrl(
 `/LeadCapture?campaign_id=${campaign?.id ?? ''}`,
 resolveCustomerHost(currentDesign.customerHost)
 ).replace(/^https?:\/\//, '');

 return (
 <div className="flex flex-col h-full">
 <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-card rounded-t-xl">
 <Eye className="w-4 h-4 text-muted-foreground"/>
 <span className="text-sm font-medium text-foreground">Live Preview</span>
 <span className="ml-auto text-xs text-muted-foreground">Read-only · OTP &amp; submit disabled</span>
 </div>

 <div className="border border-t-0 rounded-b-xl overflow-hidden bg-foreground/5 border-border flex-1 flex flex-col min-h-0">
 {/* Browser chrome */}
 <div className="bg-card border-b px-4 py-2 flex items-center gap-2 shrink-0">
 <div className="flex gap-1.5">
 <div className="w-2.5 h-2.5 rounded-full bg-destructive"/>
 <div className="w-2.5 h-2.5 rounded-full bg-warning"/>
 <div className="w-2.5 h-2.5 rounded-full bg-success"/>
 </div>
 <div className="flex-1 bg-muted rounded text-[10px] text-muted-foreground text-center py-1 mx-4 truncate px-2">
 {chromeUrl}
 </div>
 </div>

 {/* Light-mode isolated viewport — render the REAL page. Fills the
 remaining height and scrolls; no fixed height, so the footer is
 never clipped by the parent container. */}
 <div className="light av2-theme-reset flex-1 min-h-0 overflow-y-auto" data-theme="light">
 <LeadCaptureLayout
 design={currentDesign}
 maxWidth={currentDesign.formWidth}
 rootMinHeight="100%"
 wordmark={content.wordmark}
 story={content.story}
 primaryCta={primaryCta}
 regulatoryFooter={content.regulatoryFooter}
 brand={content.brand}
 >
 <div ref={formRef}>
 <QuizGate quiz={currentDesign.quiz} themeColor={currentDesign.themeColor} previewMode>
 <CampaignSignupForm
 previewMode
 themeColor={currentDesign.themeColor}
 formHeadline={currentDesign.formHeadline || 'Get Started'}
 formSubheadline={currentDesign.formSubheadline}
 campaignId={campaign?.id}
 campaign={previewCampaign}
 termsContent={currentDesign.termsContent}
 ctaLabel={currentDesign.ctaText || 'Submit Now'}
 onSubmit={() => {}}
 />
 </QuizGate>
 </div>
 </LeadCaptureLayout>
 </div>
 </div>
 </div>
 );
}
