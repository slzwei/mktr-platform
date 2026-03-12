import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function LayoutPanel({ currentDesign, onDesignChange }) {
  return (
    <div className="space-y-6">
      {/* Form Width */}
      <div className="space-y-3">
        <Label className="text-sm font-semibold text-gray-700 dark:text-gray-300">Form Width</Label>
        <div className="space-y-4">
          <Slider
            value={[currentDesign.formWidth || 400]}
            onValueChange={(value) => onDesignChange('formWidth', value[0])}
            max={600}
            min={300}
            step={20}
            className="w-full"
          />
          <div className="flex justify-between text-sm text-gray-500 dark:text-gray-400">
            <span>Narrow (300px)</span>
            <span className="font-medium">{currentDesign.formWidth || 400}px</span>
            <span>Wide (600px)</span>
          </div>
        </div>
      </div>

      {/* Vertical Spacing */}
      <div className="space-y-3">
        <Label className="text-sm font-semibold text-gray-700 dark:text-gray-300">Vertical Spacing</Label>
        <Select
          value={currentDesign.spacing || 'normal'}
          onValueChange={(value) => onDesignChange('spacing', value)}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="tight">Compact</SelectItem>
            <SelectItem value="normal">Normal</SelectItem>
            <SelectItem value="relaxed">Spacious</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
