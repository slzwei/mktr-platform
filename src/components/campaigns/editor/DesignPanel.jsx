import { Input } from"@/components/ui/input";
import { Label } from"@/components/ui/label";
import { Badge } from"@/components/ui/badge";
import { Button } from"@/components/ui/button";
import { Slider } from"@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from"@/components/ui/select";
import { X } from"lucide-react";
import { COLOR_PRESETS } from './constants';

export default function DesignPanel({ currentDesign, onDesignChange }) {
 return (
 <div className="space-y-6">
 {/* Background */}
 <div className="space-y-3">
 <Label className="text-sm font-semibold text-foreground">Background Color</Label>
 <div className="flex items-center gap-3">
 <Input
 type="color" value={currentDesign.backgroundColor || '#ffffff'}
 onChange={(e) => {
 onDesignChange('backgroundColor', e.target.value);
 onDesignChange('backgroundType', 'custom');
 }}
 className="w-full h-10 p-1 rounded-lg border cursor-pointer" />
 <Badge variant="outline" className="font-mono text-xs shrink-0">
 {currentDesign.backgroundColor || '#ffffff'}
 </Badge>
 </div>
 </div>

 {/* Theme Color */}
 <div className="space-y-3 pt-4 border-t">
 <Label className="text-sm font-semibold text-foreground">Theme Color</Label>
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

 {/* Card Background */}
 <div className="space-y-3 pt-4 border-t">
 <Label className="text-sm font-semibold text-foreground">Card Background</Label>
 <div className="flex items-center gap-3">
 <Input
 type="color" value={currentDesign.cardBackgroundColor || '#ffffff'}
 onChange={(e) => onDesignChange('cardBackgroundColor', e.target.value)}
 className="w-full h-10 p-1 rounded-lg border cursor-pointer" />
 {currentDesign.cardBackgroundColor && (
 <Button variant="ghost" size="icon" aria-label="Reset card background color" onClick={() => onDesignChange('cardBackgroundColor', '')} title="Reset to default">
 <X className="w-4 h-4" aria-hidden="true" />
 </Button>
 )}
 </div>
 </div>

 {/* Text Color */}
 <div className="space-y-3 pt-4 border-t">
 <Label className="text-sm font-semibold text-foreground">Text Color</Label>
 <div className="flex items-center gap-3">
 <Input
 type="color" value={currentDesign.textColor || '#111827'}
 onChange={(e) => onDesignChange('textColor', e.target.value)}
 className="w-full h-10 p-1 rounded-lg border cursor-pointer" />
 {currentDesign.textColor && (
 <Button variant="ghost" size="icon" aria-label="Reset text color" onClick={() => onDesignChange('textColor', '')} title="Reset to default">
 <X className="w-4 h-4" aria-hidden="true" />
 </Button>
 )}
 </div>
 </div>

 {/* Headline Size */}
 <div className="space-y-3 pt-4 border-t">
 <Label className="text-sm font-semibold text-foreground">Headline Text Size</Label>
 <div className="space-y-4">
 <Slider
 value={[currentDesign.headlineSize || 20]}
 onValueChange={(value) => onDesignChange('headlineSize', value[0])}
 max={36}
 min={16}
 step={2}
 className="w-full" />
 <div className="flex justify-between text-sm text-muted-foreground">
 <span>Small (16px)</span>
 <span className="font-medium">{currentDesign.headlineSize || 20}px</span>
 <span>Large (36px)</span>
 </div>
 </div>
 </div>

 {/* Text Alignment */}
 <div className="space-y-3 pt-4 border-t">
 <Label className="text-sm font-semibold text-foreground">Text Alignment</Label>
 <Select
 value={currentDesign.alignment || 'center'}
 onValueChange={(value) => onDesignChange('alignment', value)}
 >
 <SelectTrigger className="w-full">
 <SelectValue />
 </SelectTrigger>
 <SelectContent>
 <SelectItem value="left">Left Aligned</SelectItem>
 <SelectItem value="center">Centered</SelectItem>
 </SelectContent>
 </Select>
 </div>
 </div>
 );
}
