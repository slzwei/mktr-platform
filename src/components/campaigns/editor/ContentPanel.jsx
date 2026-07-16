import { useRef, useState } from"react";
import { toast } from"sonner";
import { Input } from"@/components/ui/input";
import { Label } from"@/components/ui/label";
import { Textarea } from"@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from"@/components/ui/select";
import { Button } from"@/components/ui/button";
import { Switch } from"@/components/ui/switch";
import { UploadFile } from"@/api/integrations";
import {
 Upload,
 Loader2,
 Image as ImageIcon,
 Trash2,
 AlertCircle,
 Video,
 Link2,
 Lock
} from"lucide-react";
import { resolveImageUrl } from"../LeadCaptureLayout";
import { TC_TEMPLATES } from './constants';
import { brand } from"@/lib/brand";
import { HERO_FONTS, DEFAULT_HERO_FONT } from"@/lib/heroFonts";
import { MAX_UPLOAD_SIZE_MB } from"@/lib/uploadLimits";

export default function ContentPanel({ currentDesign, onDesignChange, campaignName }) {
 const [uploading, setUploading] = useState(false);
 const [uploadingVideo, setUploadingVideo] = useState(false);
 const fileInputRef = useRef(null);
 const videoInputRef = useRef(null);

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
 toast.error(error?.message === 'File too large'
 ? `Image is too large — maximum ${MAX_UPLOAD_SIZE_MB}MB.`
 : 'Failed to upload image. Please try again.');
 }
 setUploading(false);

 if (fileInputRef.current) {
 fileInputRef.current.value = '';
 }
 };

 // Redeem homepage publication (design_config.featuredDrop). Server-side this
 // is admin-only: non-admin saves preserve the stored value (utils/featuredDrop.js).
 const featuredDrop = currentDesign.featuredDrop || {};
 const setFeaturedDrop = (patch) => onDesignChange('featuredDrop', { ...featuredDrop, ...patch });

 const handleVideoUpload = async (event) => {
 const file = event.target.files[0];
 if (!file) return;

 setUploadingVideo(true);
 try {
 const result = await UploadFile(file, 'campaign_media');
 const relativeUrl = result?.file?.url || '';
 if (relativeUrl) onDesignChange('videoUrl', relativeUrl);
 } catch (error) {
 console.error('Error uploading video:', error);
 // The multer 400 for an oversize file carries message 'File too large'
 // (backend/src/routes/uploads.js) — surface it with the real cap instead of
 // a hardcoded guess. (err.response never exists on apiClient errors.)
 toast.error(error?.message === 'File too large'
 ? `Video is too large — maximum ${MAX_UPLOAD_SIZE_MB}MB.`
 : error?.message || 'Failed to upload video. Please try again.');
 }
 setUploadingVideo(false);

 if (videoInputRef.current) {
 videoInputRef.current.value = '';
 }
 };

 return (
 <div className="space-y-6">
      {/* Customer domain — which host + brand the customer sees */}
      <div className="space-y-3">
        <Label className="text-sm font-semibold text-foreground">Customer domain</Label>
        <p className="text-xs text-muted-foreground -mt-1">
          Where this campaign&apos;s form lives and which brand the customer sees. Default is
          redeem.sg (customer brand); switch to mktr.sg to serve it on the operator domain.
        </p>
        <div className="bg-muted p-1 rounded-lg flex gap-1">
          {[
            { id: 'redeem', label: 'redeem.sg', sub: 'Customer brand' },
            { id: 'mktr', label: 'mktr.sg', sub: 'Operator brand' },
          ].map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => onDesignChange('customerHost', opt.id)}
              className={`flex-1 py-1.5 px-2 text-xs font-medium rounded-md transition-colors ${
                (currentDesign.customerHost || 'redeem') === opt.id
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground dark:hover:text-muted-foreground'
              }`}
            >
              <span className="block font-mono">{opt.label}</span>
              <span className="block text-[10px] font-normal opacity-70">{opt.sub}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Redeem homepage — feature this campaign as a drop on redeem.sg */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-semibold text-foreground">Feature on redeem.sg homepage</Label>
          <Switch
            aria-label="Feature on redeem.sg homepage"
            checked={featuredDrop.enabled === true}
            onCheckedChange={(v) => setFeaturedDrop({ enabled: v === true })}
          />
        </div>
        <p className="text-xs text-muted-foreground -mt-1">
          Shows in the Drops section on redeem.sg while this campaign is active. Admin-only —
          saves from other roles keep the previous setting. Display cap and end date only
          change the homepage; they don&apos;t stop sign-ups.
        </p>
        {featuredDrop.enabled === true && (
          <div className="space-y-2">
            <Input
              value={featuredDrop.title || ''}
              onChange={(e) => setFeaturedDrop({ title: e.target.value })}
              placeholder={campaignName || 'Drop title (defaults to campaign name)'}
              maxLength={40}
            />
            <div className="grid grid-cols-2 gap-2">
              <Input
                value={featuredDrop.valueLabel || ''}
                onChange={(e) => setFeaturedDrop({ valueLabel: e.target.value })}
                placeholder="Value — FREE, S$20…"
                maxLength={12}
              />
              <Input
                value={featuredDrop.emoji || ''}
                onChange={(e) => setFeaturedDrop({ emoji: e.target.value })}
                placeholder="Emoji — 🧳"
                maxLength={8}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Input
                type="number"
                min="1"
                value={featuredDrop.cap ?? ''}
                onChange={(e) => setFeaturedDrop({ cap: e.target.value === '' ? undefined : Number(e.target.value) })}
                placeholder="Display cap (optional)"
              />
              <Input
                type="date"
                value={featuredDrop.endsAt || ''}
                onChange={(e) => setFeaturedDrop({ endsAt: e.target.value || undefined })}
                title="Homepage end date (SGT, optional)"
              />
            </div>
            {(!featuredDrop.valueLabel || !featuredDrop.emoji) && (
              <p className="text-xs text-amber-600 dark:text-amber-500 flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5" />
                Add a value label and emoji so the homepage card renders fully.
              </p>
            )}
          </div>
        )}
      </div>

 {/* Headline */}
 <div className="space-y-3">
 <Label htmlFor="formHeadline" className="text-sm font-semibold text-foreground">
 Form Headline
 </Label>
 <Input
 id="formHeadline" value={currentDesign.formHeadline}
 onChange={(e) => onDesignChange('formHeadline', e.target.value)}
 placeholder="e.g., Get Started Now!" className="text-lg" maxLength={80}
 />
 </div>

 {/* Sub-headline */}
 <div className="space-y-3">
 <Label htmlFor="formSubheadline" className="text-sm font-semibold text-foreground">
 Form Sub-headline
 </Label>
 <Textarea
 id="formSubheadline" value={currentDesign.formSubheadline}
 onChange={(e) => onDesignChange('formSubheadline', e.target.value)}
 placeholder="e.g., Fill out the form to get started." className="resize-none h-16" maxLength={150}
 />
 <p className="text-xs text-muted-foreground">Shown directly under the form headline. Leave blank to hide it.</p>
 </div>

 {/* Brand wordmark */}
 <div className="space-y-3 pt-4 border-t">
 <Label htmlFor="brandWordmark" className="text-sm font-semibold text-foreground">
 Brand Wordmark
 </Label>
 <Input
 id="brandWordmark" value={currentDesign.brandWordmark || ''}
 onChange={(e) => onDesignChange('brandWordmark', e.target.value)}
 placeholder="e.g., goodies.sg" maxLength={40}
 />
 <p className="text-xs text-muted-foreground">
 Large display name at the top of the page. Leave blank to show the campaign's customer domain (redeem.sg or mktr.sg).
 </p>
 </div>

 {/* Hero font */}
 <div className="space-y-3 pt-4 border-t">
 <Label className="text-sm font-semibold text-foreground">Hero Font</Label>
 <p className="text-xs text-muted-foreground -mt-1">
 Display typeface for the brand wordmark and the form headline.
 </p>
 <Select
 value={currentDesign.heroFont || DEFAULT_HERO_FONT}
 onValueChange={(value) => onDesignChange('heroFont', value)}
 >
 <SelectTrigger className="w-full">
 <SelectValue placeholder="Select a font"/>
 </SelectTrigger>
 <SelectContent>
 {HERO_FONTS.map((f) => (
 <SelectItem key={f.id} value={f.id}>
 <span style={{ fontFamily: f.stack, fontSize: 15 }}>{f.label}</span>
 </SelectItem>
 ))}
 </SelectContent>
 </Select>
 </div>

 {/* Hero story */}
 <div className="space-y-3 pt-4 border-t">
 <Label htmlFor="storyText" className="text-sm font-semibold text-foreground">
 Hero Story
 </Label>
 <Textarea
 id="storyText" value={currentDesign.storyText || ''}
 onChange={(e) => onDesignChange('storyText', e.target.value)}
 placeholder="Tell the customer what this is about. Leave a blank line between paragraphs." className="resize-none h-28" maxLength={1200}
 />
 <p className="text-xs text-muted-foreground">
 Narrative shown in the story card (only renders when there is hero media or story text). Separate
 paragraphs with a blank line.
 </p>
 <div className="space-y-1">
 <Label htmlFor="storyEmphasis" className="text-xs text-muted-foreground">Story emphasis line (optional)</Label>
 <Input
 id="storyEmphasis" value={currentDesign.storyEmphasis || ''}
 onChange={(e) => onDesignChange('storyEmphasis', e.target.value)}
 placeholder="e.g., Limited slots — register today." maxLength={160}
 />
 </div>
 </div>

 {/* Header Media */}
 <div className="space-y-3">
 <Label className="text-sm font-semibold text-foreground">Header Media</Label>

 <div className="bg-muted p-1 rounded-lg flex gap-1">
 {[
 { id: 'none', label: 'None' },
 { id: 'image', label: 'Image', icon: ImageIcon },
 { id: 'video', label: 'Video', icon: Video },
 ].map((opt) => (
 <button
 key={opt.id}
 type="button" onClick={() => onDesignChange('mediaType', opt.id)}
 className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center justify-center gap-1.5 ${
 currentDesign.mediaType === opt.id
 ? 'bg-card text-foreground shadow-sm'
 : 'text-muted-foreground hover:text-foreground dark:hover:text-muted-foreground'
 }`}
 >
 {opt.icon && <opt.icon className="w-3.5 h-3.5"/>}
 {opt.label}
 </button>
 ))}
 </div>

 {/* Image upload */}
 {currentDesign.mediaType === 'image' && (
 <div className="border-2 border-dashed border-border rounded-xl p-6 text-center hover:border-border transition-colors animate-in fade-in slide-in-from-top-2">
 {currentDesign.imageUrl ? (
 <div className="space-y-4">
 <div className="relative inline-block">
 <div className="w-40 h-24 overflow-hidden rounded-lg shadow-sm bg-muted">
 <img
 src={resolveImageUrl(currentDesign.imageUrl)}
 alt="Header preview" className="w-full h-full object-contain" onError={(e) => { e.target.style.display = 'none'; }}
 />
 </div>
 <Button
 variant="destructive" size="icon" aria-label="Remove header image" className="absolute -top-2 -right-2 w-6 h-6 rounded-full" onClick={() => onDesignChange('imageUrl', '')}
 >
 <Trash2 className="w-3 h-3" aria-hidden="true" />
 </Button>
 </div>
 <div className="space-y-2">
 <p className="text-sm font-medium text-foreground">Current Image</p>
 <p className="text-xs text-muted-foreground">Recommended: 1200x600px (2:1 ratio)</p>
 <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
 Replace Image
 </Button>
 </div>
 </div>
 ) : (
 <div className="space-y-3">
 <ImageIcon className="w-12 h-12 text-muted-foreground mx-auto"/>
 <div>
 <p className="text-sm font-medium text-foreground mb-1">Upload Header Image</p>
 <p className="text-xs text-muted-foreground">Recommended: 1200x600px (2:1 ratio), JPG or PNG</p>
 </div>
 <Button
 variant="outline" onClick={() => fileInputRef.current?.click()}
 disabled={uploading}
 className="mt-3" >
 {uploading ? (
 <><Loader2 className="w-4 h-4 mr-2 animate-spin"/>Uploading...</>
 ) : (
 <><Upload className="w-4 h-4 mr-2"/>Choose Image</>
 )}
 </Button>
 </div>
 )}
 <Input
 type="file" ref={fileInputRef}
 onChange={handleImageUpload}
 className=" hidden" accept="image/*" />
 </div>
 )}

 {/* Video — upload a clip (auto-converted to a muted, looping MP4) or paste a link */}
 {currentDesign.mediaType === 'video' && (
 <div className="space-y-3 animate-in fade-in slide-in-from-top-2">
 {currentDesign.videoUrl && !/youtube|youtu\.be/.test(currentDesign.videoUrl) ? (
 <div className="border-2 border-dashed border-border rounded-xl p-4 text-center space-y-3">
 <div className="w-40 h-24 mx-auto overflow-hidden rounded-lg bg-foreground">
 <video
 src={resolveImageUrl(currentDesign.videoUrl)}
 className="w-full h-full object-cover" muted loop autoPlay playsInline preload="metadata"
 />
 </div>
 <div className="flex gap-2 justify-center">
 <Button variant="outline" size="sm" onClick={() => videoInputRef.current?.click()} disabled={uploadingVideo}>
 {uploadingVideo ? (<><Loader2 className="w-3 h-3 mr-1 animate-spin"/>Optimizing…</>) : ('Replace')}
 </Button>
 <Button
 variant="ghost" size="sm" onClick={() => onDesignChange('videoUrl', '')}
 className="text-destructive hover:text-destructive" >
 <Trash2 className="w-3 h-3 mr-1"/> Remove
 </Button>
 </div>
 </div>
 ) : (
 <div className="border-2 border-dashed border-border rounded-xl p-6 text-center space-y-3">
 <Video className="w-10 h-10 text-muted-foreground mx-auto"/>
 <div>
 <p className="text-sm font-medium text-foreground mb-1">Upload a video</p>
 <p className="text-xs text-muted-foreground">{`MP4, MOV or WebM — auto-converted, muted & optimized for the hero. Up to ${MAX_UPLOAD_SIZE_MB}MB; keep it short for fast loading.`}</p>
 </div>
 <Button variant="outline" onClick={() => videoInputRef.current?.click()} disabled={uploadingVideo}>
 {uploadingVideo ? (<><Loader2 className="w-4 h-4 mr-2 animate-spin"/>Optimizing…</>) : (<><Upload className="w-4 h-4 mr-2"/>Choose video</>)}
 </Button>
 </div>
 )}

 <div className="relative">
 <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground"/>
 <Input
 value={currentDesign.videoUrl || ''}
 onChange={(e) => onDesignChange('videoUrl', e.target.value)}
 placeholder="…or paste a YouTube / video link" className="pl-10" />
 </div>
 <p className="text-xs text-muted-foreground">
 Uploaded videos autoplay muted &amp; loop in the hero (16:9). YouTube links show the standard player.
 </p>

 <Input
 type="file" ref={videoInputRef}
 onChange={handleVideoUpload}
 className="hidden" accept="video/*" />
 </div>
 )}
 </div>

 {/* Hero CTA label — only relevant when there is hero media */}
 {currentDesign.mediaType && currentDesign.mediaType !== 'none' && (
 <div className="space-y-3 pt-4 border-t animate-in fade-in slide-in-from-top-2">
 <Label htmlFor="heroCtaLabel" className="text-sm font-semibold text-foreground">
 Hero Button Label
 </Label>
 <Input
 id="heroCtaLabel" value={currentDesign.heroCtaLabel || ''}
 onChange={(e) => onDesignChange('heroCtaLabel', e.target.value)}
 placeholder="Get Started" maxLength={40}
 />
 <p className="text-xs text-muted-foreground">
 Button under the hero media that scrolls down to the form. Leave blank to hide it.
 </p>
 </div>
 )}

 {/* Submit button label */}
 <div className="space-y-3 pt-4 border-t">
 <Label htmlFor="ctaText" className="text-sm font-semibold text-foreground">
 Submit Button Label
 </Label>
 <Input
 id="ctaText" value={currentDesign.ctaText || ''}
 onChange={(e) => onDesignChange('ctaText', e.target.value)}
 placeholder="Submit Now" maxLength={40}
 />
 </div>

 {/* Footer */}
 <div className="space-y-3 pt-4 border-t">
 <Label htmlFor="regulatoryFooter" className="text-sm font-semibold text-foreground">
 Regulatory Footer
 </Label>
 <Textarea
 id="regulatoryFooter" value={currentDesign.regulatoryFooter || ''}
 onChange={(e) => onDesignChange('regulatoryFooter', e.target.value)}
 placeholder={brand.defaultRegulatory} className="resize-none h-28" maxLength={1000}
 />
 <p className="text-xs text-muted-foreground">Small print under the form. Leave blank to use the default.</p>
 <div className="space-y-1">
 <Label htmlFor="brandFooter" className="text-xs text-muted-foreground">Brand footer line</Label>
 <Input
 id="brandFooter" value={currentDesign.brandFooter || ''}
 onChange={(e) => onDesignChange('brandFooter', e.target.value)}
 placeholder={brand.defaultPoweredBy} maxLength={80}
 />
 </div>
 </div>

 {/* OTP Settings */}
 <div className="space-y-3 pt-4 border-t">
 <Label className="text-sm font-semibold text-foreground">Verification Method</Label>
 <p className="text-xs text-muted-foreground -mt-1">Choose how users receive their One-Time Password (OTP)</p>
 <Select
 value={currentDesign.otpChannel || 'sms'}
 onValueChange={(value) => onDesignChange('otpChannel', value)}
 >
 <SelectTrigger className="w-full">
 <SelectValue placeholder="Select OTP Channel"/>
 </SelectTrigger>
 <SelectContent>
 <SelectItem value="sms">SMS (via AWS SNS)</SelectItem>
 <SelectItem value="whatsapp">WhatsApp (via Meta)</SelectItem>
 </SelectContent>
 </Select>
 {currentDesign.otpChannel === 'whatsapp' && (
 <div className="flex items-center gap-2 text-xs text-warning bg-warning/10 p-2 rounded border">
 <AlertCircle className="w-4 h-4"/>
 <span>Ensure your Meta credentials are configured in .env</span>
 </div>
 )}
 </div>

 {/* Form Fields */}
 <div className="space-y-3 pt-4 border-t">
 <Label className="text-sm font-semibold text-foreground">Form Fields</Label>
 <p className="text-xs text-muted-foreground -mt-1">Configure which fields appear and whether they're required</p>
 <div className="space-y-2">
 {/* Name + Email + Phone are always shown. Phone+OTP is the lead pipeline's
 identity/dedup key, so it cannot be hidden. */}
 <div className="flex items-center justify-between py-1">
 <div className="flex items-center space-x-2 text-foreground">
 <Lock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
 <span className="text-sm">Phone Number</span>
 </div>
 <span className="text-xs text-muted-foreground">Always shown · Required for OTP</span>
 </div>
 <FieldToggle
 id="dob" label="Date of Birth" checked={currentDesign.visibleFields?.dob !== false}
 onChange={(checked) => onDesignChange('visibleFields', { ...currentDesign.visibleFields, dob: checked })}
 requiredChecked={currentDesign.requiredFields?.dob === true}
 onRequiredChange={(checked) => onDesignChange('requiredFields', { ...currentDesign.requiredFields, dob: checked })}
 />
 <FieldToggle
 id="postal_code" label="Postal Code" checked={currentDesign.visibleFields?.postal_code !== false}
 onChange={(checked) => onDesignChange('visibleFields', { ...currentDesign.visibleFields, postal_code: checked })}
 requiredChecked={currentDesign.requiredFields?.postal_code === true}
 onRequiredChange={(checked) => onDesignChange('requiredFields', { ...currentDesign.requiredFields, postal_code: checked })}
 />
 <FieldToggle
 id="education_level" label="Highest Education" checked={currentDesign.visibleFields?.education_level === true}
 onChange={(checked) => onDesignChange('visibleFields', { ...currentDesign.visibleFields, education_level: checked })}
 requiredChecked={currentDesign.requiredFields?.education_level === true}
 onRequiredChange={(checked) => onDesignChange('requiredFields', { ...currentDesign.requiredFields, education_level: checked })}
 />
 <FieldToggle
 id="monthly_income" label="Monthly Income" checked={currentDesign.visibleFields?.monthly_income === true}
 onChange={(checked) => onDesignChange('visibleFields', { ...currentDesign.visibleFields, monthly_income: checked })}
 requiredChecked={currentDesign.requiredFields?.monthly_income === true}
 onRequiredChange={(checked) => onDesignChange('requiredFields', { ...currentDesign.requiredFields, monthly_income: checked })}
 />
 </div>
 </div>

 {/* Eligibility — SG/PR screening gate */}
        <div className="space-y-3 pt-4 border-t">
          <Label className="text-sm font-semibold text-foreground">Eligibility</Label>
          <p className="text-xs text-muted-foreground -mt-1">Screen visitors before the form appears.</p>
          <div className="flex items-center justify-between gap-3 py-1">
            <div className="flex flex-col">
              <span className="text-sm text-foreground">SG / PR only</span>
              <span className="text-xs text-muted-foreground">Adds a Singapore Citizen / PR question before the form — only Yes reveals it.</span>
            </div>
            <Switch
              aria-label="SG / PR only"
              checked={currentDesign.sgPrOnly === true}
              onCheckedChange={(checked) => onDesignChange('sgPrOnly', checked)}
            />
          </div>
          <div className="flex items-center justify-between gap-3 py-1">
            <div className="flex flex-col">
              <span className="text-sm text-foreground">Exclude financial consultants</span>
              <span className="text-xs text-muted-foreground">Adds an advisor / consultant question — answering Yes blocks the form.</span>
            </div>
            <Switch
              aria-label="Exclude financial consultants"
              checked={currentDesign.excludeAdvisors === true}
              onCheckedChange={(checked) => onDesignChange('excludeAdvisors', checked)}
            />
          </div>
        </div>

        {/* Compliance — DNC check at submit */}
        <div className="space-y-3 pt-4 border-t">
          <Label className="text-sm font-semibold text-foreground">Compliance</Label>
          <p className="text-xs text-muted-foreground -mt-1">Runs automatically when the prospect submits.</p>
          <div className="flex items-center justify-between gap-3 py-1">
            <div className="flex flex-col">
              <span className="text-sm text-foreground">Check Do Not Call (DNC) at submit</span>
              <span className="text-xs text-muted-foreground">Checks each number against Singapore&apos;s DNC Registry. If the number is registered, the prospect must give explicit consent before they can submit.</span>
            </div>
            <Switch
              aria-label="Check Do Not Call (DNC) at submit"
              checked={currentDesign.dncCheckAtSubmit === true}
              onCheckedChange={(checked) => onDesignChange('dncCheckAtSubmit', checked)}
            />
          </div>
        </div>

        {/* Terms & Conditions */}
 <div className="space-y-3 pt-4 border-t">
 <Label className="text-sm font-semibold text-foreground">Terms & Conditions</Label>
 <p className="text-xs text-muted-foreground -mt-1">Customize the legal text displayed in the consent dialog.</p>
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
 <SelectValue placeholder="Select a template..."/>
 </SelectTrigger>
 <SelectContent>
 {Object.values(TC_TEMPLATES).map(t => (
 <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
 ))}
 </SelectContent>
 </Select>
 <div className="space-y-1">
 <Label className="text-xs text-muted-foreground">Custom Content (HTML supported)</Label>
 <Textarea
 value={currentDesign.termsContent || ''}
 onChange={(e) => onDesignChange('termsContent', e.target.value)}
 placeholder="<div>...</div>" className="font-mono text-xs h-64" maxLength={10000}
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
 type="checkbox" id={`field_${id}`}
 checked={checked}
 onChange={(e) => onChange(e.target.checked)}
 className="h-4 w-4 rounded border-border text-primary focus:ring-ring" />
 <Label htmlFor={`field_${id}`} className="text-sm text-foreground font-normal">{label}</Label>
 </div>
 {fixedRequired ? (
 <span className="text-xs text-muted-foreground">{fixedRequired}</span>
 ) : checked && onRequiredChange ? (
 <label className="flex items-center space-x-1 text-xs text-muted-foreground cursor-pointer">
 <input
 type="checkbox" checked={requiredChecked}
 onChange={(e) => onRequiredChange(e.target.checked)}
 className="h-3 w-3 rounded border-border text-primary focus:ring-ring" />
 <span>Required</span>
 </label>
 ) : null}
 </div>
 );
}
