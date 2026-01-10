import { useState, useEffect, useRef, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { UploadFile } from "@/api/integrations";
import { apiClient } from "@/api/client";
import {
  Upload,
  Loader2,
  Image as ImageIcon,
  Type,
  Palette,
  Layout,
  Eye,
  Trash2,
  CheckCircle2, // Added CheckCircle2 for verification status
  X // Added X for OTP section close button
} from "lucide-react";
import MarketingConsentDialog from "@/components/legal/MarketingConsentDialog";

const colorPresets = [
  { name: "Ocean Blue", color: "#3B82F6" },
  { name: "Emerald", color: "#10B981" },
  { name: "Purple", color: "#8B5CF6" },
  { name: "Rose", color: "#F43F5E" },
  { name: "Orange", color: "#F97316" },
  { name: "Indigo", color: "#6366F1" },
  { name: "Slate", color: "#64748B" },
  { name: "Red", color: "#EF4444" }
];

export default function DesignEditor({ campaign, onSave, previewMode }) {
  const [activeTab, setActiveTab] = useState('content');

  // Resolve image URL against API origin so /uploads/... loads from backend
  const resolveImageUrl = (url) => {
    if (!url) return '';
    if (/^https?:\/\//i.test(url)) return url;
    const apiOrigin = apiClient.baseURL.replace(/\/?api\/?$/, "");
    return `${apiOrigin}${url.startsWith('/') ? url : '/' + url}`;
  };

  // Use useMemo to prevent design object from changing on every render
  const design = useMemo(() => campaign.design_config || {}, [campaign.design_config]);

  const [currentDesign, setCurrentDesign] = useState({
    formHeadline: design.formHeadline || "",
    formSubheadline: design.formSubheadline || "",
    imageUrl: design.imageUrl || "",
    themeColor: design.themeColor || "#3B82F6",
    backgroundStyle: design.backgroundStyle || "gradient",
    alignment: design.alignment || "center",
    formWidth: design.formWidth || 400,
    spacing: design.spacing || "normal",
    headlineSize: design.headlineSize || 20,
    visibleFields: design.visibleFields || { phone: true, dob: true, postal_code: true }
  });

  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [lastSavedTime, setLastSavedTime] = useState(null);
  const [timeSinceLastSave, setTimeSinceLastSave] = useState(null);
  const fileInputRef = useRef(null);
  const saveTimeoutRef = useRef(null);

  // Update timer every second to show "saved X seconds ago"
  useEffect(() => {
    if (lastSavedTime) {
      const interval = setInterval(() => {
        const secondsAgo = Math.floor((Date.now() - lastSavedTime) / 1000);
        setTimeSinceLastSave(secondsAgo);
      }, 1000);

      return () => clearInterval(interval);
    }
  }, [lastSavedTime]);

  // Update design state when campaign.design_config changes (e.g., campaign prop updates)
  useEffect(() => {
    // Sync internal state with external prop changes.
    // 'design' will always be an object, so `if (design)` is always true and can be omitted.
    setCurrentDesign({
      formHeadline: design.formHeadline || "",
      formSubheadline: design.formSubheadline || "",
      imageUrl: design.imageUrl || "",
      themeColor: design.themeColor || "#3B82F6",
      backgroundStyle: design.backgroundStyle || "gradient",
      alignment: design.alignment || "center",
      formWidth: design.formWidth || 400,
      spacing: design.spacing || "normal",
      headlineSize: design.headlineSize || 20,
      visibleFields: design.visibleFields || { phone: true, dob: true, postal_code: true }
    });
    // When the external campaign design changes, assume it's the latest saved state.
    setHasUnsavedChanges(false);
    setLastSavedTime(Date.now());
  }, [design]);

  const performSave = async (designData) => {
    setSaving(true);
    try {
      await onSave(designData);
      setHasUnsavedChanges(false);
      setLastSavedTime(Date.now());
    } catch (error) {
      console.error('Error saving design:', error);
      // Optionally, set an error state here to inform the user
    } finally {
      setSaving(false);
    }
  };

  const handleDesignChange = (key, value) => {
    const newDesign = {
      ...currentDesign,
      [key]: value
    };
    setCurrentDesign(newDesign);
    setHasUnsavedChanges(true); // Mark that there are unsaved changes

    // Clear any existing timeout to debounce
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Set a new timeout for 30 seconds to trigger auto-save
    saveTimeoutRef.current = setTimeout(() => {
      performSave(newDesign); // Use the newDesign object
    }, 30000);
  };

  const handleManualSave = () => {
    // Clear any pending auto-save timeout, as we are saving manually now
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null; // Reset the ref
    }
    performSave(currentDesign); // Save the current state immediately
  };

  // Add state for interactive preview
  const [previewFormData, setPreviewFormData] = useState({
    name: '',
    phone: '',
    email: '',
    date_of_birth: '',
    postal_code: '',
    education_level: '',
    monthly_income: ''
  });

  const [previewPhoneVerification, setPreviewPhoneVerification] = useState({
    isVerified: false,
    isSending: false,
    isVerifying: false,
    otpCode: '',
    showOtpInput: false,
    canResend: true,
    resendCooldown: 0,
    error: null,
    hasSentCode: false
  });

  const [previewErrors, setPreviewErrors] = useState({});
  const [consentOpen, setConsentOpen] = useState(false);

  // Effect for resend cooldown timer
  useEffect(() => {
    if (previewPhoneVerification.resendCooldown > 0) {
      const timer = setInterval(() => {
        setPreviewPhoneVerification(prev => {
          if (prev.resendCooldown > 1) {
            return { ...prev, resendCooldown: prev.resendCooldown - 1 };
          } else {
            clearInterval(timer);
            return { ...prev, resendCooldown: 0, canResend: true };
          }
        });
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [previewPhoneVerification.resendCooldown]);


  const handleImageUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    setUploading(true);
    try {
      const result = await UploadFile(file, 'image');
      // Store the relative URL returned by backend
      const relativeUrl = result?.file?.url || '';
      handleDesignChange('imageUrl', relativeUrl);
    } catch (error) {
      console.error('Error uploading image:', error);
    }
    setUploading(false);

    // Reset the file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const formatPhoneDisplay = (digits) => {
    if (digits.length <= 4) return digits;
    return `${digits.slice(0, 4)} ${digits.slice(4)}`;
  };

  const handlePreviewPhoneChange = (value) => {
    // Remove all non-digits and spaces, then limit to 8 digits
    const digits = value.replace(/\D/g, '').slice(0, 8);

    // Valid Singapore mobile number prefixes
    const sgPrefixes = ['9', '8', '6', '3'];
    if (digits.length > 0 && !sgPrefixes.includes(digits[0])) {
      setPreviewPhoneVerification(prev => ({ ...prev, error: 'Singapore numbers start with 9, 8, 6, or 3' }));
    } else {
      setPreviewPhoneVerification(prev => ({ ...prev, error: null }));
    }

    // If phone number changes, reset verification status
    if (previewFormData.phone !== digits) {
      setPreviewPhoneVerification(prev => ({ ...prev, isVerified: false, showOtpInput: false, otpCode: '' }));
    }

    setPreviewFormData(prev => ({ ...prev, phone: digits }));
  };

  const handlePreviewSendOTP = async () => {
    if (previewFormData.phone.length !== 8) {
      setPreviewPhoneVerification(prev => ({ ...prev, error: 'Please enter a valid 8-digit phone number.' }));
      return;
    }
    if (previewPhoneVerification.error) return; // Don't send if there's a format error

    setPreviewPhoneVerification(prev => ({ ...prev, isSending: true, error: null }));

    try {
      // Call backend to send code via Twilio Verify
      await apiClient.post('/verify/send', { phone: previewFormData.phone, countryCode: '+65' });

      setPreviewPhoneVerification(prev => ({
        ...prev,
        isSending: false,
        showOtpInput: true,
        canResend: false,
        resendCooldown: 20, // Start cooldown timer
        hasSentCode: true
      }));
    } catch (error) {
      console.error("Error sending OTP:", error);
      setPreviewPhoneVerification(prev => ({
        ...prev,
        isSending: false,
        error: "Failed to send code. Please try again."
      }));
    }
  };

  const tabs = [
    { id: 'content', label: 'Content', icon: Type },
    { id: 'design', label: 'Design', icon: Palette },
    { id: 'layout', label: 'Layout', icon: Layout }
  ];

  const calculateAge = (dobString) => {
    if (!dobString || dobString.length !== 10) return null;

    const parts = dobString.split('/');
    if (parts.length !== 3) return null;

    const day = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10);
    const year = parseInt(parts[2], 10);

    // Basic validation for date parts
    if (isNaN(day) || isNaN(month) || isNaN(year) || day < 1 || day > 31 || month < 1 || month > 12) return null;

    const today = new Date();
    const birthDate = new Date(year, month - 1, day);

    // Check if the date is valid (e.g., Feb 30th)
    if (birthDate.getFullYear() !== year || birthDate.getMonth() !== month - 1 || birthDate.getDate() !== day) {
      return null;
    }

    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();

    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }

    return age;
  };

  const validatePreviewAge = (dob) => {
    if (!campaign) return null;

    const age = calculateAge(dob);
    if (age === null) return null; // Date format or parsing error

    // Only apply validation if min_age or max_age is defined in campaign
    const hasMinAge = campaign.min_age !== undefined && campaign.min_age !== null;
    const hasMaxAge = campaign.max_age !== undefined && campaign.max_age !== null;

    if (hasMinAge && age < campaign.min_age) {
      return `Must be at least ${campaign.min_age} years old`;
    }

    if (hasMaxAge && age > campaign.max_age) {
      return `Only available for ages ${campaign.min_age ? campaign.min_age + '-' : ''}${campaign.max_age}`;
    }

    return null;
  };

  const handlePreviewInputChange = (field, value) => {
    setPreviewFormData(prev => ({ ...prev, [field]: value }));

    // Live validation for preview
    setTimeout(() => {
      let error = null;
      switch (field) {
        case 'email':
          if (value.length > 0 && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
            error = 'Please enter a valid email address';
          }
          break;
        case 'postal_code':
          if (value.length > 0 && value.length !== 6) {
            error = 'Postal code must be 6 digits';
          }
          break;
      }

      if (error) {
        setPreviewErrors(prev => ({ ...prev, [field]: error }));
      } else {
        setPreviewErrors(prev => ({ ...prev, [field]: null }));
      }
    }, 300);
  };

  const handlePreviewDOBChange = (value) => {
    let cleaned = value.replace(/\D/g, '');
    let formatted = '';

    for (let i = 0; i < cleaned.length && i < 8; i++) {
      if (i === 2 || i === 4) formatted += '/';
      formatted += cleaned[i];
    }

    setPreviewFormData(prev => ({ ...prev, date_of_birth: formatted }));

    // Validate DOB immediately when complete
    if (formatted.length === 10) {
      const ageError = validatePreviewAge(formatted);
      if (ageError) {
        setPreviewErrors(prev => ({ ...prev, date_of_birth: ageError }));
      } else {
        setPreviewErrors(prev => ({ ...prev, date_of_birth: null }));
      }
    } else if (formatted.length > 0) {
      setPreviewErrors(prev => ({ ...prev, date_of_birth: null }));
    }
  };

  return (
    <div className="flex flex-col lg:flex-row gap-6 p-6">
      <div className="lg:w-1/2">
        <Card className="shadow-lg border-0 bg-white">
          <CardHeader className="bg-gradient-to-r from-blue-50 to-purple-50 border-b">
            <CardTitle className="text-xl font-bold text-gray-900">Design Studio</CardTitle>
            <div className="flex items-center gap-2 mt-4">
              {tabs.map((tab) => (
                <Button
                  key={tab.id}
                  variant={activeTab === tab.id ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 ${activeTab === tab.id
                    ? "bg-white shadow-sm text-blue-700"
                    : "text-gray-600 hover:text-gray-900"
                    }`}
                >
                  <tab.icon className="w-4 h-4" />
                  {tab.label}
                </Button>
              ))}
            </div>
          </CardHeader>

          <CardContent className="p-6">
            {activeTab === 'content' && (
              <div className="space-y-6">
                <div className="space-y-3">
                  <Label htmlFor="formHeadline" className="text-sm font-semibold text-gray-700">
                    Form Headline
                  </Label>
                  <Input
                    id="formHeadline"
                    value={currentDesign.formHeadline}
                    onChange={(e) => handleDesignChange('formHeadline', e.target.value)}
                    placeholder="e.g., Get Started Now!"
                    className="text-lg"
                    maxLength={80}
                  />
                </div>

                <div className="space-y-3">
                  <Label htmlFor="formSubheadline" className="text-sm font-semibold text-gray-700">
                    Form Sub-headline
                  </Label>
                  <Textarea
                    id="formSubheadline"
                    value={currentDesign.formSubheadline}
                    onChange={(e) => handleDesignChange('formSubheadline', e.target.value)}
                    placeholder="e.g., Fill out the form to get started."
                    className="resize-none h-16"
                    maxLength={150}
                  />
                </div>

                <div className="space-y-3">
                  <Label className="text-sm font-semibold text-gray-700">Header Image</Label>
                  <div className="border-2 border-dashed border-gray-200 rounded-xl p-6 text-center hover:border-gray-300 transition-colors">
                    {currentDesign.imageUrl ? (
                      <div className="space-y-4">
                        <div className="relative inline-block">
                          <div className="w-40 h-24 overflow-hidden rounded-lg shadow-sm bg-gray-100">
                            <img
                              src={resolveImageUrl(currentDesign.imageUrl)}
                              alt="Header preview"
                              className="w-full h-full object-contain"
                              onError={(e) => {
                                console.error('Image failed to load:', resolveImageUrl(currentDesign.imageUrl));
                                e.target.style.display = 'none';
                              }}
                            />
                          </div>
                          <Button
                            variant="destructive"
                            size="icon"
                            className="absolute -top-2 -right-2 w-6 h-6 rounded-full"
                            onClick={() => handleDesignChange('imageUrl', '')}
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                        <div className="space-y-2">
                          <p className="text-sm font-medium text-gray-700">Current Image</p>
                          <p className="text-xs text-gray-500">Recommended: 1200x600px (2:1 ratio)</p>
                          <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                            Replace Image
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <ImageIcon className="w-12 h-12 text-gray-400 mx-auto" />
                        <div>
                          <p className="text-sm font-medium text-gray-700 mb-1">Upload Header Image</p>
                          <p className="text-xs text-gray-500">Recommended: 1200x600px (2:1 ratio), JPG or PNG</p>
                        </div>
                        <Button
                          variant="outline"
                          onClick={() => fileInputRef.current?.click()}
                          disabled={uploading}
                          className="mt-3"
                        >
                          {uploading ? (
                            <>
                              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                              Uploading...
                            </>
                          ) : (
                            <>
                              <Upload className="w-4 h-4 mr-2" />
                              Choose Image
                            </>
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
                </div>



                {/* Form Fields Selection */}
                <div className="space-y-3 pt-4 border-t">
                  <Label className="text-sm font-semibold text-gray-700">Visible Fields</Label>
                  <div className="space-y-3">
                    <div className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        id="field_phone"
                        checked={currentDesign.visibleFields?.phone !== false}
                        onChange={(e) => handleDesignChange('visibleFields', { ...currentDesign.visibleFields, phone: e.target.checked })}
                        className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <Label htmlFor="field_phone" className="text-sm text-gray-700 font-normal">Phone Number (Required for OTP)</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        id="field_dob"
                        checked={currentDesign.visibleFields?.dob !== false}
                        onChange={(e) => handleDesignChange('visibleFields', { ...currentDesign.visibleFields, dob: e.target.checked })}
                        className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <Label htmlFor="field_dob" className="text-sm text-gray-700 font-normal">Date of Birth</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        id="field_postal"
                        checked={currentDesign.visibleFields?.postal_code !== false}
                        onChange={(e) => handleDesignChange('visibleFields', { ...currentDesign.visibleFields, postal_code: e.target.checked })}
                        className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <Label htmlFor="field_postal" className="text-sm text-gray-700 font-normal">Postal Code</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        id="field_education"
                        checked={currentDesign.visibleFields?.education_level === true}
                        onChange={(e) => handleDesignChange('visibleFields', { ...currentDesign.visibleFields, education_level: e.target.checked })}
                        className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <Label htmlFor="field_education" className="text-sm text-gray-700 font-normal">Highest Education Level</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        id="field_income"
                        checked={currentDesign.visibleFields?.monthly_income === true}
                        onChange={(e) => handleDesignChange('visibleFields', { ...currentDesign.visibleFields, monthly_income: e.target.checked })}
                        className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <Label htmlFor="field_income" className="text-sm text-gray-700 font-normal">Monthly Income</Label>
                    </div>
                  </div>

                </div>
              </div>
            )}


            {activeTab === 'design' && (
              <div className="space-y-6">
                <div className="space-y-3">
                  <Label className="text-sm font-semibold text-gray-700">Theme Color</Label>
                  <div className="space-y-4">
                    <div className="grid grid-cols-4 gap-3">
                      {colorPresets.map((preset) => (
                        <button
                          key={preset.name}
                          onClick={() => handleDesignChange('themeColor', preset.color)}
                          className={`relative w-full h-12 rounded-lg border-2 transition-all ${currentDesign.themeColor === preset.color
                            ? 'border-gray-400 shadow-md'
                            : 'border-gray-200 hover:border-gray-300'
                            }`}
                          style={{ backgroundColor: preset.color }}
                        >
                          {currentDesign.themeColor === preset.color && (
                            <div className="absolute inset-0 flex items-center justify-center">
                              <div className="w-6 h-6 bg-white rounded-full flex items-center justify-center">
                                <div className="w-2 h-2 bg-gray-800 rounded-full"></div>
                              </div>
                            </div>
                          )}
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-3 pt-2 border-t">
                      <Label className="text-sm">Custom:</Label>
                      <Input
                        type="color"
                        value={currentDesign.themeColor}
                        onChange={(e) => handleDesignChange('themeColor', e.target.value)}
                        className="w-16 h-10 p-1 rounded-lg border"
                      />
                      <Badge variant="outline" className="font-mono text-xs">
                        {currentDesign.themeColor}
                      </Badge>
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <Label className="text-sm font-semibold text-gray-700">Headline Text Size</Label>
                  <div className="space-y-4">
                    <Slider
                      value={[currentDesign.headlineSize || 20]}
                      onValueChange={(value) => handleDesignChange('headlineSize', value[0])}
                      max={36}
                      min={16}
                      step={2}
                      className="w-full"
                    />
                    <div className="flex justify-between text-sm text-gray-500">
                      <span>Small (16px)</span>
                      <span className="font-medium">{currentDesign.headlineSize || 20}px</span>
                      <span>Large (36px)</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'layout' && (
              <div className="space-y-6">
                <div className="space-y-3">
                  <Label className="text-sm font-semibold text-gray-700">
                    Form Width
                  </Label>
                  <div className="space-y-4">
                    <Slider
                      value={[currentDesign.formWidth || 400]}
                      onValueChange={(value) => handleDesignChange('formWidth', value[0])}
                      max={600}
                      min={300}
                      step={20}
                      className="w-full"
                    />
                    <div className="flex justify-between text-sm text-gray-500">
                      <span>Narrow (300px)</span>
                      <span className="font-medium">{currentDesign.formWidth || 400}px</span>
                      <span>Wide (600px)</span>
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <Label className="text-sm font-semibold text-gray-700">
                    Vertical Spacing
                  </Label>
                  <Select
                    value={currentDesign.spacing || 'normal'}
                    onValueChange={(value) => handleDesignChange('spacing', value)}
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
            )}

            <div className="pt-6 border-t mt-6">
              <Button
                onClick={handleManualSave}
                disabled={saving || !hasUnsavedChanges}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400"
              >
                {saving ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    Save Design
                    {hasUnsavedChanges && (
                      <span className="ml-2 w-2 h-2 bg-orange-400 rounded-full animate-pulse"></span>
                    )}
                  </>
                )}
              </Button>

              {/* Save Status */}
              <div className="mt-2 text-center">
                {saving ? (
                  <p className="text-sm text-blue-600">Saving changes...</p>
                ) : hasUnsavedChanges ? (
                  <p className="text-sm text-orange-600">Unsaved changes</p>
                ) : lastSavedTime ? (
                  <p className="text-sm text-green-600">
                    Saved {timeSinceLastSave === 0 ? 'just now' :
                      timeSinceLastSave === 1 ? '1 second ago' :
                        timeSinceLastSave < 60 ? `${timeSinceLastSave} seconds ago` :
                          timeSinceLastSave < 120 ? '1 minute ago' :
                            `${Math.floor(timeSinceLastSave / 60)} minutes ago`}
                  </p>
                ) : (
                  <p className="text-sm text-gray-500">Make changes to auto-save</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Live Preview Section */}
      <div className="lg:w-1/2">
        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Eye className="w-5 h-5" />
              Interactive Preview
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            <div className="bg-gray-100 rounded-lg overflow-hidden">
              <div className="max-w-sm mx-auto bg-white shadow-lg rounded-lg overflow-hidden">

                {/* Header Section */}
                {/* Adjusted to make image/placeholder fill the entire header container, which now defines its height and rounding */}
                <div className="bg-gray-50 relative h-48 rounded-t-lg overflow-hidden">
                  {currentDesign.imageUrl ? (
                    <div className="absolute inset-0 w-full h-full">
                      <img
                        src={resolveImageUrl(currentDesign.imageUrl)}
                        alt="Campaign header"
                        className="w-full h-full object-contain"
                        onError={(e) => {
                          console.error('Image failed to load:', resolveImageUrl(currentDesign.imageUrl));
                          e.target.style.display = 'none';
                        }}
                      />
                    </div>
                  ) : (
                    <div className="w-full h-full bg-gray-200 flex items-center justify-center">
                      <div className="text-center">
                        <div className="w-16 h-16 bg-gray-300 rounded-lg mx-auto mb-3"></div>
                        <p className="text-gray-500 text-sm font-medium">Header Image</p>
                        <p className="text-gray-400 text-xs">Upload an image</p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Form Content */}
                <div className="px-6 py-6 bg-white">
                  <div className="text-center mb-6">
                    {currentDesign.formHeadline && (
                      <h1
                        className="font-semibold text-gray-900 mb-1 leading-tight"
                        style={{ fontSize: `${(currentDesign.headlineSize || 20)}px` }}
                      >
                        {currentDesign.formHeadline}
                      </h1>
                    )}
                    {currentDesign.formSubheadline && (
                      <p className="text-gray-500 text-sm">
                        {currentDesign.formSubheadline}
                      </p>
                    )}
                    {!currentDesign.formHeadline && !currentDesign.formSubheadline && (
                      <div className="text-center py-4">
                        <p className="text-gray-400 text-sm">Add headline and subheadline</p>
                      </div>
                    )}
                  </div>

                  <div className="space-y-3">

                    {/* Full Name */}
                    <div>
                      <label className="block text-gray-700 text-sm font-medium mb-2">
                        Full Name
                      </label>
                      <div className="relative">
                        <input
                          type="text"
                          value={previewFormData.name}
                          onChange={(e) => setPreviewFormData(prev => ({ ...prev, name: e.target.value }))}
                          placeholder="John Tan"
                          className={`w-full h-11 bg-gray-50 border border-gray-200 rounded-md px-3 text-gray-900 text-sm placeholder:text-gray-400 focus:outline-none focus:bg-white focus:ring-1 focus:ring-gray-300 transition-all ${previewFormData.name.trim().length >= 2 ? 'pr-10' : ''}`}
                        />
                        {previewFormData.name.trim().length >= 2 && (
                          <CheckCircle2 className="absolute right-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-green-500" />
                        )}
                      </div>
                    </div>








                    {/* Phone Number */}
                    {(currentDesign.visibleFields?.phone !== false) && (
                      <div>
                        <label className="block text-gray-700 text-sm font-medium mb-2">
                          Phone Number
                        </label>
                        <div className="grid grid-cols-12 gap-2">
                          <div className="col-span-8 relative">
                            <div className="flex h-11 bg-gray-50 rounded-md border border-gray-200 overflow-hidden focus-within:bg-white focus-within:ring-1 focus-within:ring-gray-300 transition-all">
                              <div className="px-3 bg-gray-100 flex items-center border-r border-gray-200 gap-1">
                                <span className="text-sm">🇸🇬</span>
                                <span className="text-gray-600 text-sm font-medium">+65</span>
                              </div>
                              <input
                                type="tel"
                                value={formatPhoneDisplay(previewFormData.phone)}
                                onChange={(e) => handlePreviewPhoneChange(e.target.value)}
                                placeholder="9123 4567"
                                className="bg-transparent border-0 focus:ring-0 focus:outline-none h-full px-3 text-sm flex-1 placeholder:text-gray-400"
                                maxLength={9} // 8 digits + 1 space
                                disabled={previewPhoneVerification.isVerified}
                              />
                              {previewFormData.phone.length === 8 && previewPhoneVerification.isVerified && (
                                <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                                  <CheckCircle2 className="w-4 h-4 text-green-500" />
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="col-span-4">
                            {!previewPhoneVerification.isVerified ? (
                              <button
                                type="button"
                                onClick={handlePreviewSendOTP}
                                disabled={
                                  previewPhoneVerification.isSending ||
                                  previewFormData.phone.length !== 8 ||
                                  previewPhoneVerification.error ||
                                  (previewPhoneVerification.hasSentCode && !previewPhoneVerification.canResend)
                                }
                                className="w-full h-11 bg-gray-900 hover:bg-gray-800 text-white text-sm font-medium disabled:opacity-50 rounded-md transition-colors flex items-center justify-center"
                              >
                                {previewPhoneVerification.isSending ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : !previewPhoneVerification.hasSentCode ? (
                                  'Verify'
                                ) : !previewPhoneVerification.canResend ? (
                                  `Resend (${previewPhoneVerification.resendCooldown}s)`
                                ) : (
                                  'Resend'
                                )}
                              </button>
                            ) : (
                              <div className="w-full h-11 bg-green-50 border border-green-200 rounded-md flex items-center justify-center">
                                <CheckCircle2 className="w-4 h-4 text-green-600" />
                              </div>
                            )}
                          </div>
                        </div>
                        {previewPhoneVerification.error && (
                          <p className="text-red-500 text-xs mt-1">{previewPhoneVerification.error}</p>
                        )}

                        {/* Sliding OTP Section */}
                        <div className={`transition-all duration-300 ease-out overflow-hidden ${previewPhoneVerification.showOtpInput ? 'max-h-48 opacity-100 mt-3' : 'max-h-0 opacity-0'
                          }`}>
                          <div className="p-4 bg-gray-50 rounded-md border border-gray-200">
                            <div className="flex items-center justify-between mb-3">
                              <div>
                                <h4 className="font-medium text-gray-900 text-sm">Enter Code</h4>
                                <p className="text-xs text-gray-500">Sent to +65 {formatPhoneDisplay(previewFormData.phone)}</p>
                              </div>
                              <button
                                type="button"
                                className="text-gray-400 hover:text-gray-600 p-1"
                                onClick={() => setPreviewPhoneVerification(prev => ({ ...prev, showOtpInput: false }))}
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                            <div className="flex gap-2">
                              <input
                                type="text"
                                maxLength={6}
                                value={previewPhoneVerification.otpCode}
                                onChange={(e) => setPreviewPhoneVerification(prev => ({
                                  ...prev,
                                  otpCode: e.target.value.replace(/\D/g, '')
                                }))}
                                placeholder="123456"
                                className="flex-1 h-11 bg-white border border-gray-200 rounded-md px-3 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-300 text-center tracking-widest"
                              />
                              <button
                                type="button"
                                onClick={async () => {
                                  if (previewPhoneVerification.otpCode.length !== 6) return;
                                  setPreviewPhoneVerification(prev => ({ ...prev, isVerifying: true, error: null }));
                                  try {
                                    const resp = await apiClient.post('/verify/check', {
                                      phone: previewFormData.phone,
                                      code: previewPhoneVerification.otpCode,
                                      countryCode: '+65'
                                    });
                                    const ok = resp?.data?.verified;
                                    if (ok) {
                                      setPreviewPhoneVerification(prev => ({
                                        ...prev,
                                        isVerified: true,
                                        isVerifying: false,
                                        showOtpInput: false,
                                        error: null
                                      }));
                                    } else {
                                      setPreviewPhoneVerification(prev => ({
                                        ...prev,
                                        isVerifying: false,
                                        error: 'Invalid code. Please try again.'
                                      }));
                                    }
                                  } catch (e) {
                                    console.error('Verify failed:', e);
                                    setPreviewPhoneVerification(prev => ({
                                      ...prev,
                                      isVerifying: false,
                                      error: 'Verification failed. Please try again.'
                                    }));
                                  }
                                }}
                                disabled={previewPhoneVerification.otpCode.length !== 6 || previewPhoneVerification.isVerifying}
                                className="h-11 px-6 bg-gray-900 hover:bg-gray-800 text-white rounded-md text-sm font-medium disabled:opacity-50 transition-colors flex items-center justify-center"
                              >
                                {previewPhoneVerification.isVerifying ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                  'Confirm'
                                )}
                              </button>
                            </div>
                            {/* Resend link removed; cooldown handled on the primary button */}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Email */}
                    <div>
                      <label className="block text-gray-700 text-sm font-medium mb-2">
                        Email
                      </label>
                      <div className="relative">
                        <input
                          type="email"
                          value={previewFormData.email}
                          onChange={(e) => handlePreviewInputChange('email', e.target.value)}
                          placeholder="you@example.com"
                          className={`w-full h-11 bg-gray-50 border ${previewErrors.email ? 'border-red-300' : 'border-gray-200'} rounded-md px-3 text-gray-900 text-sm placeholder:text-gray-400 focus:outline-none focus:bg-white focus:ring-1 focus:ring-gray-300 transition-all ${/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(previewFormData.email) ? 'pr-10' : ''}`}
                        />
                        {/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(previewFormData.email) && (
                          <CheckCircle2 className="absolute right-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-green-500" />
                        )}
                      </div>
                      {previewErrors.email && (
                        <p className="text-red-500 text-xs mt-1">{previewErrors.email}</p>
                      )}
                    </div>

                    {/* Date of Birth and Postal Code */}
                    <div className="grid grid-cols-2 gap-3">
                      {(currentDesign.visibleFields?.dob !== false) && (
                        <div>
                          <label className="block text-gray-700 text-sm font-medium mb-2">
                            Date of Birth
                          </label>
                          <div className="relative">
                            <input
                              type="text"
                              value={previewFormData.date_of_birth}
                              onChange={(e) => handlePreviewDOBChange(e.target.value)}
                              placeholder="DD/MM/YYYY"
                              className={`w-full h-11 bg-gray-50 border ${previewErrors.date_of_birth ? 'border-red-300' : 'border-gray-200'} rounded-md px-3 text-gray-900 text-sm placeholder:text-gray-400 focus:outline-none focus:bg-white focus:ring-1 focus:ring-gray-300 transition-all ${previewFormData.date_of_birth.length === 10 && !previewErrors.date_of_birth ? 'pr-10' : ''}`}
                              maxLength={10}
                            />
                            {previewFormData.date_of_birth.length === 10 && !previewErrors.date_of_birth && (
                              <CheckCircle2 className="absolute right-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-green-500" />
                            )}
                          </div>
                          {previewErrors.date_of_birth && (
                            <p className="text-red-500 text-xs mt-1">{previewErrors.date_of_birth}</p>
                          )}
                        </div>
                      )}

                      {(currentDesign.visibleFields?.postal_code !== false) && (
                        <div>
                          <label className="block text-gray-700 text-sm font-medium mb-2">
                            Postal Code
                          </label>
                          <div className="relative">
                            <input
                              type="text"
                              maxLength={6}
                              value={previewFormData.postal_code}
                              onChange={(e) => handlePreviewInputChange('postal_code', e.target.value.replace(/\D/g, ''))}
                              placeholder="520230"
                              className={`w-full h-11 bg-gray-50 border ${previewErrors.postal_code ? 'border-red-300' : 'border-gray-200'} rounded-md px-3 text-gray-900 text-sm placeholder:text-gray-400 focus:outline-none focus:bg-white focus:ring-1 focus:ring-gray-300 transition-all ${previewFormData.postal_code.length === 6 ? 'pr-10' : ''}`}
                            />
                            {previewFormData.postal_code.length === 6 && (
                              <CheckCircle2 className="absolute right-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-green-500" />
                            )}
                          </div>
                          {previewErrors.postal_code && (
                            <p className="text-red-500 text-xs mt-1">{previewErrors.postal_code}</p>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Education and Income */}
                    <div className="grid grid-cols-2 gap-3 mt-3">
                      {(currentDesign.visibleFields?.education_level === true) && (
                        <div>
                          <label className="block text-gray-700 text-sm font-medium mb-2">
                            Education
                          </label>
                          <div className="relative">
                            <select
                              value={previewFormData.education_level}
                              onChange={(e) => setPreviewFormData(prev => ({ ...prev, education_level: e.target.value }))}
                              className="w-full h-11 bg-gray-50 border border-gray-200 rounded-md px-3 text-gray-900 text-sm focus:outline-none focus:bg-white focus:ring-1 focus:ring-gray-300 transition-all appearance-none"
                            >
                              <option value="" disabled>Select education</option>
                              <option value="Secondary School or below">Secondary School or below</option>
                              <option value="O Levels">O Levels</option>
                              <option value="Diploma">Diploma</option>
                              <option value="Degree">Degree</option>
                              <option value="Masters and above">Masters and above</option>
                            </select>
                            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-700">
                              <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" /></svg>
                            </div>
                          </div>
                        </div>
                      )}

                      {(currentDesign.visibleFields?.monthly_income === true) && (
                        <div>
                          <label className="block text-gray-700 text-sm font-medium mb-2">
                            Income
                          </label>
                          <div className="relative">
                            <select
                              value={previewFormData.monthly_income}
                              onChange={(e) => setPreviewFormData(prev => ({ ...prev, monthly_income: e.target.value }))}
                              className="w-full h-11 bg-gray-50 border border-gray-200 rounded-md px-3 text-gray-900 text-sm focus:outline-none focus:bg-white focus:ring-1 focus:ring-gray-300 transition-all appearance-none"
                            >
                              <option value="" disabled>Select income</option>
                              <option value="<$3000">&lt;$3000</option>
                              <option value="$3000 - $4999">$3000 - $4999</option>
                              <option value="$5000 - $7999">$5000 - $7999</option>
                              <option value=">$8000">&gt;$8000</option>
                            </select>
                            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-700">
                              <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" /></svg>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Submit Button */}
                    <div className="pt-4">
                      <div className="w-full h-12" style={{ backgroundColor: currentDesign.themeColor, opacity: 0.75, cursor: 'not-allowed', color: 'white', borderRadius: '0.375rem', fontWeight: '500', fontSize: '0.875rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        Submit
                      </div>
                    </div>

                    {/* Terms Footer */}
                    <div className="pt-2 text-center">
                      <p className="text-xs text-gray-500 leading-relaxed">
                        By signing up, you agree to our{' '}
                        <button
                          type="button"
                          onClick={() => setConsentOpen(true)}
                          className="text-blue-600 hover:underline"
                        >
                          Terms & Conditions
                        </button>
                        .
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Preview Footer */}
              <div className="p-3 bg-gray-50 text-center">
                <p className="text-xs text-gray-500">
                  Interactive Preview • All fields functional except submit
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div >
      <MarketingConsentDialog open={consentOpen} onOpenChange={setConsentOpen} />
    </div >
  );
}