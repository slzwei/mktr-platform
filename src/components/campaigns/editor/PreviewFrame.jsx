import { useState, useEffect } from "react";
import {
  CheckCircle2,
  Loader2,
  X,
  GripVertical,
  Video,
  Eye
} from "lucide-react";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import MarketingConsentDialog from "@/components/legal/MarketingConsentDialog";
import { getBackgroundClass, getCardClass, resolveImageUrl } from "../LeadCaptureLayout";
import { COMBINABLE_FIELDS, SG_PHONE_PREFIXES } from './constants';

function SortableItem(props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.id });
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

export default function PreviewFrame({ currentDesign, campaign, onDesignChange }) {
  // Mock form state
  const [previewFormData, setPreviewFormData] = useState({
    name: '', phone: '', email: '', date_of_birth: '',
    postal_code: '', education_level: '', monthly_income: ''
  });
  const [previewPhoneVerification, setPreviewPhoneVerification] = useState({
    isVerified: false, isSending: false, isVerifying: false,
    otpCode: '', showOtpInput: false, canResend: true,
    resendCooldown: 0, error: null, hasSentCode: false
  });
  const [previewErrors, setPreviewErrors] = useState({});
  const [consentOpen, setConsentOpen] = useState(false);
  const [mergePreview, setMergePreview] = useState(null);

  // Resend cooldown timer
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

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const formatPhoneDisplay = (digits) => {
    if (digits.length <= 4) return digits;
    return `${digits.slice(0, 4)} ${digits.slice(4)}`;
  };

  const handlePreviewPhoneChange = (value) => {
    const digits = value.replace(/\D/g, '').slice(0, 8);
    if (digits.length > 0 && !SG_PHONE_PREFIXES.includes(digits[0])) {
      setPreviewPhoneVerification(prev => ({ ...prev, error: 'Singapore numbers start with 9, 8, 6, or 3' }));
    } else {
      setPreviewPhoneVerification(prev => ({ ...prev, error: null }));
    }
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
    if (previewPhoneVerification.error) return;
    setPreviewPhoneVerification(prev => ({ ...prev, isSending: true, error: null }));
    try {
      await new Promise(resolve => setTimeout(resolve, 1500));
      setPreviewPhoneVerification(prev => ({
        ...prev, isSending: false, showOtpInput: true,
        canResend: false, resendCooldown: 20, hasSentCode: true
      }));
    } catch {
      setPreviewPhoneVerification(prev => ({ ...prev, isSending: false, error: "Failed to send code. Please try again." }));
    }
  };

  const handleVerifyOtp = async () => {
    if (previewPhoneVerification.otpCode.length !== 6) return;
    setPreviewPhoneVerification(prev => ({ ...prev, isVerifying: true, error: null }));
    try {
      await new Promise(resolve => setTimeout(resolve, 800));
      setPreviewPhoneVerification(prev => ({ ...prev, isVerifying: false, isVerified: true, showOtpInput: false, error: null }));
    } catch {
      setPreviewPhoneVerification(prev => ({ ...prev, isVerifying: false, error: "Invalid code" }));
    }
  };

  const handlePreviewInputChange = (field, value) => {
    setPreviewFormData(prev => ({ ...prev, [field]: value }));
    setTimeout(() => {
      let error = null;
      switch (field) {
        case 'email':
          if (value.length > 0 && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) error = 'Please enter a valid email address';
          break;
        case 'postal_code':
          if (value.length > 0 && value.length !== 6) error = 'Postal code must be 6 digits';
          break;
      }
      setPreviewErrors(prev => ({ ...prev, [field]: error || null }));
    }, 300);
  };

  const calculateAge = (dobString) => {
    if (!dobString || dobString.length !== 10) return null;
    const parts = dobString.split('/');
    if (parts.length !== 3) return null;
    const day = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10);
    const year = parseInt(parts[2], 10);
    if (isNaN(day) || isNaN(month) || isNaN(year) || day < 1 || day > 31 || month < 1 || month > 12) return null;
    const today = new Date();
    const birthDate = new Date(year, month - 1, day);
    if (birthDate.getFullYear() !== year || birthDate.getMonth() !== month - 1 || birthDate.getDate() !== day) return null;
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) age--;
    return age;
  };

  const validatePreviewAge = (dob) => {
    if (!campaign) return null;
    const age = calculateAge(dob);
    if (age === null) return null;
    const hasMinAge = campaign.min_age !== undefined && campaign.min_age !== null;
    const hasMaxAge = campaign.max_age !== undefined && campaign.max_age !== null;
    if (hasMinAge && age < campaign.min_age) return `Must be at least ${campaign.min_age} years old`;
    if (hasMaxAge && age > campaign.max_age) return `Only available for ages ${campaign.min_age ? campaign.min_age + '-' : ''}${campaign.max_age}`;
    return null;
  };

  const handlePreviewDOBChange = (value) => {
    let cleaned = value.replace(/\D/g, '');
    let formatted = '';
    for (let i = 0; i < cleaned.length && i < 8; i++) {
      if (i === 2 || i === 4) formatted += '/';
      formatted += cleaned[i];
    }
    setPreviewFormData(prev => ({ ...prev, date_of_birth: formatted }));
    if (formatted.length === 10) {
      const ageError = validatePreviewAge(formatted);
      setPreviewErrors(prev => ({ ...prev, date_of_birth: ageError || null }));
    } else if (formatted.length > 0) {
      setPreviewErrors(prev => ({ ...prev, date_of_birth: null }));
    }
  };

  // Drag handlers
  const handleDragStart = () => setMergePreview(null);
  const handleDragCancel = () => setMergePreview(null);

  const handleDragOver = (event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) { setMergePreview(null); return; }
    const fieldOrder = currentDesign.fieldOrder;
    const activeIndex = fieldOrder.findIndex(row => row.id === active.id);
    const overIndex = fieldOrder.findIndex(row => row.id === over.id);
    if (activeIndex === -1 || overIndex === -1) return;
    const activeRow = fieldOrder[activeIndex];
    const overRow = fieldOrder[overIndex];
    if (activeRow.columns.length === 1 && overRow.columns.length === 1) {
      const activeField = activeRow.columns[0];
      const overField = overRow.columns[0];
      if (COMBINABLE_FIELDS.includes(activeField) && COMBINABLE_FIELDS.includes(overField)) {
        setMergePreview({ activeId: active.id, overId: over.id });
        return;
      }
    }
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
    const activeIsSingle = activeRow.columns.length === 1;
    const overIsSingle = overRow.columns.length === 1;
    const activeField = activeRow.columns[0];
    const overField = overRow.columns[0];

    if (activeIsSingle && overIsSingle
      && COMBINABLE_FIELDS.includes(activeField) && COMBINABLE_FIELDS.includes(overField)
      && Math.abs(activeIndex - overIndex) === 1) {
      const mergedRow = {
        id: Math.random().toString(36).substr(2, 9),
        columns: activeIndex < overIndex ? [activeField, overField] : [overField, activeField]
      };
      const minIndex = Math.min(activeIndex, overIndex);
      const newOrder = fieldOrder.filter((_, i) => i !== activeIndex && i !== overIndex);
      newOrder.splice(minIndex, 0, mergedRow);
      onDesignChange('fieldOrder', newOrder);
    } else {
      onDesignChange('fieldOrder', arrayMove(fieldOrder, activeIndex, overIndex));
    }
  };

  const handleSplitRow = (rowId) => {
    const fieldOrder = [...currentDesign.fieldOrder];
    const rowIndex = fieldOrder.findIndex(row => row.id === rowId);
    if (rowIndex === -1) return;
    const row = fieldOrder[rowIndex];
    if (row.columns.length !== 2) return;
    const genId = () => Math.random().toString(36).substr(2, 9);
    fieldOrder.splice(rowIndex, 1,
      { id: genId(), columns: [row.columns[0]] },
      { id: genId(), columns: [row.columns[1]] }
    );
    onDesignChange('fieldOrder', fieldOrder);
  };

  const background = getBackgroundClass(currentDesign);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 rounded-t-xl">
        <Eye className="w-4 h-4 text-gray-500 dark:text-gray-400" />
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Interactive Preview</span>
      </div>

      <div className="border border-t-0 rounded-b-xl overflow-hidden bg-gray-900/5 dark:bg-gray-900/20 border-gray-200 dark:border-gray-700 flex-1">
        {/* Browser chrome */}
        <div className="bg-white border-b px-4 py-2 flex items-center gap-2">
          <div className="flex gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-red-400" />
            <div className="w-2.5 h-2.5 rounded-full bg-yellow-400" />
            <div className="w-2.5 h-2.5 rounded-full bg-green-400" />
          </div>
          <div className="flex-1 bg-gray-100 rounded text-[10px] text-gray-500 text-center py-1 mx-4">
            mktr.io/campaigns/preview
          </div>
        </div>

        {/* Light-mode isolated viewport */}
        <div className="light" data-theme="light">
          <div className={`h-[650px] overflow-y-auto relative ${background.className}`} style={background.style}>
            <div className="min-h-full py-8 px-4 flex flex-col items-center">
              {/* Content Card */}
              <div
                className={`w-full max-w-[375px] ${getCardClass(currentDesign)} transform transition-all duration-300`}
                style={{ backgroundColor: currentDesign.cardBackgroundColor }}
              >
                {/* Header Media */}
                {currentDesign.mediaType === 'video' && currentDesign.videoUrl ? (
                  <div className="w-full bg-black" style={{ aspectRatio: '16/9' }}>
                    {/youtube|youtu\.be/.test(currentDesign.videoUrl) ? (
                      <div className="w-full h-full flex items-center justify-center text-white text-xs">
                        <Video className="w-5 h-5 mr-1.5 text-red-400" />
                        <span className="text-gray-300">YouTube Video</span>
                      </div>
                    ) : (
                      <video src={resolveImageUrl(currentDesign.videoUrl)} className="w-full h-full object-cover" muted playsInline preload="metadata" />
                    )}
                  </div>
                ) : currentDesign.mediaType !== 'none' && currentDesign.imageUrl ? (
                  <div className="w-full relative h-48 sm:h-56 bg-gray-100 border-b border-gray-100/50">
                    <img src={resolveImageUrl(currentDesign.imageUrl)} alt="Campaign Header" className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent pointer-events-none" />
                  </div>
                ) : currentDesign.mediaType !== 'none' ? (
                  <div className="h-48 bg-gray-50 flex items-center justify-center border-b border-gray-100">
                    <div className="text-center">
                      <div className="w-12 h-12 bg-gray-200 rounded-lg mx-auto mb-2" />
                      <span className="text-xs text-gray-400">Header Media</span>
                    </div>
                  </div>
                ) : null}

                {/* Form Content */}
                <div className="p-6">
                  <div className={`mb-6 text-${currentDesign.alignment || 'center'}`} style={{ color: currentDesign.textColor }}>
                    {currentDesign.formHeadline ? (
                      <h1
                        className="font-bold text-gray-900 mb-2 leading-tight tracking-tight"
                        style={{ fontSize: `${currentDesign.headlineSize || 24}px`, color: currentDesign.textColor }}
                      >
                        {currentDesign.formHeadline}
                      </h1>
                    ) : (
                      <div className="border border-dashed border-gray-300 rounded p-2 mb-2 text-gray-400 text-xs text-center">Write a headline...</div>
                    )}
                    {currentDesign.formSubheadline ? (
                      <p className="text-gray-500 text-sm" style={{ color: currentDesign.textColor, opacity: 0.8 }}>{currentDesign.formSubheadline}</p>
                    ) : (
                      <div className="border border-dashed border-gray-300 rounded p-2 text-gray-400 text-xs text-center">Write a subheadline...</div>
                    )}
                  </div>

                  <div className="space-y-0">
                    <DndContext sensors={sensors} collisionDetection={closestCenter}
                      onDragStart={handleDragStart} onDragOver={handleDragOver}
                      onDragEnd={handleDragEnd} onDragCancel={handleDragCancel}>
                      <SortableContext items={currentDesign.fieldOrder.map(row => row.id)} strategy={verticalListSortingStrategy}>
                        {currentDesign.fieldOrder.map((row) => {
                          const visibleColumns = row.columns.filter(fieldId => {
                            if (fieldId === 'name' || fieldId === 'email') return true;
                            return currentDesign.visibleFields?.[fieldId] !== false;
                          });
                          if (visibleColumns.length === 0) return null;

                          const isMergeTarget = mergePreview && (mergePreview.activeId === row.id || mergePreview.overId === row.id);

                          return (
                            <SortableItem key={row.id} id={row.id}>
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
                              <div className={`grid gap-3 transition-all duration-200 rounded-lg ${isMergeTarget ? 'ring-2 ring-green-400 bg-green-50 p-2' : ''} ${isMergeTarget || visibleColumns.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                                {visibleColumns.map((fieldId) => (
                                  <div key={fieldId} className={isMergeTarget && row.columns.length === 1 ? 'col-span-1' : ''}>
                                    {fieldId === 'name' && (
                                      <PreviewField label="Full Name" textColor={currentDesign.textColor}>
                                        <div className="relative">
                                          <input type="text" value={previewFormData.name}
                                            onChange={(e) => setPreviewFormData(prev => ({ ...prev, name: e.target.value }))}
                                            placeholder="John Tan"
                                            className={`w-full h-10 bg-gray-50 border border-gray-200 rounded-md px-3 text-gray-900 text-sm placeholder:text-gray-400 focus:outline-none focus:bg-white focus:ring-1 focus:ring-gray-300 transition-all ${previewFormData.name.trim().length >= 2 ? 'pr-10' : ''}`}
                                          />
                                          {previewFormData.name.trim().length >= 2 && <CheckCircle2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-green-500" />}
                                        </div>
                                      </PreviewField>
                                    )}

                                    {fieldId === 'phone' && (
                                      <PreviewField label="Phone Number" textColor={currentDesign.textColor}>
                                        <div className="grid grid-cols-12 gap-2">
                                          <div className="col-span-8 relative">
                                            <div className="flex h-10 bg-gray-50 rounded-md border border-gray-200 overflow-hidden focus-within:bg-white focus-within:ring-1 focus-within:ring-gray-300 transition-all">
                                              <div className="px-3 bg-gray-100 flex items-center border-r border-gray-200 gap-1">
                                                <span className="text-sm">🇸🇬</span>
                                                <span className="text-gray-600 text-sm font-medium">+65</span>
                                              </div>
                                              <input type="tel" value={formatPhoneDisplay(previewFormData.phone)}
                                                onChange={(e) => handlePreviewPhoneChange(e.target.value)}
                                                placeholder="9123 4567"
                                                className="bg-transparent border-0 focus:ring-0 focus:outline-none h-full px-3 text-sm flex-1 placeholder:text-gray-400"
                                                maxLength={9} disabled={previewPhoneVerification.isVerified}
                                              />
                                              {previewFormData.phone.length === 8 && previewPhoneVerification.isVerified && (
                                                <div className="absolute right-3 top-1/2 -translate-y-1/2"><CheckCircle2 className="w-4 h-4 text-green-500" /></div>
                                              )}
                                            </div>
                                          </div>
                                          <div className="col-span-4">
                                            {!previewPhoneVerification.isVerified ? (
                                              <button type="button" onClick={handlePreviewSendOTP}
                                                disabled={previewPhoneVerification.isSending || previewFormData.phone.length !== 8 || previewPhoneVerification.error || (previewPhoneVerification.hasSentCode && !previewPhoneVerification.canResend)}
                                                className="w-full h-10 text-white text-sm font-medium disabled:opacity-50 rounded-md transition-colors flex items-center justify-center hover:opacity-90"
                                                style={{ backgroundColor: currentDesign.themeColor }}>
                                                {previewPhoneVerification.isSending ? <Loader2 className="w-4 h-4 animate-spin" />
                                                  : !previewPhoneVerification.hasSentCode ? 'Verify'
                                                  : !previewPhoneVerification.canResend ? `Resend (${previewPhoneVerification.resendCooldown}s)` : 'Resend'}
                                              </button>
                                            ) : (
                                              <div className="w-full h-10 bg-green-50 border border-green-200 rounded-md flex items-center justify-center">
                                                <CheckCircle2 className="w-4 h-4 text-green-600" />
                                              </div>
                                            )}
                                          </div>
                                        </div>
                                        {previewPhoneVerification.error && <p className="text-red-500 text-xs mt-1">{previewPhoneVerification.error}</p>}
                                        {/* OTP Section */}
                                        <div className={`transition-all duration-300 ease-out overflow-hidden ${previewPhoneVerification.showOtpInput ? 'max-h-48 opacity-100 mt-3' : 'max-h-0 opacity-0'}`}>
                                          <div className="p-3 bg-gray-50 rounded-md border border-gray-200">
                                            <div className="flex items-center justify-between mb-2">
                                              <div>
                                                <h4 className="font-medium text-gray-900 text-xs">Enter Code</h4>
                                                <p className="text-[10px] text-gray-500">Sent to +65 {formatPhoneDisplay(previewFormData.phone)}</p>
                                              </div>
                                              <button type="button" className="text-gray-400 hover:text-gray-600 p-1"
                                                onClick={() => setPreviewPhoneVerification(prev => ({ ...prev, showOtpInput: false }))}>
                                                <X className="w-3 h-3" />
                                              </button>
                                            </div>
                                            <div className="flex gap-2">
                                              <input type="text" maxLength={6} value={previewPhoneVerification.otpCode}
                                                onChange={(e) => setPreviewPhoneVerification(prev => ({ ...prev, otpCode: e.target.value.replace(/\D/g, '') }))}
                                                placeholder="123456"
                                                className="flex-1 h-9 bg-white border border-gray-200 rounded-md px-2 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-300 text-center tracking-widest text-sm"
                                              />
                                              <button type="button" onClick={handleVerifyOtp}
                                                disabled={previewPhoneVerification.otpCode.length !== 6 || previewPhoneVerification.isVerifying}
                                                className="h-9 px-4 text-white rounded-md text-xs font-medium disabled:opacity-50 transition-colors flex items-center justify-center hover:opacity-90"
                                                style={{ backgroundColor: currentDesign.themeColor }}>
                                                {previewPhoneVerification.isVerifying ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Confirm'}
                                              </button>
                                            </div>
                                          </div>
                                        </div>
                                      </PreviewField>
                                    )}

                                    {fieldId === 'email' && (
                                      <PreviewField label="Email" textColor={currentDesign.textColor}>
                                        <div className="relative">
                                          <input type="email" value={previewFormData.email}
                                            onChange={(e) => handlePreviewInputChange('email', e.target.value)}
                                            placeholder="you@example.com"
                                            className={`w-full h-10 bg-gray-50 border ${previewErrors.email ? 'border-red-300' : 'border-gray-200'} rounded-md px-3 text-gray-900 text-sm placeholder:text-gray-400 focus:outline-none focus:bg-white focus:ring-1 focus:ring-gray-300 transition-all ${/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(previewFormData.email) ? 'pr-10' : ''}`}
                                          />
                                          {/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(previewFormData.email) && <CheckCircle2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-green-500" />}
                                        </div>
                                        {previewErrors.email && <p className="text-red-500 text-xs mt-1">{previewErrors.email}</p>}
                                      </PreviewField>
                                    )}

                                    {fieldId === 'dob' && (
                                      <PreviewField label="Date of Birth" textColor={currentDesign.textColor}>
                                        <div className="relative">
                                          <input type="text" value={previewFormData.date_of_birth}
                                            onChange={(e) => handlePreviewDOBChange(e.target.value)}
                                            placeholder="DD/MM/YYYY"
                                            className={`w-full h-10 bg-gray-50 border ${previewErrors.date_of_birth ? 'border-red-300' : 'border-gray-200'} rounded-md px-3 text-gray-900 text-sm placeholder:text-gray-400 focus:outline-none focus:bg-white focus:ring-1 focus:ring-gray-300 transition-all ${previewFormData.date_of_birth.length === 10 && !previewErrors.date_of_birth ? 'pr-10' : ''}`}
                                            maxLength={10}
                                          />
                                          {previewFormData.date_of_birth.length === 10 && !previewErrors.date_of_birth && <CheckCircle2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-green-500" />}
                                        </div>
                                        {previewErrors.date_of_birth && <p className="text-red-500 text-xs mt-1">{previewErrors.date_of_birth}</p>}
                                      </PreviewField>
                                    )}

                                    {fieldId === 'postal_code' && (
                                      <PreviewField label="Postal Code" textColor={currentDesign.textColor}>
                                        <div className="relative">
                                          <input type="text" maxLength={6} value={previewFormData.postal_code}
                                            onChange={(e) => handlePreviewInputChange('postal_code', e.target.value.replace(/\D/g, ''))}
                                            placeholder="520230"
                                            className={`w-full h-10 bg-gray-50 border ${previewErrors.postal_code ? 'border-red-300' : 'border-gray-200'} rounded-md px-3 text-gray-900 text-sm placeholder:text-gray-400 focus:outline-none focus:bg-white focus:ring-1 focus:ring-gray-300 transition-all ${previewFormData.postal_code.length === 6 ? 'pr-10' : ''}`}
                                          />
                                          {previewFormData.postal_code.length === 6 && <CheckCircle2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-green-500" />}
                                        </div>
                                        {previewErrors.postal_code && <p className="text-red-500 text-xs mt-1">{previewErrors.postal_code}</p>}
                                      </PreviewField>
                                    )}

                                    {fieldId === 'education_level' && (
                                      <PreviewField label="Education" textColor={currentDesign.textColor}>
                                        <div className="relative">
                                          <select value={previewFormData.education_level}
                                            onChange={(e) => setPreviewFormData(prev => ({ ...prev, education_level: e.target.value }))}
                                            className="w-full h-10 bg-gray-50 border border-gray-200 rounded-md px-3 text-gray-900 text-sm focus:outline-none focus:bg-white focus:ring-1 focus:ring-gray-300 transition-all appearance-none">
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
                                      </PreviewField>
                                    )}

                                    {fieldId === 'monthly_income' && (
                                      <PreviewField label="Income" textColor={currentDesign.textColor}>
                                        <div className="relative">
                                          <select value={previewFormData.monthly_income}
                                            onChange={(e) => setPreviewFormData(prev => ({ ...prev, monthly_income: e.target.value }))}
                                            className="w-full h-10 bg-gray-50 border border-gray-200 rounded-md px-3 text-gray-900 text-sm focus:outline-none focus:bg-white focus:ring-1 focus:ring-gray-300 transition-all appearance-none">
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
                                      </PreviewField>
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
                    <div className="w-full h-12 flex items-center justify-center rounded-lg shadow-sm text-white font-medium text-base transition-all transform active:scale-[0.98]"
                      style={{ backgroundColor: currentDesign.themeColor || '#111827', cursor: 'pointer' }}>
                      {currentDesign.ctaText || 'Submit Application'}
                    </div>
                  </div>

                  {/* Terms Footer */}
                  <div className="pt-4 text-center">
                    <p className="text-[10px] text-gray-400 leading-relaxed">
                      By signing up, you agree to our{' '}
                      <button type="button" onClick={() => setConsentOpen(true)} className="text-blue-600 hover:underline">Terms & Conditions</button>.
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
      </div>

      <MarketingConsentDialog open={consentOpen} onOpenChange={setConsentOpen} content={currentDesign.termsContent} />
    </div>
  );
}

function PreviewField({ label, textColor, children }) {
  return (
    <div>
      <label className="block text-gray-700 text-sm font-medium mb-1.5" style={{ color: textColor }}>{label}</label>
      {children}
    </div>
  );
}
