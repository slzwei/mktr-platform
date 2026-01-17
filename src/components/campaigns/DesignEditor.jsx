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
  X, // Added X for OTP section close button
  GripVertical,
  AlertCircle // Added for WhatsApp warning
} from "lucide-react";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import MarketingConsentDialog from "@/components/legal/MarketingConsentDialog";

// Sortable Item Component
function SortableItem(props) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: props.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    ...(isDragging && { zIndex: 50 }),
  };

  return (
    <div ref={setNodeRef} style={style} className={`relative group mb-3 rounded-lg transition-all ${isDragging ? 'opacity-60 ring-2 ring-blue-400 bg-blue-50' : ''}`}>
      <div {...attributes} {...listeners} className="absolute -left-8 top-1/2 -translate-y-1/2 p-2 cursor-grab opacity-30 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-gray-600">
        <GripVertical className="w-4 h-4" />
      </div>
      {props.children}
    </div>
  );
}

// Constants
const COMBINABLE_FIELDS = ['dob', 'postal_code', 'education_level', 'monthly_income'];
const SG_PHONE_PREFIXES = ['9', '8', '6', '3'];

const LAYOUT_TEMPLATES = {
  modern: {
    id: 'modern',
    name: 'Vibrant Modern',
    description: 'Colorful gradients, glassmorphism, and rounded aesthetics.',
    backgroundStyle: 'gradient',
    themeColor: '#3B82F6',
    cardStyle: 'glass'
  },
  corporate: {
    id: 'corporate',
    name: 'Corporate Clean',
    description: 'Professional solid colors, boxier layout, and subtle shadows.',
    backgroundStyle: 'solid_slate',
    themeColor: '#0F172A',
    cardStyle: 'solid'
  },
  simple: {
    id: 'simple',
    name: 'Clean & Simple',
    description: 'Minimalist flat design with maximum readability.',
    backgroundStyle: 'simple_gray',
    themeColor: '#2563EB',
    cardStyle: 'flat'
  }
};

// Helper to determine the background class based on design config
// Helper to determine the background class based on design config
// Returns { className, style } to support both tailwind classes and custom hex colors
const getBackgroundClass = (design) => {
  if (!design) return { className: 'bg-gray-50', style: {} };

  const type = design.backgroundType || 'preset'; // 'preset' | 'custom'

  if (type === 'custom') {
    return {
      className: '', // No specific class, rely on style
      style: { backgroundColor: design.backgroundColor || '#f9fafb' }
    };
  }

  // Backwards compatibility for existing designs
  const style = design.backgroundStyle || 'gradient';

  switch (style) {
    case 'gradient': // Modern default
      return { className: 'bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-blue-50 via-white to-gray-50', style: {} };
    case 'solid_slate': // Corporate
      return { className: 'bg-slate-50', style: {} };
    case 'simple_gray': // Simple
      return { className: 'bg-white', style: {} };
    case 'solid': // Legacy
      return { className: 'bg-gray-50', style: {} };
    case 'pattern': // Legacy
      return { className: 'bg-gray-50 bg-[url("https://www.transparenttextures.com/patterns/cubes.png")]', style: {} };
    default:
      return { className: 'bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-gray-50 via-gray-50 to-gray-100', style: {} };
  }
};

