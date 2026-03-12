import { useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { UploadFile } from "@/api/integrations";
import {
  Upload,
  Loader2,
  Image as ImageIcon,
  Trash2,
  AlertCircle,
  Video,
  Link2
} from "lucide-react";
import { resolveImageUrl } from "../LeadCaptureLayout";
import { TC_TEMPLATES } from './constants';

export default function ContentPanel({ currentDesign, onDesignChange }) {
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  const handleImageUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    setUploading(true);
    try {
      const result = await UploadFile(file, 'image');
      const relativeUrl = result?.file?.url || '';
      onDesignChange('imageUrl', relativeUrl);
    } catch (error) {
      console.error('Error uploading image:', error);
    }
    setUploading(false);

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-6">
      {/* Headline */}
      <div className="space-y-3">
        <Label htmlFor="formHeadline" className="text-sm font-semibold text-gray-700 dark:text-gray-300">
          Form Headline
        </Label>
        <Input
          id="formHeadline"
          value={currentDesign.formHeadline}
          onChange={(e) => onDesignChange('formHeadline', e.target.value)}
          placeholder="e.g., Get Started Now!"
          className="text-lg"
          maxLength={80}
        />
      </div>

      {/* Sub-headline */}
      <div className="space-y-3">
        <Label htmlFor="formSubheadline" className="text-sm font-semibold text-gray-700 dark:text-gray-300">
          Form Sub-headline
        </Label>
        <Textarea
          id="formSubheadline"
          value={currentDesign.formSubheadline}
          onChange={(e) => onDesignChange('formSubheadline', e.target.value)}
          placeholder="e.g., Fill out the form to get started."
          className="resize-none h-16"
          maxLength={150}
        />
      </div>

      {/* Header Media */}
      <div className="space-y-3">
        <Label className="text-sm font-semibold text-gray-700 dark:text-gray-300">Header Media</Label>

        <div className="bg-gray-50 dark:bg-gray-800 p-1 rounded-lg flex gap-1">
          {[
            { id: 'none', label: 'None' },
            { id: 'image', label: 'Image', icon: ImageIcon },
            { id: 'video', label: 'Video', icon: Video },
          ].map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => onDesignChange('mediaType', opt.id)}
              className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all flex items-center justify-center gap-1.5 ${
                currentDesign.mediaType === opt.id
                  ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
              }`}
            >
              {opt.icon && <opt.icon className="w-3.5 h-3.5" />}
              {opt.label}
            </button>
          ))}
        </div>

        {/* Image upload */}
        {currentDesign.mediaType === 'image' && (
          <div className="border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-xl p-6 text-center hover:border-gray-300 dark:hover:border-gray-600 transition-colors animate-in fade-in slide-in-from-top-2">
            {currentDesign.imageUrl ? (
              <div className="space-y-4">
                <div className="relative inline-block">
                  <div className="w-40 h-24 overflow-hidden rounded-lg shadow-sm bg-gray-100 dark:bg-gray-800">
                    <img
                      src={resolveImageUrl(currentDesign.imageUrl)}
                      alt="Header preview"
                      className="w-full h-full object-contain"
                      onError={(e) => { e.target.style.display = 'none'; }}
                    />
                  </div>
                  <Button
                    variant="destructive"
                    size="icon"
                    className="absolute -top-2 -right-2 w-6 h-6 rounded-full"
                    onClick={() => onDesignChange('imageUrl', '')}
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
                <div className="space-y-2">
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Current Image</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Recommended: 1200x600px (2:1 ratio)</p>
                  <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                    Replace Image
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <ImageIcon className="w-12 h-12 text-gray-400 mx-auto" />
                <div>
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Upload Header Image</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Recommended: 1200x600px (2:1 ratio), JPG or PNG</p>
                </div>
                <Button
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="mt-3"
                >
                  {uploading ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Uploading...</>
                  ) : (
                    <><Upload className="w-4 h-4 mr-2" />Choose Image</>
                  )}
                </Button>
              </div>
            )}
            <Input
              type="file"
              ref={fileInputRef}
              onChange={handleImageUpload}
              className="hidden"
              accept="image/*"
            />
          </div>
        )}

        {/* Video URL */}
        {currentDesign.mediaType === 'video' && (
          <div className="space-y-3 animate-in fade-in slide-in-from-top-2">
            <div className="relative">
              <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                value={currentDesign.videoUrl || ''}
                onChange={(e) => onDesignChange('videoUrl', e.target.value)}
                placeholder="https://youtube.com/watch?v=... or https://example.com/video.mp4"
                className="pl-10"
              />
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Paste a YouTube link or a direct video URL (mp4). The video will display at 16:9 ratio.
            </p>
            {currentDesign.videoUrl && (
              <div className="flex items-center gap-2">
                <div className="w-32 h-18 rounded-lg overflow-hidden bg-black border dark:border-gray-700">
                  {/youtube|youtu\.be/.test(currentDesign.videoUrl) ? (
                    <div className="w-full h-full flex items-center justify-center text-white text-xs bg-red-600">
                      <Video className="w-4 h-4 mr-1" /> YouTube
                    </div>
                  ) : (
                    <video src={currentDesign.videoUrl} className="w-full h-full object-cover" muted preload="metadata" />
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onDesignChange('videoUrl', '')}
                  className="text-red-500 hover:text-red-700 text-xs"
                >
                  <Trash2 className="w-3 h-3 mr-1" /> Remove
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* OTP Settings */}
      <div className="space-y-3 pt-4 border-t dark:border-gray-700">
        <Label className="text-sm font-semibold text-gray-700 dark:text-gray-300">Verification Method</Label>
        <p className="text-xs text-gray-500 dark:text-gray-400 -mt-1">Choose how users receive their One-Time Password (OTP)</p>
        <Select
          value={currentDesign.otpChannel || 'sms'}
          onValueChange={(value) => onDesignChange('otpChannel', value)}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select OTP Channel" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="sms">SMS (via AWS SNS)</SelectItem>
            <SelectItem value="whatsapp">WhatsApp (via Meta)</SelectItem>
          </SelectContent>
        </Select>
        {currentDesign.otpChannel === 'whatsapp' && (
          <div className="flex items-center gap-2 text-xs text-amber-600 bg-amber-50 dark:bg-amber-900/20 p-2 rounded border dark:border-amber-800">
            <AlertCircle className="w-4 h-4" />
            <span>Ensure your Meta credentials are configured in .env</span>
          </div>
        )}
      </div>

      {/* Form Fields */}
      <div className="space-y-3 pt-4 border-t dark:border-gray-700">
        <Label className="text-sm font-semibold text-gray-700 dark:text-gray-300">Form Fields</Label>
        <p className="text-xs text-gray-500 dark:text-gray-400 -mt-1">Configure which fields appear and whether they're required</p>
        <div className="space-y-2">
          <FieldToggle
            id="phone"
            label="Phone Number"
            checked={currentDesign.visibleFields?.phone !== false}
            onChange={(checked) => onDesignChange('visibleFields', { ...currentDesign.visibleFields, phone: checked })}
            fixedRequired="Required for OTP"
          />
          <FieldToggle
            id="dob"
            label="Date of Birth"
            checked={currentDesign.visibleFields?.dob !== false}
            onChange={(checked) => onDesignChange('visibleFields', { ...currentDesign.visibleFields, dob: checked })}
            requiredChecked={currentDesign.requiredFields?.dob === true}
            onRequiredChange={(checked) => onDesignChange('requiredFields', { ...currentDesign.requiredFields, dob: checked })}
          />
          <FieldToggle
            id="postal_code"
            label="Postal Code"
            checked={currentDesign.visibleFields?.postal_code !== false}
            onChange={(checked) => onDesignChange('visibleFields', { ...currentDesign.visibleFields, postal_code: checked })}
            requiredChecked={currentDesign.requiredFields?.postal_code === true}
            onRequiredChange={(checked) => onDesignChange('requiredFields', { ...currentDesign.requiredFields, postal_code: checked })}
          />
          <FieldToggle
            id="education_level"
            label="Highest Education"
            checked={currentDesign.visibleFields?.education_level === true}
            onChange={(checked) => onDesignChange('visibleFields', { ...currentDesign.visibleFields, education_level: checked })}
            requiredChecked={currentDesign.requiredFields?.education_level === true}
            onRequiredChange={(checked) => onDesignChange('requiredFields', { ...currentDesign.requiredFields, education_level: checked })}
          />
          <FieldToggle
            id="monthly_income"
            label="Monthly Income"
            checked={currentDesign.visibleFields?.monthly_income === true}
            onChange={(checked) => onDesignChange('visibleFields', { ...currentDesign.visibleFields, monthly_income: checked })}
            requiredChecked={currentDesign.requiredFields?.monthly_income === true}
            onRequiredChange={(checked) => onDesignChange('requiredFields', { ...currentDesign.requiredFields, monthly_income: checked })}
          />
        </div>
      </div>

      {/* Terms & Conditions */}
      <div className="space-y-3 pt-4 border-t dark:border-gray-700">
        <Label className="text-sm font-semibold text-gray-700 dark:text-gray-300">Terms & Conditions</Label>
        <p className="text-xs text-gray-500 dark:text-gray-400 -mt-1">Customize the legal text displayed in the consent dialog.</p>
        <div className="space-y-3">
          <Select
            onValueChange={(value) => {
              const template = TC_TEMPLATES[value];
              if (template && template.content !== undefined) {
                onDesignChange('termsContent', template.content);
              }
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select a template..." />
            </SelectTrigger>
            <SelectContent>
              {Object.values(TC_TEMPLATES).map(t => (
                <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="space-y-1">
            <Label className="text-xs text-gray-500 dark:text-gray-400">Custom Content (HTML supported)</Label>
            <Textarea
              value={currentDesign.termsContent || ''}
              onChange={(e) => onDesignChange('termsContent', e.target.value)}
              placeholder="<div>...</div>"
              className="font-mono text-xs h-64"
              maxLength={10000}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function FieldToggle({ id, label, checked, onChange, fixedRequired, requiredChecked, onRequiredChange }) {
  return (
    <div className="flex items-center justify-between py-1">
      <div className="flex items-center space-x-2">
        <input
          type="checkbox"
          id={`field_${id}`}
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
        />
        <Label htmlFor={`field_${id}`} className="text-sm text-gray-700 dark:text-gray-300 font-normal">{label}</Label>
      </div>
      {fixedRequired ? (
        <span className="text-xs text-gray-400 dark:text-gray-500">{fixedRequired}</span>
      ) : checked && onRequiredChange ? (
        <label className="flex items-center space-x-1 text-xs text-gray-500 dark:text-gray-400 cursor-pointer">
          <input
            type="checkbox"
            checked={requiredChecked}
            onChange={(e) => onRequiredChange(e.target.checked)}
            className="h-3 w-3 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
          />
          <span>Required</span>
        </label>
      ) : null}
    </div>
  );
}
