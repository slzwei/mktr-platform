import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CheckCircle2, X } from "lucide-react";
import { LAYOUT_TEMPLATES, COLOR_PRESETS } from './constants';

export default function DesignPanel({ currentDesign, onDesignChange }) {
  return (
    <div className="space-y-6">
      {/* Layout Style */}
      <div className="space-y-3">
        <Label className="text-sm font-semibold text-gray-700 dark:text-gray-300">Layout Style</Label>
        <div className="grid grid-cols-1 gap-3">
          {Object.values(LAYOUT_TEMPLATES).map((template) => (
            <div
              key={template.id}
              onClick={() => {
                onDesignChange('layoutTemplate', template.id);
                onDesignChange('backgroundStyle', template.backgroundStyle);
                if (template.config) {
                  Object.entries(template.config).forEach(([key, value]) => {
                    onDesignChange(key, value);
                  });
                }
              }}
              className={`relative p-4 rounded-xl border-2 transition-all cursor-pointer ${
                currentDesign.layoutTemplate === template.id
                  ? 'border-blue-600 bg-blue-50/50 dark:bg-blue-950/30'
                  : 'border-gray-100 dark:border-gray-700 hover:border-blue-200 dark:hover:border-blue-800 hover:bg-gray-50 dark:hover:bg-gray-800'
              }`}
            >
              <div className="flex items-center gap-3">
                {/* Mini preview swatch */}
                <div
                  className="w-12 h-12 rounded-lg border border-gray-200 dark:border-gray-600 flex items-center justify-center shrink-0 overflow-hidden"
                  style={{ backgroundColor: template.config?.backgroundColor || '#f9fafb' }}
                >
                  <div
                    className="w-7 h-9 shadow-sm"
                    style={{
                      backgroundColor: template.config?.cardBackgroundColor || '#fff',
                      borderRadius: template.id === 'modern' ? '6px' : template.id === 'simple' ? '0' : '3px',
                      border: '1px solid rgba(0,0,0,0.08)'
                    }}
                  >
                    <div className="w-3 h-0.5 rounded-full mt-1.5 mx-auto" style={{ backgroundColor: template.config?.themeColor || template.themeColor }} />
                    <div className="w-4 h-0.5 rounded-full mt-0.5 mx-auto bg-gray-300/50" />
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="font-semibold text-gray-900 dark:text-gray-100">{template.name}</h4>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{template.description}</p>
                </div>
                {currentDesign.layoutTemplate === template.id && (
                  <div className="h-5 w-5 rounded-full bg-blue-600 flex items-center justify-center shrink-0">
                    <CheckCircle2 className="w-3 h-3 text-white" />
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Background */}
      <div className="space-y-3 pt-4 border-t dark:border-gray-700">
        <Label className="text-sm font-semibold text-gray-700 dark:text-gray-300">Background</Label>
        <div className="bg-gray-50 dark:bg-gray-800 p-1 rounded-lg flex gap-1 mb-2">
          <button
            type="button"
            onClick={() => onDesignChange('backgroundType', 'preset')}
            className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all ${
              (!currentDesign.backgroundType || currentDesign.backgroundType === 'preset')
                ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
            }`}
          >
            Preset
          </button>
          <button
            type="button"
            onClick={() => onDesignChange('backgroundType', 'custom')}
            className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all ${
              currentDesign.backgroundType === 'custom'
                ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
            }`}
          >
            Custom Color
          </button>
        </div>

        {currentDesign.backgroundType === 'custom' && (
          <div className="flex items-center gap-3 animate-in fade-in slide-in-from-top-2">
            <Input
              type="color"
              value={currentDesign.backgroundColor || '#ffffff'}
              onChange={(e) => onDesignChange('backgroundColor', e.target.value)}
              className="w-full h-10 p-1 rounded-lg border cursor-pointer"
            />
            <Badge variant="outline" className="font-mono text-xs">
              {currentDesign.backgroundColor || '#ffffff'}
            </Badge>
          </div>
        )}
        {(!currentDesign.backgroundType || currentDesign.backgroundType === 'preset') && (
          <p className="text-xs text-gray-400 dark:text-gray-500">
            Using default background from <strong>{LAYOUT_TEMPLATES[currentDesign.layoutTemplate]?.name || 'current'}</strong> template.
          </p>
        )}
      </div>

      {/* Theme Color */}
      <div className="space-y-3 pt-4 border-t dark:border-gray-700">
        <Label className="text-sm font-semibold text-gray-700 dark:text-gray-300">Theme Color</Label>
        <div className="space-y-4">
          <div className="grid grid-cols-4 gap-3">
            {COLOR_PRESETS.map((preset) => (
              <button
                key={preset.name}
                onClick={() => onDesignChange('themeColor', preset.color)}
                className={`relative w-full h-12 rounded-lg border-2 transition-all ${
                  currentDesign.themeColor === preset.color
                    ? 'border-gray-400 dark:border-gray-300 shadow-md'
                    : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'
                }`}
                style={{ backgroundColor: preset.color }}
              >
                {currentDesign.themeColor === preset.color && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-6 h-6 bg-white rounded-full flex items-center justify-center">
                      <div className="w-2 h-2 bg-gray-800 rounded-full" />
                    </div>
                  </div>
                )}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3 pt-2 border-t dark:border-gray-700">
            <Label className="text-sm dark:text-gray-300">Custom:</Label>
            <Input
              type="color"
              value={currentDesign.themeColor}
              onChange={(e) => onDesignChange('themeColor', e.target.value)}
              className="w-16 h-10 p-1 rounded-lg border"
            />
            <Badge variant="outline" className="font-mono text-xs">
              {currentDesign.themeColor}
            </Badge>
          </div>
        </div>
      </div>

      {/* Card Background */}
      <div className="space-y-3">
        <Label className="text-sm font-semibold text-gray-700 dark:text-gray-300">Card Background</Label>
        <div className="flex items-center gap-3">
          <Input
            type="color"
            value={currentDesign.cardBackgroundColor || '#ffffff'}
            onChange={(e) => onDesignChange('cardBackgroundColor', e.target.value)}
            className="w-full h-10 p-1 rounded-lg border cursor-pointer"
          />
          {currentDesign.cardBackgroundColor && (
            <Button variant="ghost" size="icon" onClick={() => onDesignChange('cardBackgroundColor', '')} title="Reset to default">
              <X className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Text Color */}
      <div className="space-y-3">
        <Label className="text-sm font-semibold text-gray-700 dark:text-gray-300">Text Color</Label>
        <div className="flex items-center gap-3">
          <Input
            type="color"
            value={currentDesign.textColor || '#111827'}
            onChange={(e) => onDesignChange('textColor', e.target.value)}
            className="w-full h-10 p-1 rounded-lg border cursor-pointer"
          />
          {currentDesign.textColor && (
            <Button variant="ghost" size="icon" onClick={() => onDesignChange('textColor', '')} title="Reset to default">
              <X className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Headline Size */}
      <div className="space-y-3">
        <Label className="text-sm font-semibold text-gray-700 dark:text-gray-300">Headline Text Size</Label>
        <div className="space-y-4">
          <Slider
            value={[currentDesign.headlineSize || 20]}
            onValueChange={(value) => onDesignChange('headlineSize', value[0])}
            max={36}
            min={16}
            step={2}
            className="w-full"
          />
          <div className="flex justify-between text-sm text-gray-500 dark:text-gray-400">
            <span>Small (16px)</span>
            <span className="font-medium">{currentDesign.headlineSize || 20}px</span>
            <span>Large (36px)</span>
          </div>
        </div>
      </div>

      {/* Text Alignment */}
      <div className="space-y-3">
        <Label className="text-sm font-semibold text-gray-700 dark:text-gray-300">Text Alignment</Label>
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
