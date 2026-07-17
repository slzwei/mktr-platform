import { useState, useEffect, useMemo, useCallback } from"react";
import { Button } from"@/components/ui/button";
import {
 Loader2,
 Type,
 Palette,
 LayoutTemplate,
 ListChecks,
 PanelLeftClose,
 PanelLeft,
 Store
} from"lucide-react";

import ContentPanel from"./editor/ContentPanel";
import DesignPanel from"./editor/DesignPanel";
import LayoutPanel from"./editor/LayoutPanel";
import QuizPanel from"./editor/QuizPanel";
import MarketplacePanel from"./editor/MarketplacePanel";
import PreviewFrame from"./editor/PreviewFrame";
import { genId } from"./editor/constants";
import GuidedReviewDesigner from"./guided-review/GuidedReviewDesigner";
import { Link } from"react-router-dom";
import { isV2 } from"@/lib/designConfigV2";
import { studioPath } from "@/components/studio/studioFlag";

// Normalize legacy flat fieldOrder arrays to row structure
const normalizeFieldOrder = (order) => {
 if (!order || !Array.isArray(order)) {
 return [
 { id: genId(), columns: ['name'] },
 { id: genId(), columns: ['phone'] },
 { id: genId(), columns: ['email'] },
 { id: genId(), columns: ['dob'] },
 { id: genId(), columns: ['postal_code'] },
 { id: genId(), columns: ['education_level'] },
 { id: genId(), columns: ['monthly_income'] }
 ];
 }
 if (order.length > 0 && typeof order[0] === 'object' && order[0].columns) {
 return order;
 }
 return order.map(fieldId => ({ id: genId(), columns: [fieldId] }));
};

const TABS = [
 { id: 'content', label: 'Content', icon: Type },
 { id: 'design', label: 'Design', icon: Palette },
 { id: 'layout', label: 'Layout', icon: LayoutTemplate },
 { id: 'quiz', label: 'Quiz', icon: ListChecks },
 { id: 'marketplace', label: 'Marketplace', icon: Store }
];

