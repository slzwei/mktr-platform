import { Input } from"@/components/ui/input";
import { Label } from"@/components/ui/label";
import { Badge } from"@/components/ui/badge";
import { COLOR_PRESETS } from './constants';

/**
 * Design panel — theme/accent color only.
 *
 * The public lead-capture page locks its visual identity (warm-cream / Fraunces)
 * in LeadCaptureLayout. The only per-campaign visual knob the live renderer
 * honors is `themeColor`, which drives the primary action color (CTA, focus
 * rings, checkbox fill). Background, card, text color, headline size, and
 * alignment were removed because production ignored them.
 */
export default function DesignPanel({ currentDesign, onDesignChange }) {
 return (
 <div className="space-y-6">
 {/* Theme Color */}
 <div className="space-y-3">
 <Label className="text-sm font-semibold text-foreground">Theme Color</Label>
 <p className="text-xs text-muted-foreground -mt-1">
 Drives the primary action color — submit button, focus rings, and checkboxes.
 </p>
 <div className="space-y-4">
 <div className="grid grid-cols-4 gap-3">
 {COLOR_PRESETS.map((preset) => (
 <button
 key={preset.name}
 onClick={() => onDesignChange('themeColor', preset.color)}
 className={`relative w-full h-12 rounded-lg border-2 transition-colors ${
 currentDesign.themeColor === preset.color
 ? 'border-border dark:border-border shadow-md'
 : 'border-border hover:border-border '
 }`}
 style={{ backgroundColor: preset.color }}
 >
 {currentDesign.themeColor === preset.color && (
 <div className="absolute inset-0 flex items-center justify-center">
 <div className="w-6 h-6 bg-card rounded-full flex items-center justify-center">
 <div className="w-2 h-2 bg-foreground rounded-full"/>
 </div>
 </div>
 )}
 </button>
 ))}
 </div>
 <div className="flex items-center gap-3 pt-2 border-t">
 <Label className="text-sm dark:text-muted-foreground">Custom:</Label>
 <Input
 type="color" value={currentDesign.themeColor}
 onChange={(e) => onDesignChange('themeColor', e.target.value)}
 className="w-16 h-10 p-1 rounded-lg border" />
 <Badge variant="outline" className="font-mono text-xs">
 {currentDesign.themeColor}
 </Badge>
 </div>
 </div>
 </div>
 </div>
 );
}