const getCardClass = (design) => {
  // If specific template is selected, enforce its card style
  // Otherwise default to modern rounded
  const template = design?.layoutTemplate || 'modern';

  switch (template) {
    case 'corporate':
      return 'bg-white shadow-md border border-gray-200 rounded-lg overflow-hidden';
    case 'simple':
      return 'bg-transparent border-none shadow-none rounded-none overflow-visible';
    case 'modern':
    default:
      return 'bg-white/80 backdrop-blur-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-white/50 rounded-3xl overflow-hidden';
  }
};

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

  // Helper to generate IDs
  const generateId = () => Math.random().toString(36).substr(2, 9);

  // Helper to normalize fieldOrder to row structure
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

    // Check if already in row format (items have 'columns' prop)
    if (order.length > 0 && typeof order[0] === 'object' && order[0].columns) {
      return order;
    }

    // Convert legacy flat string array to rows
    return order.map(fieldId => ({
      id: generateId(),
      columns: [fieldId]
    }));
  };

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
    visibleFields: design.visibleFields || { phone: true, dob: true, postal_code: true },
    requiredFields: design.requiredFields || {},
    fieldOrder: normalizeFieldOrder(design.fieldOrder),
    layoutTemplate: design.layoutTemplate || 'modern', // 'modern', 'corporate', 'simple'
    otpChannel: design.otpChannel || "sms", // 'sms' or 'whatsapp'
    backgroundType: design.backgroundType || 'preset',
    backgroundColor: design.backgroundColor || '#ffffff'
  });

  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [lastSavedTime, setLastSavedTime] = useState(null);
  const [timeSinceLastSave, setTimeSinceLastSave] = useState(null);
  const fileInputRef = useRef(null);
  const saveTimeoutRef = useRef(null);

  // Update timer every second to show "saved X seconds ago"
  /* 
     REMOVED: useEffect for 'timeSinceLastSave' update loop.
     Visual feedback is sufficient via "Saved just now" or explicit error messages.
  */

  // Update design state when campaign.design_config changes (e.g., campaign prop updates)
  /*
     REMOVED: useEffect that synchronizes local state with prop updates.
     Reason: Race condition causes data loss if user types while a save is pending/completing.
     Manual save is now the source of truth, and we trust local state over server response during editing session.
     Initial load is handled by `useState` initialization and parent `key` prop.
  */

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
    setCurrentDesign(prev => ({
      ...prev,
      [key]: value
    }));
    setHasUnsavedChanges(true); // Mark that there are unsaved changes
  };

  const handleManualSave = () => {
    // Clear any pending auto-save timeout (none exist now, but keeping clean cleanup)
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
    performSave(currentDesign); // Save the current state immediately
  };

  // Drag and Drop Sensors
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Fields that can be combined into 2-column rows
  // Refactored to constant
  const combinableFields = COMBINABLE_FIELDS;

  // State for drag preview
  const [mergePreview, setMergePreview] = useState(null); // { activeId, overId }

  const handleDragStart = (event) => {
    setMergePreview(null);
  };

  const handleDragOver = (event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      setMergePreview(null);
      return;
    }

    const fieldOrder = currentDesign.fieldOrder;
    const activeIndex = fieldOrder.findIndex(row => row.id === active.id);
    const overIndex = fieldOrder.findIndex(row => row.id === over.id);

    if (activeIndex === -1 || overIndex === -1) return;

    const activeRow = fieldOrder[activeIndex];
    const overRow = fieldOrder[overIndex];

    // Check if valid merge target
    const activeIsSingle = activeRow.columns.length === 1;
    const overIsSingle = overRow.columns.length === 1;

    if (activeIsSingle && overIsSingle) {
      const activeField = activeRow.columns[0];
      const overField = overRow.columns[0];
      const activeIsCombinable = combinableFields.includes(activeField);
      const overIsCombinable = combinableFields.includes(overField);

      if (activeIsCombinable && overIsCombinable) {
        setMergePreview({ activeId: active.id, overId: over.id });
        return;
      }
    }
    setMergePreview(null);
  };

  const handleDragCancel = () => {
    setMergePreview(null);
  };

  const handleDragEnd = (event) => {
    const { active, over } = event;
    setMergePreview(null);

    if (!over || active.id === over.id) return;

    const fieldOrder = [...currentDesign.fieldOrder];
    const activeIndex = fieldOrder.findIndex(row => row.id === active.id);
    const overIndex = fieldOrder.findIndex(row => row.id === over.id);

    if (activeIndex === -1 || overIndex === -1) return;

    const activeRow = fieldOrder[activeIndex];
    const overRow = fieldOrder[overIndex];

    // Check if both are single-column rows with combinable fields
    const activeIsSingle = activeRow.columns.length === 1;
    const overIsSingle = overRow.columns.length === 1;
    const activeField = activeRow.columns[0];
    const overField = overRow.columns[0];
    const activeIsCombinable = combinableFields.includes(activeField);
    const overIsCombinable = combinableFields.includes(overField);

    // Merge logic: if both are single AND both are combinable AND they're adjacent
    if (activeIsSingle && overIsSingle && activeIsCombinable && overIsCombinable && Math.abs(activeIndex - overIndex) === 1) {
      // Merge into a 2-column row
      const mergedRow = {
        id: generateId(),
        columns: activeIndex < overIndex ? [activeField, overField] : [overField, activeField]
      };

      // Remove both rows and insert merged row at the lower index
      const minIndex = Math.min(activeIndex, overIndex);
      const newOrder = fieldOrder.filter((_, i) => i !== activeIndex && i !== overIndex);
      newOrder.splice(minIndex, 0, mergedRow);

      handleDesignChange('fieldOrder', newOrder);
    } else {
      // Normal reorder
      const newOrder = arrayMove(fieldOrder, activeIndex, overIndex);
      handleDesignChange('fieldOrder', newOrder);
    }
  };

  // Split a 2-column row back into two single-column rows
  const handleSplitRow = (rowId) => {
    const fieldOrder = [...currentDesign.fieldOrder];
    const rowIndex = fieldOrder.findIndex(row => row.id === rowId);
    if (rowIndex === -1) return;

    const row = fieldOrder[rowIndex];
    if (row.columns.length !== 2) return;

    // Create two separate rows
    const row1 = { id: generateId(), columns: [row.columns[0]] };
    const row2 = { id: generateId(), columns: [row.columns[1]] };

    // Replace the merged row with two separate rows
    fieldOrder.splice(rowIndex, 1, row1, row2);
    handleDesignChange('fieldOrder', fieldOrder);
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
    const sgPrefixes = SG_PHONE_PREFIXES;
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
      // 🚨 MOCK ONLY - DO NOT COPY TO PRODUCTION 🚨
      // Simulate API delay instead of real cost
      await new Promise(resolve => setTimeout(resolve, 1500));

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

  const handleVerifyOtp = async () => {
    if (previewPhoneVerification.otpCode.length !== 6) return;

    setPreviewPhoneVerification(prev => ({ ...prev, isVerifying: true, error: null }));

    try {
      // 🚨 MOCK ONLY - DO NOT COPY TO PRODUCTION 🚨
      // Simulate verification delay
      await new Promise(resolve => setTimeout(resolve, 800));

      // For preview, accept any 6-digit code
      setPreviewPhoneVerification(prev => ({
        ...prev,
        isVerifying: false,
        isVerified: true,
        showOtpInput: false,
        error: null
      }));
    } catch (error) {
      setPreviewPhoneVerification(prev => ({
        ...prev,
        isVerifying: false,
        error: "Invalid code"
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



                {/* OTP Settings */}
                <div className="space-y-3 pt-4 border-t">
                  <Label className="text-sm font-semibold text-gray-700">Verification Method</Label>
                  <p className="text-xs text-gray-500 -mt-1">Choose how users receive their One-Time Password (OTP)</p>
                  <Select
                    value={currentDesign.otpChannel || 'sms'}
                    onValueChange={(value) => handleDesignChange('otpChannel', value)}
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
                    <div className="flex items-center gap-2 text-xs text-amber-600 bg-amber-50 p-2 rounded border">
                      <AlertCircle className="w-4 h-4" />
                      <span>Ensure your Meta credentials are configured in .env</span>
                    </div>
                  )}
                </div>

                {/* Form Fields Selection */}
                <div className="space-y-3 pt-4 border-t">
                  <Label className="text-sm font-semibold text-gray-700">Form Fields</Label>
                  <p className="text-xs text-gray-500 -mt-1">Configure which fields appear and whether they're required</p>
                  <div className="space-y-2">
                    {/* Phone - Always required when visible */}
                    <div className="flex items-center justify-between py-1">
                      <div className="flex items-center space-x-2">
                        <input
                          type="checkbox"
                          id="field_phone"
                          checked={currentDesign.visibleFields?.phone !== false}
                          onChange={(e) => handleDesignChange('visibleFields', { ...currentDesign.visibleFields, phone: e.target.checked })}
                          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <Label htmlFor="field_phone" className="text-sm text-gray-700 font-normal">Phone Number</Label>
                      </div>
                      <span className="text-xs text-gray-400">Required for OTP</span>
                    </div>

                    {/* DOB */}
                    <div className="flex items-center justify-between py-1">
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
                      {currentDesign.visibleFields?.dob !== false && (
                        <label className="flex items-center space-x-1 text-xs text-gray-500 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={currentDesign.requiredFields?.dob === true}
                            onChange={(e) => handleDesignChange('requiredFields', { ...currentDesign.requiredFields, dob: e.target.checked })}
                            className="h-3 w-3 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                          <span>Required</span>
                        </label>
                      )}
                    </div>

                    {/* Postal Code */}
                    <div className="flex items-center justify-between py-1">
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
                      {currentDesign.visibleFields?.postal_code !== false && (
                        <label className="flex items-center space-x-1 text-xs text-gray-500 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={currentDesign.requiredFields?.postal_code === true}
                            onChange={(e) => handleDesignChange('requiredFields', { ...currentDesign.requiredFields, postal_code: e.target.checked })}
                            className="h-3 w-3 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                          <span>Required</span>
                        </label>
                      )}
                    </div>

                    {/* Education */}
                    <div className="flex items-center justify-between py-1">
                      <div className="flex items-center space-x-2">
                        <input
                          type="checkbox"
                          id="field_education"
                          checked={currentDesign.visibleFields?.education_level === true}
                          onChange={(e) => handleDesignChange('visibleFields', { ...currentDesign.visibleFields, education_level: e.target.checked })}
                          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <Label htmlFor="field_education" className="text-sm text-gray-700 font-normal">Highest Education</Label>
                      </div>
                      {currentDesign.visibleFields?.education_level === true && (
                        <label className="flex items-center space-x-1 text-xs text-gray-500 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={currentDesign.requiredFields?.education_level === true}
                            onChange={(e) => handleDesignChange('requiredFields', { ...currentDesign.requiredFields, education_level: e.target.checked })}
                            className="h-3 w-3 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                          <span>Required</span>
                        </label>
                      )}
                    </div>

                    {/* Income */}
                    <div className="flex items-center justify-between py-1">
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
                      {currentDesign.visibleFields?.monthly_income === true && (
                        <label className="flex items-center space-x-1 text-xs text-gray-500 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={currentDesign.requiredFields?.monthly_income === true}
                            onChange={(e) => handleDesignChange('requiredFields', { ...currentDesign.requiredFields, monthly_income: e.target.checked })}
                            className="h-3 w-3 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                          <span>Required</span>
                        </label>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}


            {activeTab === 'design' && (
              <div className="space-y-6">
                {/* Layout Template Selection */}
                <div className="space-y-3">
                  <Label className="text-sm font-semibold text-gray-700">Layout Style</Label>
                  <div className="grid grid-cols-1 gap-3">
                    {Object.values(LAYOUT_TEMPLATES).map((template) => (
                      <div
                        key={template.id}
                        onClick={() => {
                          // Batched update via functional set state handled in new handleDesignChange
                          // However, here we are calling it multiple times.
                          // Ideally we should have a bulk update or just let the functional update handle it.
                          // But to ensure atomicity, better to assume handleDesignChange handles it.
                          // Wait, my handleDesignChange fix handles race conditions via prev state,
                          // but 3 calls is still 3 renders potentially or at least 3 queued updates.
                          // It works.
                          handleDesignChange('layoutTemplate', template.id);
                          handleDesignChange('backgroundStyle', template.backgroundStyle);
                          handleDesignChange('backgroundType', 'preset');
                        }}
                        className={`relative p-4 rounded-xl border-2 transition-all cursor-pointer ${currentDesign.layoutTemplate === template.id
                          ? 'border-blue-600 bg-blue-50/50'
                          : 'border-gray-100 hover:border-blue-200 hover:bg-gray-50'
                          }`}
                      >
                        <div className="flex items-start justify-between">
                          <div>
                            <h4 className="font-semibold text-gray-900">{template.name}</h4>
                            <p className="text-xs text-gray-500 mt-1">{template.description}</p>
                          </div>
                          {currentDesign.layoutTemplate === template.id && (
                            <div className="h-5 w-5 rounded-full bg-blue-600 flex items-center justify-center">
                              <CheckCircle2 className="w-3 h-3 text-white" />
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Background Selection */}
                <div className="space-y-3 pt-4 border-t">
                  <Label className="text-sm font-semibold text-gray-700">Background</Label>
                  <div className="bg-gray-50 p-1 rounded-lg flex gap-1 mb-2">
                    <button
                      type="button"
                      onClick={() => handleDesignChange('backgroundType', 'preset')}
                      className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all ${(!currentDesign.backgroundType || currentDesign.backgroundType === 'preset')
                        ? 'bg-white text-gray-900 shadow-sm'
                        : 'text-gray-500 hover:text-gray-900'
                        }`}
                    >
                      Preset
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDesignChange('backgroundType', 'custom')}
                      className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all ${currentDesign.backgroundType === 'custom'
                        ? 'bg-white text-gray-900 shadow-sm'
                        : 'text-gray-500 hover:text-gray-900'
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
                        onChange={(e) => handleDesignChange('backgroundColor', e.target.value)}
                        className="w-full h-10 p-1 rounded-lg border cursor-pointer"
                      />
                      <Badge variant="outline" className="font-mono text-xs">
                        {currentDesign.backgroundColor || '#ffffff'}
                      </Badge>
                    </div>
                  )}
                  {(!currentDesign.backgroundType || currentDesign.backgroundType === 'preset') && (
                    <p className="text-xs text-gray-400">
                      Using default background from <strong>{LAYOUT_TEMPLATES[currentDesign.layoutTemplate]?.name || 'current'}</strong> template.
                    </p>
                  )}

                </div>

                <div className="space-y-3 pt-4 border-t">
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
                  <p className="text-sm text-green-600">Saved</p>
                ) : (
                  <p className="text-sm text-gray-500">Changes are saved manually</p>
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
            {/* Mobile Preview Container */}
            <div className="border rounded-xl overflow-hidden bg-gray-900/5 border-gray-200">
              {/* Top Bar - Browser/Phone Chrome */}
              <div className="bg-white border-b px-4 py-2 flex items-center gap-2">
                <div className="flex gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-red-400"></div>
                  <div className="w-2.5 h-2.5 rounded-full bg-yellow-400"></div>
                  <div className="w-2.5 h-2.5 rounded-full bg-green-400"></div>
                </div>
                <div className="flex-1 bg-gray-100 rounded text-[10px] text-gray-500 text-center py-1 mx-4">
                  mktr.io/campaigns/preview
                </div>
              </div>

              {/* Viewport Area */}
              <div className={`h-[650px] overflow-y-auto relative ${getBackgroundClass(currentDesign).className}`} style={getBackgroundClass(currentDesign).style}>
                <div className="min-h-full py-8 px-4 flex flex-col items-center">

                  {/* Content Card */}
                  <div className={`w-full max-w-[375px] ${getCardClass(currentDesign)} transform transition-all duration-300`}>

                    {/* Header Image */}
                    {currentDesign.imageUrl && (
                      <div className="w-full relative h-48 sm:h-56 bg-gray-100 border-b border-gray-100/50">
                        <img
                          src={resolveImageUrl(currentDesign.imageUrl)}
                          alt="Campaign Header"
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent pointer-events-none" />
                      </div>
                    )}

                    {!currentDesign.imageUrl && (
                      <div className="h-48 bg-gray-50 flex items-center justify-center border-b border-gray-100">
                        <div className="text-center">
                          <div className="w-12 h-12 bg-gray-200 rounded-lg mx-auto mb-2"></div>
                          <span className="text-xs text-gray-400">Header Image</span>
                        </div>
                      </div>
                    )}

                    {/* Form Content */}
                    <div className="p-6">
                      <div className="text-center mb-6">
                        {currentDesign.formHeadline ? (
                          <h1
                            className="font-bold text-gray-900 mb-2 leading-tight tracking-tight"
                            style={{ fontSize: `${(currentDesign.headlineSize || 24)}px` }}
                          >
                            {currentDesign.formHeadline}
                          </h1>
                        ) : (
                          <div className="border border-dashed border-gray-300 rounded p-2 mb-2 text-gray-400 text-xs text-center">
                            Write a headline...
                          </div>
                        )}

                        {currentDesign.formSubheadline ? (
                          <p className="text-gray-500 text-sm">
                            {currentDesign.formSubheadline}
                          </p>
                        ) : (
                          <div className="border border-dashed border-gray-300 rounded p-2 text-gray-400 text-xs text-center">
                            Write a subheadline...
                          </div>
                        )}
                      </div>

                      <div className="space-y-0">
                        <DndContext
                          sensors={sensors}
                          collisionDetection={closestCenter}
                          onDragStart={handleDragStart}
                          onDragOver={handleDragOver}
                          onDragEnd={handleDragEnd}
                          onDragCancel={handleDragCancel}
                        >
                          <SortableContext
                            items={currentDesign.fieldOrder.map(row => row.id)}
                            strategy={verticalListSortingStrategy}
                          >
                            {currentDesign.fieldOrder.map((row) => {
                              // Check visibility for all fields in this row
                              const visibleColumns = row.columns.filter(fieldId => {
                                if (fieldId === 'name' || fieldId === 'email') return true;
                                return currentDesign.visibleFields?.[fieldId] !== false;
                              });

                              if (visibleColumns.length === 0) return null;

                              // Check if this row is involved in a merge preview
                              const isMergeTarget = mergePreview &&
                                (mergePreview.activeId === row.id || mergePreview.overId === row.id);

                              return (
                                <SortableItem key={row.id} id={row.id}>
                                  {/* Split button for merged rows */}
                                  {row.columns.length === 2 && (
                                    <button
                                      type="button"
                                      onClick={() => handleSplitRow(row.id)}
                                      className="absolute -right-8 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                                      title="Split row"
                                    >
                                      <X className="w-4 h-4" />
                                    </button>
                                  )}
                                  <div className={`grid gap-3 transition-all duration-200 rounded-lg ${isMergeTarget ? 'ring-2 ring-green-400 bg-green-50 p-2' : ''
                                    } ${isMergeTarget || visibleColumns.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                                    {visibleColumns.map((fieldId) => (
                                      <div key={fieldId} className={isMergeTarget && row.columns.length === 1 ? 'col-span-1' : ''}>
                                        {/* Render specific field content */}
                                        {fieldId === 'name' && (
                                          <div>
                                            <label className="block text-gray-700 text-sm font-medium mb-1.5">
                                              Full Name
                                            </label>
                                            <div className="relative">
                                              <input
                                                type="text"
                                                value={previewFormData.name}
                                                onChange={(e) => setPreviewFormData(prev => ({ ...prev, name: e.target.value }))}
                                                placeholder="John Tan"
                                                className={`w-full h-10 bg-gray-50 border border-gray-200 rounded-md px-3 text-gray-900 text-sm placeholder:text-gray-400 focus:outline-none focus:bg-white focus:ring-1 focus:ring-gray-300 transition-all ${previewFormData.name.trim().length >= 2 ? 'pr-10' : ''}`}
                                              />
                                              {previewFormData.name.trim().length >= 2 && (
                                                <CheckCircle2 className="absolute right-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-green-500" />
                                              )}
                                            </div>
                                          </div>
                                        )}

                                        {fieldId === 'phone' && (
                                          <div>
                                            <label className="block text-gray-700 text-sm font-medium mb-1.5">
                                              Phone Number
                                            </label>
                                            <div className="grid grid-cols-12 gap-2">
                                              <div className="col-span-8 relative">
                                                <div className="flex h-10 bg-gray-50 rounded-md border border-gray-200 overflow-hidden focus-within:bg-white focus-within:ring-1 focus-within:ring-gray-300 transition-all">
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
                                                    className="w-full h-10 text-white text-sm font-medium disabled:opacity-50 rounded-md transition-colors flex items-center justify-center hover:opacity-90"
                                                    style={{ backgroundColor: currentDesign.themeColor }}
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
                                                  <div className="w-full h-10 bg-green-50 border border-green-200 rounded-md flex items-center justify-center">
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
                                              <div className="p-3 bg-gray-50 rounded-md border border-gray-200">
                                                <div className="flex items-center justify-between mb-2">
                                                  <div>
                                                    <h4 className="font-medium text-gray-900 text-xs">Enter Code</h4>
                                                    <p className="text-[10px] text-gray-500">Sent to +65 {formatPhoneDisplay(previewFormData.phone)}</p>
                                                  </div>
                                                  <button
                                                    type="button"
                                                    className="text-gray-400 hover:text-gray-600 p-1"
                                                    onClick={() => setPreviewPhoneVerification(prev => ({ ...prev, showOtpInput: false }))}
                                                  >
                                                    <X className="w-3 h-3" />
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
                                                    className="flex-1 h-9 bg-white border border-gray-200 rounded-md px-2 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-300 text-center tracking-widest text-sm"
                                                  />
                                                  <button
                                                    type="button"
                                                    onClick={handleVerifyOtp}
                                                    disabled={previewPhoneVerification.otpCode.length !== 6 || previewPhoneVerification.isVerifying}
                                                    className="h-9 px-4 text-white rounded-md text-xs font-medium disabled:opacity-50 transition-colors flex items-center justify-center hover:opacity-90"
                                                    style={{ backgroundColor: currentDesign.themeColor }}
                                                  >
                                                    {previewPhoneVerification.isVerifying ? (
                                                      <Loader2 className="w-3 h-3 animate-spin" />
                                                    ) : (
                                                      'Confirm'
                                                    )}
                                                  </button>
                                                </div>
                                              </div>
                                            </div>
                                          </div>
                                        )}

                                        {fieldId === 'email' && (
                                          <div>
                                            <label className="block text-gray-700 text-sm font-medium mb-1.5">
                                              Email
                                            </label>
                                            <div className="relative">
                                              <input
                                                type="email"
                                                value={previewFormData.email}
                                                onChange={(e) => handlePreviewInputChange('email', e.target.value)}
                                                placeholder="you@example.com"
                                                className={`w-full h-10 bg-gray-50 border ${previewErrors.email ? 'border-red-300' : 'border-gray-200'} rounded-md px-3 text-gray-900 text-sm placeholder:text-gray-400 focus:outline-none focus:bg-white focus:ring-1 focus:ring-gray-300 transition-all ${/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(previewFormData.email) ? 'pr-10' : ''}`}
                                              />
                                              {/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(previewFormData.email) && (
                                                <CheckCircle2 className="absolute right-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-green-500" />
                                              )}
                                            </div>
                                            {previewErrors.email && (
                                              <p className="text-red-500 text-xs mt-1">{previewErrors.email}</p>
                                            )}
                                          </div>
                                        )}

                                        {fieldId === 'dob' && (
                                          <div>
                                            <label className="block text-gray-700 text-sm font-medium mb-1.5">
                                              Date of Birth
                                            </label>
                                            <div className="relative">
                                              <input
                                                type="text"
                                                value={previewFormData.date_of_birth}
                                                onChange={(e) => handlePreviewDOBChange(e.target.value)}
                                                placeholder="DD/MM/YYYY"
                                                className={`w-full h-10 bg-gray-50 border ${previewErrors.date_of_birth ? 'border-red-300' : 'border-gray-200'} rounded-md px-3 text-gray-900 text-sm placeholder:text-gray-400 focus:outline-none focus:bg-white focus:ring-1 focus:ring-gray-300 transition-all ${previewFormData.date_of_birth.length === 10 && !previewErrors.date_of_birth ? 'pr-10' : ''}`}
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

                                        {fieldId === 'postal_code' && (
                                          <div>
                                            <label className="block text-gray-700 text-sm font-medium mb-1.5">
                                              Postal Code
                                            </label>
                                            <div className="relative">
                                              <input
                                                type="text"
                                                maxLength={6}
                                                value={previewFormData.postal_code}
                                                onChange={(e) => handlePreviewInputChange('postal_code', e.target.value.replace(/\D/g, ''))}
                                                placeholder="520230"
                                                className={`w-full h-10 bg-gray-50 border ${previewErrors.postal_code ? 'border-red-300' : 'border-gray-200'} rounded-md px-3 text-gray-900 text-sm placeholder:text-gray-400 focus:outline-none focus:bg-white focus:ring-1 focus:ring-gray-300 transition-all ${previewFormData.postal_code.length === 6 ? 'pr-10' : ''}`}
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

                                        {fieldId === 'education_level' && (
                                          <div>
                                            <label className="block text-gray-700 text-sm font-medium mb-1.5">
                                              Education
                                            </label>
                                            <div className="relative">
                                              <select
                                                value={previewFormData.education_level}
                                                onChange={(e) => setPreviewFormData(prev => ({ ...prev, education_level: e.target.value }))}
                                                className="w-full h-10 bg-gray-50 border border-gray-200 rounded-md px-3 text-gray-900 text-sm focus:outline-none focus:bg-white focus:ring-1 focus:ring-gray-300 transition-all appearance-none"
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

                                        {fieldId === 'monthly_income' && (
                                          <div>
                                            <label className="block text-gray-700 text-sm font-medium mb-1.5">
                                              Income
                                            </label>
                                            <div className="relative">
                                              <select
                                                value={previewFormData.monthly_income}
                                                onChange={(e) => setPreviewFormData(prev => ({ ...prev, monthly_income: e.target.value }))}
                                                className="w-full h-10 bg-gray-50 border border-gray-200 rounded-md px-3 text-gray-900 text-sm focus:outline-none focus:bg-white focus:ring-1 focus:ring-gray-300 transition-all appearance-none"
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
                                    ))}
                                  </div>
                                </SortableItem>
                              );
                            })}
                          </SortableContext>
                        </DndContext>
                      </div>

                      {/* Submit Button */}
                      <div className="pt-6">
                        <div className="w-full h-12 flex items-center justify-center rounded-lg shadow-sm text-white font-medium text-base transition-all transform active:scale-[0.98]" style={{ backgroundColor: currentDesign.themeColor || '#111827', cursor: 'pointer' }}>
                          {currentDesign.ctaText || 'Submit Application'}
                        </div>
                      </div>

                      {/* Terms Footer */}
                      <div className="pt-4 text-center">
                        <p className="text-[10px] text-gray-400 leading-relaxed">
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

                  {/* Trust Footer */}
                  <div className="mt-8 text-center w-full max-w-[375px]">
                    <div className="flex items-center justify-center gap-4 opacity-60 grayscale">
                      <div className="flex items-center gap-1.5 text-[10px] text-gray-600 font-medium bg-white/50 backdrop-blur-sm px-2 py-1 rounded-full border border-gray-200/50">
                        <svg className="w-3 h-3 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                        </svg>
                        SSL Secure Connection
                      </div>
                    </div>
                    <p className="text-[10px] text-gray-400 mt-4">
                      &copy; {new Date().getFullYear()} MKTR Platform. All rights reserved.
                    </p>
                  </div>

                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div >
      <MarketingConsentDialog open={consentOpen} onOpenChange={setConsentOpen} />
    </div >
  );
}