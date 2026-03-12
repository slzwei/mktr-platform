import { useState, useEffect } from "react";
import { Eye } from "lucide-react";
import { arrayMove } from '@dnd-kit/sortable';
import MarketingConsentDialog from "@/components/legal/MarketingConsentDialog";
import { getBackgroundClass, getCardClass } from "../LeadCaptureLayout";
import { COMBINABLE_FIELDS, SG_PHONE_PREFIXES } from './constants';
import PreviewHeaderMedia from "@/components/campaigns/editor/preview/PreviewHeaderMedia";
import PreviewFormFooter from "@/components/campaigns/editor/preview/PreviewFormFooter";
import PreviewTrustFooter from "@/components/campaigns/editor/preview/PreviewTrustFooter";
import PreviewHeadline from "@/components/campaigns/editor/preview/PreviewHeadline";
import PreviewSortableFields from "@/components/campaigns/editor/preview/PreviewSortableFields";

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

  const fieldRendererProps = {
    currentDesign,
    previewFormData,
    setPreviewFormData,
    previewPhoneVerification,
    setPreviewPhoneVerification,
    previewErrors,
    formatPhoneDisplay,
    handlePreviewPhoneChange,
    handlePreviewSendOTP,
    handleVerifyOtp,
    handlePreviewInputChange,
    handlePreviewDOBChange,
  };

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
                <PreviewHeaderMedia currentDesign={currentDesign} />

                {/* Form Content */}
                <div className="p-6">
                  <PreviewHeadline currentDesign={currentDesign} />

                  <PreviewSortableFields
                    currentDesign={currentDesign}
                    mergePreview={mergePreview}
                    onDragStart={handleDragStart}
                    onDragOver={handleDragOver}
                    onDragEnd={handleDragEnd}
                    onDragCancel={handleDragCancel}
                    onSplitRow={handleSplitRow}
                    fieldRendererProps={fieldRendererProps}
                  />

                  <PreviewFormFooter currentDesign={currentDesign} onConsentOpen={() => setConsentOpen(true)} />
                </div>
              </div>

              <PreviewTrustFooter />
            </div>
          </div>
        </div>
      </div>

      <MarketingConsentDialog open={consentOpen} onOpenChange={setConsentOpen} content={currentDesign.termsContent} />
    </div>
  );
}
