import { PAGE_TEMPLATES } from './constants';

export default function TemplatesPanel({ onApplyTemplate }) {
 return (
 <div className="space-y-4">
 <p className="text-sm text-muted-foreground">
 Choose a starting template. You can customise everything after applying.
 </p>
 <div className="grid grid-cols-1 gap-3">
 {Object.values(PAGE_TEMPLATES).map((template) => (
 <button
 key={template.id}
 type="button" onClick={() => onApplyTemplate(template.id)}
 className="relative p-4 rounded-xl border-2 border-border hover:border-ring dark:hover:border-ring transition-colors text-left group bg-card" >
 <div className="flex items-center gap-4">
 <div
 className="w-14 h-14 rounded-lg border border-border flex items-center justify-center shrink-0 overflow-hidden" style={{ backgroundColor: template.preview.bg }}
 >
 <div
 className="w-8 h-10 rounded shadow-sm" style={{ backgroundColor: template.preview.card, border: '1px solid rgba(0,0,0,0.1)' }}
 >
 <div className="w-4 h-1 rounded-full mt-2 mx-auto" style={{ backgroundColor: template.preview.accent }} />
 <div className="w-5 h-0.5 rounded-full mt-1 mx-auto bg-muted-foreground/50"/>
 <div className="w-5 h-0.5 rounded-full mt-0.5 mx-auto bg-muted-foreground/50"/>
 </div>
 </div>
 <div className="flex-1 min-w-0">
 <h4 className="font-semibold text-foreground">{template.name}</h4>
 <p className="text-xs text-muted-foreground mt-0.5">{template.tagline}</p>
 </div>
 <div className="text-xs text-primary font-medium opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity shrink-0" aria-hidden="true">
 Apply
 </div>
 </div>
 </button>
 ))}
 </div>
 <div className="pt-2 text-xs text-muted-foreground text-center">
 Applying a template updates colours, layout, and typography. Your content and field settings are preserved.
 </div>
 </div>
 );
}
