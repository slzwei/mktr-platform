import { Label } from"@/components/ui/label";
import { Slider } from"@/components/ui/slider";
import FieldOrderEditor from"./FieldOrderEditor";

export default function LayoutPanel({ currentDesign, onDesignChange }) {
 return (
 <div className="space-y-6">
 {/* Form Width */}
 <div className="space-y-3">
 <Label className="text-sm font-semibold text-foreground">Form Width</Label>
 <div className="space-y-4">
 <Slider
 value={[currentDesign.formWidth || 400]}
 onValueChange={(value) => onDesignChange('formWidth', value[0])}
 max={600}
 min={300}
 step={20}
 className="w-full" />
 <div className="flex justify-between text-sm text-muted-foreground">
 <span>Narrow (300px)</span>
 <span className="font-medium">{currentDesign.formWidth || 400}px</span>
 <span>Wide (600px)</span>
 </div>
 </div>
 </div>

 {/* Field Order */}
 <div className="pt-4 border-t">
 <FieldOrderEditor
 fieldOrder={currentDesign.fieldOrder}
 visibleFields={currentDesign.visibleFields}
 onChange={(newOrder) => onDesignChange('fieldOrder', newOrder)}
 />
 </div>
 </div>
 );
}
