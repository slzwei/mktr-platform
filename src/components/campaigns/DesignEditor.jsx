import { useState, useEffect, useMemo, useCallback } from"react";
import { Button } from"@/components/ui/button";
import {
 Loader2,
 Type,
 Palette,
 LayoutTemplate,
 Sparkles,
 PanelLeftClose,
 PanelLeft
} from"lucide-react";

import TemplatesPanel from"./editor/TemplatesPanel";
import ContentPanel from"./editor/ContentPanel";
import DesignPanel from"./editor/DesignPanel";
import LayoutPanel from"./editor/LayoutPanel";
import PreviewFrame from"./editor/PreviewFrame";
import { PAGE_TEMPLATES } from"./editor/constants";

// Helper to generate row IDs
const generateId = () => Math.random().toString(36).substr(2, 9);

// Normalize legacy flat fieldOrder arrays to row structure
const normalizeFieldOrder = (order) => {
 if (!order || !Array.isArray(order)) {
 return [
 { id: generateId(), columns: ['name'] },
 { id: generateId(), columns: ['phone'] },
 { id: generateId(), columns: ['email'] },
 { id: generateId(), columns: ['dob'] },
 { id: generateId(), columns: ['postal_code'] },
 { id: generateId(), columns: ['education_level'] },
 { id: generateId(), columns: ['monthly_income'] }
 ];
 }
 if (order.length > 0 && typeof order[0] === 'object' && order[0].columns) {
 return order;
 }
 return order.map(fieldId => ({ id: generateId(), columns: [fieldId] }));
};

const TABS = [
 { id: 'templates', label: 'Templates', icon: Sparkles },
 { id: 'content', label: 'Content', icon: Type },
 { id: 'design', label: 'Design', icon: Palette },
 { id: 'layout', label: 'Layout', icon: LayoutTemplate }
];

export default function DesignEditor({ campaign, onSave }) {
 const [activeTab, setActiveTab] = useState('content');
 const [panelOpen, setPanelOpen] = useState(true);

 const design = useMemo(() => campaign.design_config || {}, [campaign.design_config]);

 const [currentDesign, setCurrentDesign] = useState({
 formHeadline: design.formHeadline ||"",
 formSubheadline: design.formSubheadline ||"",
 imageUrl: design.imageUrl ||"",
 themeColor: design.themeColor ||"#3B82F6",
 backgroundStyle: design.backgroundStyle ||"gradient",
 alignment: design.alignment ||"center",
 formWidth: design.formWidth || 400,
 spacing: design.spacing ||"normal",
 headlineSize: design.headlineSize || 20,
 visibleFields: design.visibleFields || { phone: true, dob: true, postal_code: true },
 requiredFields: design.requiredFields || {},
 fieldOrder: normalizeFieldOrder(design.fieldOrder),
 layoutTemplate: design.layoutTemplate || 'modern',
 otpChannel: design.otpChannel ||"sms",
 backgroundType: design.backgroundType || 'preset',
 backgroundColor: design.backgroundColor || '#ffffff',
 mediaType: design.mediaType || (design.imageUrl ? 'image' : 'none'),
 videoUrl: design.videoUrl || '',
 cardBackgroundColor: design.cardBackgroundColor || '',
 textColor: design.textColor || '',
 termsContent: design.termsContent || '',
 });

 const [saving, setSaving] = useState(false);
 const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
 const [lastSavedTime, setLastSavedTime] = useState(null);

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
 try {
 await onSave(currentDesign);
 setHasUnsavedChanges(false);
 setLastSavedTime(Date.now());
 } catch (error) {
 console.error('Error saving design:', error);
 } finally {
 setSaving(false);
 }
 };

 const handleApplyTemplate = useCallback((templateId) => {
 const template = PAGE_TEMPLATES[templateId];
 if (!template) return;
 setCurrentDesign(prev => ({ ...prev, ...template.config }));
 setHasUnsavedChanges(true);
 }, []);

 const renderActivePanel = () => {
 switch (activeTab) {
 case 'templates':
 return <TemplatesPanel onApplyTemplate={handleApplyTemplate} />;
 case 'content':
 return <ContentPanel currentDesign={currentDesign} onDesignChange={handleDesignChange} />;
 case 'design':
 return <DesignPanel currentDesign={currentDesign} onDesignChange={handleDesignChange} />;
 case 'layout':
 return <LayoutPanel currentDesign={currentDesign} onDesignChange={handleDesignChange} />;
 default:
 return null;
 }
 };

 return (
 <div className="flex h-[calc(100vh-8rem)] gap-0">
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
 <PreviewFrame currentDesign={currentDesign} campaign={campaign} onDesignChange={handleDesignChange} />
 </div>
 </div>
 );
}