function ClassicDesignEditor({ campaign, onSave, heightClass = 'h-[calc(100vh-8rem)]' }) {
 const [activeTab, setActiveTab] = useState('content');
 const [panelOpen, setPanelOpen] = useState(true);

 const design = useMemo(() => campaign.design_config || {}, [campaign.design_config]);

 // Only keys the locked LeadCaptureLayout / CampaignSignupForm renderer actually
 // honors. Removed dead style keys (backgroundStyle, alignment, spacing,
 // headlineSize, layoutTemplate, backgroundType, backgroundColor,
 // cardBackgroundColor, textColor) — they were ignored in production. Any such
 // keys still sitting in a stored design_config are harmless (the renderer
 // ignores them). Phone is forced visible: it is the pipeline's identity key.
 const [currentDesign, setCurrentDesign] = useState({
 formHeadline: design.formHeadline ||"",
 formSubheadline: design.formSubheadline ||"",
 // Content slots the public page reads (see leadCaptureContent.js)
 brandWordmark: design.brandWordmark || "",
 storyText: design.storyText || "",
 storyEmphasis: design.storyEmphasis || "",
 heroCtaLabel: design.heroCtaLabel || "",
 ctaText: design.ctaText || "",
 regulatoryFooter: design.regulatoryFooter || "",
 brandFooter: design.brandFooter || "",
 imageUrl: design.imageUrl ||"",
 themeColor: design.themeColor ||"#3B82F6",
 formWidth: design.formWidth || 400,
 visibleFields: { ...(design.visibleFields || { dob: true, postal_code: true }), phone: true },
 requiredFields: design.requiredFields || {},
    sgPrOnly: design.sgPrOnly === true,
    excludeAdvisors: design.excludeAdvisors === true,
    dncCheckAtSubmit: design.dncCheckAtSubmit === true,
    // Per-campaign customer host: 'redeem' (default) or 'mktr' — drives the
    // customer-facing brand/domain for this campaign's links + confirmation email.
    customerHost: design.customerHost === 'mktr' ? 'mktr' : 'redeem',
 fieldOrder: normalizeFieldOrder(design.fieldOrder),
 otpChannel: design.otpChannel ||"sms",
 mediaType: design.mediaType || (design.imageUrl ? 'image' : 'none'),
 videoUrl: design.videoUrl || '',
 termsContent: design.termsContent || '',
 quiz: design.quiz || null,
 // heroFont + featuredDrop — conditionally seeded (only when stored) so a
 // stored value round-trips a save. heroFont has NO preserve policy, so an
 // omitting save wipes it; featuredDrop's admin preserve-when-omitted policy
 // is bypassed the moment the toggle sends a partial object (it used to send
 // {enabled} alone, erasing title/valueLabel/emoji/cap/endsAt). Absent keys
 // stay absent — the panels render safe defaults without them, and luckyDraw
 // (no designer UI writes it) stays omit-preserved on purpose.
 ...(design.heroFont !== undefined ? { heroFont: design.heroFont } : {}),
 ...(design.featuredDrop !== undefined ? { featuredDrop: design.featuredDrop } : {}),
 // Marketplace content (Marketplace tab) — carried through so an ordinary
 // designer save round-trips it. clampDesignConfig replaces these keys
 // WHOLESALE from the incoming object (unlike featuredDrop/luckyDraw, which
 // have preserve-when-omitted policies), so omitting them here would erase
 // stored marketplace content on every save.
 ...Object.fromEntries(
 [
 'name', 'category', 'offer_type', 'mode', 'qr_entry', 'age_range',
 'school_levels', 'dsa_related', 'showCapacity', 'availability',
 'inclusions', 'image_label', 'activation', 'sponsor', 'value_line',
 'content_blocks', 'marketplaceListed',
 ].filter((k) => design[k] !== undefined).map((k) => [k, design[k]])
 ),
 });

 const [saving, setSaving] = useState(false);
 const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
 const [lastSavedTime, setLastSavedTime] = useState(null);
 // Save-failure surfacing (Studio PR 3): the old catch swallowed EVERY error
 // into console.error — a silent dead-end. Errors now render inline in the
 // save bar (no toast here: the workspace parent already toasts a
 // generic failure once, and doubling it up would conflict). A 409
 // DESIGN_CONFIG_VERSION_CONFLICT means the doc became Studio-owned (v2)
 // while this editor was open — swap to the read-only notice.
 const [saveError, setSaveError] = useState(null);
 const [v2Conflict, setV2Conflict] = useState(false);

 // Unsaved changes guard
 useEffect(() => {
 const handler = (e) => {
 if (hasUnsavedChanges) {
 e.preventDefault();
 e.returnValue = '';
 }
 };
 window.addEventListener('beforeunload', handler);
 return () => window.removeEventListener('beforeunload', handler);
 }, [hasUnsavedChanges]);

 const handleDesignChange = useCallback((key, value) => {
 setCurrentDesign(prev => ({ ...prev, [key]: value }));
 setHasUnsavedChanges(true);
 }, []);

 const handleManualSave = async () => {
 setSaving(true);
 setSaveError(null);
 try {
 await onSave(currentDesign);
 setHasUnsavedChanges(false);
 setLastSavedTime(Date.now());
 } catch (error) {
 console.error('Error saving design:', error);
 // apiClient errors carry err.status / err.data (never err.response).
 if (error?.status === 409 && error?.data?.code === 'DESIGN_CONFIG_VERSION_CONFLICT') {
 setV2Conflict(true);
 } else {
 setSaveError(error?.message || 'Failed to save. Please try again.');
 }
 } finally {
 setSaving(false);
 }
 };

 const renderActivePanel = () => {
 switch (activeTab) {
 case 'content':
 return <ContentPanel currentDesign={currentDesign} onDesignChange={handleDesignChange} campaignName={campaign?.name} />;
 case 'design':
 return <DesignPanel currentDesign={currentDesign} onDesignChange={handleDesignChange} />;
 case 'layout':
 return <LayoutPanel currentDesign={currentDesign} onDesignChange={handleDesignChange} />;
 case 'quiz':
 return <QuizPanel currentDesign={currentDesign} onDesignChange={handleDesignChange} />;
 case 'marketplace':
 return <MarketplacePanel currentDesign={currentDesign} onDesignChange={handleDesignChange} campaign={campaign} />;
 default:
 return null;
 }
 };

 // The doc became Studio-owned mid-session (save 409'd) — stop editing it.
 if (v2Conflict) {
 return <StudioV2Notice campaignId={campaign?.id} />;
 }

 return (
 <div className={`flex ${heightClass} gap-0`}>
 {/* Editor Panel */}
 <div className={`${panelOpen ? 'w-[380px] min-w-[380px]' : 'w-0 min-w-0 overflow-hidden'} transition-colors duration-300 flex flex-col border-r border-border bg-card`}>
 {/* Tab Bar */}
 <div className="flex items-center gap-1 px-3 py-2 border-b border-border bg-muted">
 {TABS.map((tab) => (
 <button
 key={tab.id}
 onClick={() => setActiveTab(tab.id)}
 className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
 activeTab === tab.id
 ? 'bg-card text-primary shadow-sm'
 : 'text-muted-foreground hover:text-foreground dark:hover:text-muted-foreground hover:bg-card'
 }`}
 >
 <tab.icon className="w-3.5 h-3.5"/>
 {tab.label}
 </button>
 ))}
 </div>

 {/* Panel Content */}
 <div className="flex-1 overflow-y-auto p-5">
 {renderActivePanel()}
 </div>

 {/* Save Bar */}
 <div className="px-4 py-3 border-t border-border bg-muted">
 <Button
 onClick={handleManualSave}
 disabled={saving || !hasUnsavedChanges}
 className="w-full bg-primary hover:bg-primary/90 disabled:bg-primary/50 dark:disabled:bg-primary/50" >
 {saving ? (
 <><Loader2 className="w-4 h-4 mr-2 animate-spin"/>Saving...</>
 ) : (
 <>
 Save Design
 {hasUnsavedChanges && <span className="ml-2 w-2 h-2 bg-warning rounded-full animate-pulse"/>}
 </>
 )}
 </Button>
 <div className="mt-1.5 text-center">
 {saving ? (
 <p className="text-xs text-primary">Saving changes...</p>
 ) : saveError ? (
 <p className="text-xs text-destructive" data-testid="design-save-error">{saveError}</p>
 ) : hasUnsavedChanges ? (
 <p className="text-xs text-warning">Unsaved changes</p>
 ) : lastSavedTime ? (
 <p className="text-xs text-success">Saved</p>
 ) : (
 <p className="text-xs text-muted-foreground">Changes are saved manually</p>
 )}
 </div>
 </div>
 </div>

 {/* Panel Toggle */}
 <button
 onClick={() => setPanelOpen(!panelOpen)}
 className="flex items-center justify-center w-6 hover:bg-muted transition-colors border-r border-border bg-muted" title={panelOpen ? 'Collapse panel' : 'Expand panel'}
 >
 {panelOpen ? <PanelLeftClose className="w-3.5 h-3.5 text-muted-foreground"/> : <PanelLeft className="w-3.5 h-3.5 text-muted-foreground"/>}
 </button>

 {/* Preview */}
 <div className="flex-1 min-w-0 p-4 bg-muted">
 <PreviewFrame currentDesign={currentDesign} campaign={campaign} />
 </div>
 </div>
 );
}

/**
 * Read-only guard for design_config v2 documents (Studio PR 3): the classic
 * panels edit flat v1 keys and would DESTROY a nested v2 doc on save — the
 * backend already 409s that write (DESIGN_CONFIG_VERSION_CONFLICT); this is
 * the honest client face of the same rule, covering both mounts (workspace
 * Design tab and the legacy /AdminCampaignDesigner page).
 */
export function StudioV2Notice({ campaignId }) {
 return (
 <div className="h-full flex items-center justify-center p-6" data-testid="studio-v2-notice">
 <div className="max-w-md text-center space-y-3 p-8 rounded-2xl border border-border bg-card">
 <div className="text-3xl" aria-hidden="true">🎛️</div>
 <h3 className="text-lg font-semibold">This design was saved by Campaign Studio</h3>
 <p className="text-sm text-muted-foreground">
 It uses the v2 design document, which the classic designer cannot edit
 (saving here would destroy it — the server refuses that write). Open it
 in the Studio to keep editing.
 </p>
 <Link
 to={studioPath(campaignId)}
 className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
 >
 Open Campaign Studio →
 </Link>
 </div>
 </div>
 );
}

export default function DesignEditor(props) {
 if (props.campaign?.type === 'guided_review') {
 return <GuidedReviewDesigner {...props} />;
 }
 // v2 docs are Studio-owned — never mount the classic panels over one.
 if (isV2(props.campaign?.design_config)) {
 return <StudioV2Notice campaignId={props.campaign?.id} />;
 }
 return <ClassicDesignEditor {...props} />;
}
