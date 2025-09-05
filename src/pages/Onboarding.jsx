import { useEffect, useMemo, useState, Fragment, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import PhoneIcon from 'lucide-react/icons/phone';
import ShieldCheck from 'lucide-react/icons/shield-check';
import CheckCircle2 from 'lucide-react/icons/check-circle-2';
import AlertCircle from 'lucide-react/icons/alert-circle';
import X from 'lucide-react/icons/x';
import { sendOtp, verifyOtp } from '@/components/lib/customFunctions';
import makeModelsRaw from '@/data/mktr_make_models.json';
import { useNavigate, Link } from 'react-router-dom';
import { apiClient, auth } from '@/api/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import Loader2 from 'lucide-react/icons/loader-2';
import CarIcon from 'lucide-react/icons/car';
import UserIcon from 'lucide-react/icons/user';
import BuildingIcon from 'lucide-react/icons/building-2';
import { AnimatePresence, motion } from 'framer-motion';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import ChevronsDown from 'lucide-react/icons/chevrons-down';
import ChevronsUp from 'lucide-react/icons/chevrons-up';

const makesToModels = Object.keys(makeModelsRaw || {}).reduce((acc, make) => {
  const list = Array.isArray(makeModelsRaw[make]) ? makeModelsRaw[make].filter(Boolean) : [];
  acc[make] = list;
  return acc;
}, {});

// Allowed SG series prefixes per business rules
const LETTERS_NO_IO = ['A','B','C','D','E','F','G','H','J','K','L','M','N','P','Q','R','S','T','U','V','W','X','Y','Z'];
const SERIES_SECOND_LETTERS = ['B','C','D','F','G','J','K','L','M','N']; // SB, SC, SD, SF, SG, SJ, SK, SL, SM, SN
const ALLOWED_PREFIXES = new Set([
  // E-series: EA, EB, ..., EZ (excluding I, O)
  ...LETTERS_NO_IO.map((l) => `E${l}`),
  // S-series blocks: SBx, SCx, ... SNx (excluding I, O for x)
  ...SERIES_SECOND_LETTERS.flatMap((sec) => LETTERS_NO_IO.map((third) => `S${sec}${third}`))
]);

function LoadingButton({ loading, children, ...props }) {
  return (
    <Button disabled={loading} {...props}>
      {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
      {children}
    </Button>
  );
}

export default function Onboarding() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [step, setStep] = useState(0);
  const [maxVisitedStep, setMaxVisitedStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});
  const [otp, setOtp] = useState('');
  const [otpState, setOtpState] = useState('idle'); // 'idle' | 'pending' | 'verified'
  const [loadingPhase, setLoadingPhase] = useState(null); // 'sending' | 'verifying' | null
  const [resendCooldown, setResendCooldown] = useState(0);
  const [showSuccessTick, setShowSuccessTick] = useState(false);
  const [ageError, setAgeError] = useState('');
  const [dobIncomplete, setDobIncomplete] = useState(false);

  // Shared fields
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [dob, setDob] = useState('');
  const [companyName, setCompanyName] = useState('');

  // Role selection
  const [role, setRole] = useState(null); // driver_partner | agent | fleet_owner

  // Payout
  const [payoutMethod, setPayoutMethod] = useState('PayNow');
  const [paynowId, setPaynowId] = useState('');
  const [paynowType, setPaynowType] = useState('mobile'); // 'mobile' | 'nric' | 'uen'
  const [bankName, setBankName] = useState('');
  const [bankAccount, setBankAccount] = useState('');

  // Car
  const [plate, setPlate] = useState('');
  const [make, setMake] = useState('');
  const models = useMemo(() => makesToModels[make] || [], [make]);
  const [model, setModel] = useState('');
  const [customMake, setCustomMake] = useState('');
  const [customModel, setCustomModel] = useState('');

  // Fleet bulk
  const [carsCsv, setCarsCsv] = useState('');
  const [carsRows, setCarsRows] = useState([{ plate_number: '', make: '', model: '' }]);
  const gridRef = useRef(null);
  const [gridShowDownHint, setGridShowDownHint] = useState(false);
  const [gridShowUpHint, setGridShowUpHint] = useState(false);
  const [carsSaved, setCarsSaved] = useState(false);
  const [savedCars, setSavedCars] = useState([]);
  const [rowErrors, setRowErrors] = useState([]);

  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const update = () => {
      const scrollable = el.scrollHeight > el.clientHeight + 1;
      const atTop = el.scrollTop <= 1;
      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
      setGridShowDownHint(scrollable && atTop);
      setGridShowUpHint(scrollable && atBottom);
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
    };
  }, [carsRows]);

  useEffect(() => {
    auth.getCurrentUser(true).then(setUser).catch(() => setUser(null));
  }, []);

  useEffect(() => {
    setMaxVisitedStep((prev) => Math.max(prev, step));
  }, [step]);

  useEffect(() => {
    let timer;
    if (resendCooldown > 0) {
      timer = setTimeout(() => setResendCooldown((s) => s - 1), 1000);
    }
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  // Live per-row validation for format and duplicates
  useEffect(() => {
    const normalizedPlates = carsRows.map(r => formatPlateInputToStrict(r.plate_number));
    const counts = normalizedPlates.reduce((acc, p) => { if (p) acc[p] = (acc[p]||0)+1; return acc; }, {});
    const nextErrors = carsRows.map((r, idx) => {
      const plate = normalizedPlates[idx];
      if (!plate) return '';
      // Show format hint if not matching expected pattern yet
      if (!isValidAllowedPlateFormat(plate)) {
        return 'Format: Prefix (EA–EZ or SB–SN) + 1–4 digits + letter';
      }
      // Duplicate check
      if (counts[plate] > 1) return 'Duplicate plate in list';
      return '';
    });
    setRowErrors(nextErrors);
  }, [carsRows]);

  // Ensure that once verified, any lingering phone errors are cleared from UI
  useEffect(() => {
    if (otpState === 'verified') {
      setErrors((prev) => ({ ...prev, phone: undefined, _server: undefined }));
    }
  }, [otpState]);

  // Default PayNow mobile to verified number on entering payout step
  useEffect(() => {
    if (step === 1 && payoutMethod === 'PayNow' && paynowType === 'mobile') {
      if (isValidSgMobile(phone)) {
        const desired = `+65${phone}`;
        if (paynowId !== desired) setPaynowId(desired);
      }
    }
  }, [step, payoutMethod, paynowType, phone]);

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black text-white">
        <Loader2 className="h-6 w-6 animate-spin mr-2" /> Loading...
      </div>
    );
  }

  const next = () => setStep((s) => s + 1);
  const back = () => setStep((s) => Math.max(0, s - 1));
  const goToStep = (target) => {
    if (typeof target !== 'number') return;
    // Allow navigation to any step up to maxVisitedStep
    if (target <= maxVisitedStep) setStep(target);
  };

  function resetForRoleChange(newRole) {
    // Reset wizard state when role changes
    setStep(0);
    setMaxVisitedStep(0);
    setFirstName('');
    setLastName('');
    setPhone('');
    setOtp('');
    setOtpState('idle');
    setLoadingPhase(null);
    setResendCooldown(0);
    setShowSuccessTick(false);
    setDob('');
    setAgeError('');
    setDobIncomplete(false);
    setCompanyName('');
    setPayoutMethod('PayNow');
    setPaynowType('mobile');
    setPaynowId('');
    setBankName('');
    setBankAccount('');
    setPlate('');
    setMake('');
    setModel('');
    setCustomMake('');
    setCustomModel('');
    setCarsCsv('');
    setCarsRows([{ plate_number: '', make: '', model: '' }]);
    setCarsSaved(false);
    setErrors({});
  }

  function changeRole(newRole) {
    if (newRole === role) return;
    setRole(newRole);
    resetForRoleChange(newRole);
  }

  function sanitizePhoneInput(value) {
    let digits = String(value || '').replace(/\D/g, '');
    if (digits.startsWith('65') && digits.length > 8) {
      digits = digits.slice(2);
    }
    return digits.slice(0, 8);
  }

  function isValidSgMobile(eightDigits) {
    return /^(?:[3689])\d{7}$/.test(eightDigits);
  }

  // Simplified Singapore plate validation: 1-3 letters, 1-4 digits, 1 letter (e.g., SGP1234A)
  function isValidSgPlate(value) {
    return isValidAllowedPlateFormat(value);
  }

  // Validate Singapore NRIC/FIN with checksum for S/T (NRIC) and F/G/M (FIN)
  function isValidNricFin(value) {
    const v = String(value || '').toUpperCase();
    if (!/^[STFGM]\d{7}[A-Z]$/.test(v)) return false;
    const prefix = v[0];
    const digits = v.slice(1, 8).split('').map((c) => Number(c));
    const weights = [2, 7, 6, 5, 4, 3, 2];
    let sum = digits.reduce((acc, d, i) => acc + d * weights[i], 0);
    // T/G/M series offset (post-2000). Treat M like G for checksum.
    if (prefix === 'T' || prefix === 'G' || prefix === 'M') sum += 4;
    const stMap = ['J', 'Z', 'I', 'H', 'G', 'F', 'E', 'D', 'C', 'B', 'A'];
    const fgMap = ['X', 'W', 'U', 'T', 'R', 'Q', 'P', 'N', 'M', 'L', 'K'];
    const map = (prefix === 'S' || prefix === 'T') ? stMap : fgMap;
    const expected = map[sum % 11];
    return v[8] === expected;
  }

  function getFullPhoneNumber() {
    return `+65${phone}`;
  }

  async function handleSendOtp() {
    if (!isValidSgMobile(phone)) {
      setErrors((prev) => ({ ...prev, phone: 'Enter a valid SG number starting with 3, 6, 8, or 9' }));
      return;
    }
    setLoadingPhase('sending');
    setErrors((prev) => ({ ...prev, _server: undefined }));
    try {
      const resp = await sendOtp(getFullPhoneNumber());
      const result = resp?.data || resp;
      if (result?.success) {
        setOtpState('pending');
        setResendCooldown(30);
      } else {
        setErrors((prev) => ({ ...prev, _server: result?.message || 'Failed to send code' }));
      }
    } catch (e) {
      setErrors((prev) => ({ ...prev, _server: e?.message || 'Failed to send code' }));
    } finally {
      setLoadingPhase(null);
    }
  }

  async function handleVerifyOtp() {
    if ((otp || '').length < 6) {
      setErrors((prev) => ({ ...prev, _server: 'Please enter the 6-digit OTP.' }));
      return;
    }
    setLoadingPhase('verifying');
    setErrors((prev) => ({ ...prev, _server: undefined }));
    try {
      const resp = await verifyOtp(getFullPhoneNumber(), otp);
      const result = resp?.data || resp;
      if (result?.success) {
        // Clear any previous phone-related errors
        setErrors((prev) => ({ ...prev, phone: undefined, _server: undefined }));
        setShowSuccessTick(true);
        setTimeout(() => {
          setOtpState('verified');
          setShowSuccessTick(false);
        }, 900);
      } else {
        setErrors((prev) => ({ ...prev, _server: result?.message || 'Verification failed' }));
        setOtp('');
      }
    } catch (e) {
      setErrors((prev) => ({ ...prev, _server: e?.message || 'Verification failed' }));
      setOtp('');
    } finally {
      setLoadingPhase(null);
    }
  }

  function handleCancelOtp() {
    setOtpState('idle');
    setOtp('');
    setErrors((prev) => ({ ...prev, _server: undefined }));
    setResendCooldown(0);
  }


  function formatDateInput(value) {
    let digits = String(value || '').replace(/\D/g, '');
    digits = digits.slice(0, 8);
    if (digits.length >= 3) digits = digits.slice(0, 2) + '/' + digits.slice(2);
    if (digits.length >= 6) digits = digits.slice(0, 5) + '/' + digits.slice(5);
    return digits;
  }

  function calculateAge(dateString) {
    if (!dateString || dateString.length !== 10) return null;
    const [dayStr, monthStr, yearStr] = dateString.split('/');
    const day = Number(dayStr), month = Number(monthStr), year = Number(yearStr);
    if (!day || !month || !year) return null;
    if (day < 1 || day > 31 || month < 1 || month > 12 || year < 1900) return null;
    const birthDate = new Date(year, month - 1, day);
    if (birthDate.getDate() !== day || (birthDate.getMonth() + 1) !== month || birthDate.getFullYear() !== year) return null;
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const m = today.getMonth() - birthDate.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) age--;
    return age;
  }

  function handleDobChange(value) {
    const formatted = formatDateInput(value);
    setDob(formatted);
    // Incomplete check
    const digitsOnly = formatted.replace(/\D/g, '');
    if (digitsOnly.length > 0 && digitsOnly.length !== 8) setDobIncomplete(true); else setDobIncomplete(false);
    // Age/date validation
    if (digitsOnly.length === 8) {
      const age = calculateAge(formatted);
      if (age === null) {
        setAgeError('Please enter a valid date of birth');
      } else if (age < 18 || age > 75) {
        setAgeError('Age must be between 18 and 75');
      } else {
        setAgeError('');
      }
    } else {
      setAgeError('');
    }
    if (errors.dob) setErrors((prev) => ({ ...prev, dob: undefined }));
  }

  async function saveBasic() {
    setLoading(true);
    try {
      // Client-side validation
      const newErrors = {};
      if (!firstName.trim()) newErrors.firstName = 'First name is required';
      if (!lastName.trim()) newErrors.lastName = 'Last name is required';
      if (!phone.trim()) newErrors.phone = 'Phone number is required';
      if (phone && !isValidSgMobile(phone)) newErrors.phone = 'Enter a valid SG number starting with 3, 6, 8, or 9';
      // DOB validations using DD/MM/YYYY format
      if (dob && (role === 'agent' || role === 'driver_partner')) {
        const digitsOnly = dob.replace(/\D/g, '');
        if (digitsOnly.length !== 8) newErrors.dob = 'Please enter full DOB (DD/MM/YYYY)';
        const age = calculateAge(dob);
        if (age === null) newErrors.dob = newErrors.dob || 'Please enter a valid date of birth';
        else if (age < 18 || age > 75) newErrors.dob = 'Age must be between 18 and 75';
      }
      if (otpState !== 'verified') newErrors.phone = newErrors.phone || 'Please verify your phone number';
      if (Object.keys(newErrors).length > 0) {
        setErrors(newErrors);
        return;
      }
      // Convert to ISO YYYY-MM-DD if provided
      let dobIso;
      if (dob && dob.length === 10 && (role === 'agent' || role === 'driver_partner')) {
        const [d, m, y] = dob.split('/');
        const parsed = new Date(Number(y), Number(m) - 1, Number(d));
        if (!isNaN(parsed.getTime())) dobIso = `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      }
      const profilePayload = {
        firstName,
        lastName,
        phone
      };
      if ((role === 'agent' || role === 'driver_partner') && dobIso) profilePayload.dateOfBirth = dobIso;
      if ((role === 'agent' || role === 'fleet_owner') && companyName) profilePayload.companyName = companyName;

      const profileResp = await apiClient.put('/auth/profile', profilePayload);
      const roleResp = await apiClient.post('/auth/onboarding/role', { role });
      try {
        // Refresh cached user so ProtectedRoute sees latest role
        const refreshed = await auth.getCurrentUser(true);
        if (refreshed) {
          // no-op, just ensuring local cache is updated
        }
      } catch (_) {}
      next();
    } catch (e) {
      // Surface server-side validation errors, if present
      setErrors((prev) => ({ ...prev, _server: e?.message || 'Validation failed' }));
    } finally {
      setLoading(false);
    }
  }

  async function savePayout() {
    setLoading(true);
    try {
      // Client-side validation
      const newErrors = {};
      if (payoutMethod === 'PayNow') {
        if (paynowType === 'mobile') {
          let digits = String(paynowId || '').replace(/\D/g,'');
          if (digits.startsWith('65')) digits = digits.slice(2);
          if (!digits) newErrors.paynowId = 'PayNow mobile is required';
          else if (!/^[3689]/.test(digits)) newErrors.paynowId = 'Must start with 3, 6, 8, or 9';
          else if (digits.length !== 8) newErrors.paynowId = 'Enter 8 digits';
          else if (!isValidSgMobile(digits)) newErrors.paynowId = 'Invalid Singapore mobile number';
        } else if (paynowType === 'nric') {
          const v = String(paynowId || '').toUpperCase();
          if (!v) newErrors.paynowId = 'NRIC/FIN is required';
          else if (!isValidNricFin(v)) newErrors.paynowId = 'Enter valid NRIC/FIN (e.g., S1234567A)';
        } else if (paynowType === 'uen') {
          const v = String(paynowId || '').toUpperCase();
          const ok = (/^\d{8}[A-Z]$/.test(v)) || (/^\d{9}[A-Z]$/.test(v)) || (/^[ST]\d{2}[A-Z]\d{4}[A-Z]$/.test(v));
          if (!v) newErrors.paynowId = 'UEN is required';
          else if (!ok) newErrors.paynowId = 'Enter valid UEN (9 or 10 chars, ends with letter)';
        }
      } else if (payoutMethod === 'Bank Transfer') {
        if (!bankName.trim()) newErrors.bankName = 'Bank name is required';
        if (!bankAccount.trim()) newErrors.bankAccount = 'Account number is required';
      }
      if (Object.keys(newErrors).length > 0) {
        setErrors(newErrors);
        return;
      }
      let finalPaynowId = undefined;
      if (payoutMethod === 'PayNow') {
        if (paynowType === 'mobile') {
          let digits = String(paynowId || '').replace(/\D/g,'');
          if (digits.startsWith('65')) digits = digits.slice(2);
          finalPaynowId = `+65${digits}`;
        } else {
          finalPaynowId = String(paynowId || '').toUpperCase();
        }
      }

      await apiClient.post('/auth/onboarding/payout', {
        method: payoutMethod,
        paynowId: payoutMethod === 'PayNow' ? finalPaynowId : null,
        bankName: payoutMethod === 'Bank Transfer' ? bankName : null,
        bankAccount: payoutMethod === 'Bank Transfer' ? bankAccount : null
      });
      next();
    } catch (e) {
      setErrors((prev) => ({ ...prev, _server: e?.message || 'Validation failed' }));
    } finally {
      setLoading(false);
    }
  }

  async function createCar() {
    setLoading(true);
    try {
      const finalMake = make === 'Other' ? (customMake || '').trim() : make;
      const finalModel = (make === 'Other' || model === 'Other') ? (customModel || '').trim() : model;
      const plateClean = String(plate || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

      const newErrors = {};
      if (!plateClean) newErrors.plate = 'Car plate is required';
      else if (!isValidAllowedPlateFormat(plateClean)) newErrors.plate = 'Enter valid car plate (EA–EZ or SB–SN + 1–4 digits + letter)';
      // Validate make/model selections and custom inputs
      if (!make) newErrors.make = 'Please select the car make';
      if (make === 'Other' && !finalMake) newErrors.customMake = 'Please enter the car make';
      if (make !== 'Other' && !model) newErrors.model = 'Please select the car model';
      if ((make === 'Other' || model === 'Other') && !finalModel) newErrors.customModel = 'Please enter the car model';
      if (Object.keys(newErrors).length > 0) {
        setErrors((prev) => ({ ...prev, ...newErrors }));
        return;
      }

      await apiClient.post('/auth/onboarding/car', {
        plate_number: plateClean,
        make: finalMake,
        model: finalModel
      });
      // After submitting, move all roles to PendingApproval for review
      navigate('/PendingApproval');
    } catch (e) {
      setErrors((prev)=>({ ...prev, _server: e?.message || 'Failed to create car' }));
    } finally {
      setLoading(false);
    }
  }

  async function bulkCreateCars() {
    setLoading(true);
    try {
      // Prefer grid rows if they contain any complete entries; else fallback to CSV textarea
      const gridCars = (carsRows || [])
        .map(r => ({
          plate_number: String(r.plate_number || '').trim(),
          make: String(r.make || '').trim(),
          model: String(r.model || '').trim()
        }))
        .filter(r => r.plate_number && r.make && r.model);

      let cars = gridCars;

      if (cars.length === 0) {
        // Expect CSV with headers: plate_number,make,model
        const rows = carsCsv
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean);
        const header = rows.shift()?.toLowerCase();
        const parsed = [];
        for (const row of rows) {
          const [p, m, mo] = row.split(',').map((s) => s.trim());
          if (p && m && mo) parsed.push({ plate_number: String(p).toUpperCase(), make: String(m).toUpperCase(), model: String(mo).toUpperCase() });
        }
        cars = parsed;
      }

      if (cars.length === 0) throw new Error('No valid rows');
      await apiClient.post('/auth/onboarding/cars/bulk', { cars });
      navigate('/PendingApproval');
    } catch (e) {
      alert(e.message || 'Failed to import');
    } finally {
      setLoading(false);
    }
  }

  function parseCsvToRows(text) {
    const lines = String(text || '')
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(Boolean);
    if (lines.length === 0) return [];
    const header = (lines.shift() || '').toLowerCase();
    const cols = header.split(',').map(s => s.trim());
    const idxPlate = cols.indexOf('plate_number');
    const idxMake = cols.indexOf('make');
    const idxModel = cols.indexOf('model');
    if (idxPlate === -1 || idxMake === -1 || idxModel === -1) return [];
    const out = [];
    for (const line of lines) {
      const parts = line.split(',').map(s => s.trim());
      const p = (parts[idxPlate] || '').toUpperCase();
      const m = (parts[idxMake] || '').toUpperCase();
      const mo = (parts[idxModel] || '').toUpperCase();
      if (p || m || mo) out.push({ plate_number: p, make: m, model: mo });
    }
    return out;
  }

  function loadRowsFromCsvString(text) {
    const rows = parseCsvToRows(text);
    if (rows.length > 0) setCarsRows(rows);
  }

  function letterToNumber(ch) {
    const code = ch.charCodeAt(0) - 64; // 'A' => 1
    return code >= 1 && code <= 26 ? code : 0;
  }

  function isValidSgPlateStrict(raw) {
    // Use the allowed-prefix format validation (1-4 digits, trailing letter)
    return isValidAllowedPlateFormat(raw);
  }

  function formatPlateInputToStrict(plate) {
    const v = String(plate || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    return v;
  }

  function isValidAllowedPlateFormat(raw) {
    const v = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!v) return false;
    let prefix = '';
    if (v.startsWith('S')) {
      prefix = v.slice(0, 3);
    } else if (v.startsWith('E')) {
      prefix = v.slice(0, 2);
    } else {
      return false;
    }
    if (!ALLOWED_PREFIXES.has(prefix)) return false;
    const rest = v.slice(prefix.length);
    // Must be 1-4 digits then 1 trailing letter
    const match = rest.match(/^(\d{1,4})([A-Z])$/);
    if (!match) return false;
    return true;
  }

  function collectGridCars() {
    return (carsRows || [])
      .map(r => ({
        plate_number: formatPlateInputToStrict(r.plate_number),
        make: String(r.make || '').trim(),
        model: String(r.model || '').trim()
      }))
      .filter(r => r.plate_number && r.make && r.model);
  }

  function findDuplicatePlates(rows) {
    const seen = new Map();
    const dups = new Set();
    for (const r of rows) {
      const key = String(r.plate_number || '').toUpperCase();
      if (seen.has(key)) dups.add(key); else seen.set(key, true);
    }
    return Array.from(dups.values());
  }

  

  async function validateAndStageCars() {
    // Build from grid rows
    const cars = collectGridCars();
    if (cars.length === 0) {
      alert('No valid rows. Please add at least one complete row.');
      return;
    }
    // Duplicate check
    const dups = findDuplicatePlates(cars);
    if (dups.length > 0) {
      alert(`Duplicate car plates found: ${dups.join(', ')}`);
      return;
    }
    // Strict format validation per allowed prefixes and 1–4 digits
    const invalid = cars.filter(c => !isValidAllowedPlateFormat(c.plate_number));
    if (invalid.length > 0) {
      alert(`Invalid car plates (format failed): ${invalid.map(i=>i.plate_number).join(', ')}`);
      return;
    }
    setSavedCars(cars);
    setCarsSaved(true);
  }

  async function finalizeFleetCars() {
    setLoading(true);
    try {
      if (!carsSaved || !savedCars || savedCars.length === 0) {
        alert('Please save the car list first.');
        return;
      }
      await apiClient.post('/auth/onboarding/cars/bulk', { cars: savedCars });
      navigate('/PendingApproval');
    } catch (e) {
      alert(e?.message || 'Failed to save cars');
    } finally {
      setLoading(false);
    }
  }

  function handleCsvFileChange(e) {
    try {
      const file = e?.target?.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const text = String(reader.result || '');
        setCarsCsv(text);
        loadRowsFromCsvString(text);
      };
      reader.onerror = () => {
        alert('Failed to read file');
      };
      reader.readAsText(file);
    } catch (_) {
      alert('Could not open the selected file');
    }
  }

  const stepTitle = (() => {
    if (step === 0) return 'Tell us about yourself';
    if (step === 1) return 'How should we pay your commissions?';
    if (step === 2) {
      if (role === 'driver_partner') return 'Tell us about your car!';
      if (role === 'fleet_owner') return 'Add your fleet details';
      if (role === 'agent') return 'You’re all set — ready to start?';
    }
    return 'Welcome! Let’s set up your account';
  })();

  const steps = [
    { key: 0, label: 'Profile' },
    { key: 1, label: 'Payout' },
    { key: 2, label: role === 'driver_partner' ? 'Vehicle' : role === 'fleet_owner' ? 'Fleet' : 'Done' }
  ];

  const roleLabel = role === 'driver_partner' ? 'Driver' : (role === 'fleet_owner' ? 'Fleet Owner' : 'Agent');

  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-4">
      <div className="absolute top-6 left-6 z-10">
        <Link to="/">
          <Button variant="outline" className="gap-2">
            <ArrowLeft className="w-4 h-4" />
            Back to Home
          </Button>
        </Link>
      </div>
      <Card className={`w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden`}>
        <CardHeader className="border-b">
          <div className="flex flex-col items-center text-center gap-3">
            <div className="flex items-center justify-center">
              {steps.map((s, i) => (
                <Fragment key={s.key}>
                  <div className="flex flex-col items-center">
                    <button
                      type="button"
                      onClick={() => goToStep(i)}
                      aria-label={`Go to ${s.label}`}
                      className={`${i <= maxVisitedStep ? 'cursor-pointer hover:opacity-80' : 'cursor-not-allowed'} ${i <= step ? 'bg-black' : 'bg-gray-300'} w-3 h-3 rounded-full`}
                      disabled={i > maxVisitedStep}
                    />
                    <button
                      type="button"
                      onClick={() => goToStep(i)}
                      className={`mt-2 text-gray-600 text-sm md:text-base font-medium ${i <= maxVisitedStep ? 'hover:underline cursor-pointer' : 'cursor-not-allowed'}`}
                      aria-label={`Go to ${s.label}`}
                      disabled={i > maxVisitedStep}
                    >
                      {s.label}
                    </button>
                  </div>
                  {i < steps.length - 1 && (
                    <div className={`${i < step ? 'bg-black' : 'bg-gray-300'} h-0.5 w-16 sm:w-24 mx-2`}></div>
                  )}
                </Fragment>
              ))}
            </div>
            {step === 1 && (
              <div className="text-sm text-gray-600">Signing up as a <span className="font-medium">{roleLabel}</span></div>
            )}
            <CardTitle className="text-xl">{stepTitle}</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="relative overflow-hidden">
            <div
              className="flex transition-transform duration-500 ease-in-out"
              style={{ transform: `translateX(-${step * 100}%)` }}
            >
              {/* Step 1 */}
              <div className="w-full flex-shrink-0 p-6 space-y-4">
                <div>
                  <label className="block text-sm text-gray-600 mb-1">I am signing up as</label>
                  <div className="grid grid-cols-3 gap-2">
                    <button onClick={() => changeRole('agent')} className={`rounded p-3 flex flex-col items-center ${role==='agent'?'border-2 border-black bg-orange-300':'border border-gray-200 bg-orange-100'}`}>
                      <UserIcon className="h-5 w-5" />
                      <span className={`text-xs mt-1 ${role==='agent' ? 'font-bold' : ''}`}>Salesperson</span>
                    </button>
                    <button onClick={() => changeRole('driver_partner')} className={`rounded p-3 flex flex-col items-center ${role==='driver_partner'?'border-2 border-black bg-blue-300':'border border-gray-200 bg-blue-100'}`}>
                      <CarIcon className="h-5 w-5" />
                      <span className={`text-xs mt-1 ${role==='driver_partner' ? 'font-bold' : ''}`}>Driver</span>
                    </button>
                    <button onClick={() => changeRole('fleet_owner')} className={`rounded p-3 flex flex-col items-center ${role==='fleet_owner'?'border-2 border-black bg-green-300':'border border-gray-200 bg-green-100'}`}>
                      <BuildingIcon className="h-5 w-5" />
                      <span className={`text-xs mt-1 ${role==='fleet_owner' ? 'font-bold' : ''}`}>Fleet Owner</span>
                    </button>
                  </div>
                </div>
                <AnimatePresence>
                  {role && (
                    <motion.div
                      key="profile-fields"
                      initial={{ height: 0, opacity: 0, y: -8 }}
                      animate={{ height: 'auto', opacity: 1, y: 0 }}
                      exit={{ height: 0, opacity: 0, y: -8 }}
                      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                      style={{ overflow: 'hidden' }}
                    >
                      {errors._server && (
                        <div className="text-red-600 text-sm mb-2">{errors._server}</div>
                      )}
                      <div className="space-y-2">
                        <label className="block text-sm text-gray-600">Full name</label>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <div>
                            <input
                              className={`w-full border rounded p-2 ${errors.firstName ? 'border-red-500' : ''}`}
                              value={firstName}
                              onChange={e=>{ setFirstName(e.target.value); if (errors.firstName) setErrors(prev=>({ ...prev, firstName: undefined })); }}
                              placeholder="First name"
                              name="given-name"
                              autoComplete="given-name"
                              aria-invalid={!!errors.firstName}
                            />
                            {errors.firstName && <div className="text-red-600 text-xs mt-1">{errors.firstName}</div>}
                          </div>
                          <div>
                            <input
                              className={`w-full border rounded p-2 ${errors.lastName ? 'border-red-500' : ''}`}
                              value={lastName}
                              onChange={e=>{ setLastName(e.target.value); if (errors.lastName) setErrors(prev=>({ ...prev, lastName: undefined })); }}
                              placeholder="Last name"
                              name="family-name"
                              autoComplete="family-name"
                              aria-invalid={!!errors.lastName}
                            />
                            {errors.lastName && <div className="text-red-600 text-xs mt-1">{errors.lastName}</div>}
                          </div>
                        </div>
                        <div className="mt-2">
                          <label className="block text-sm text-gray-600 mb-1">Email (from Google)</label>
                          <input
                            className="w-full border rounded p-2 bg-gray-100 text-gray-700 cursor-not-allowed"
                            value={user?.email || ''}
                            disabled
                            readOnly
                            tabIndex={-1}
                            aria-readonly="true"
                          />
                        </div>
                        <Label className="block text-sm text-gray-600 mb-1">Handphone number</Label>
                        <div className="flex items-center gap-1">
                          <div className="flex-grow flex">
                            <div className="flex items-center px-3 bg-gray-50 border border-r-0 rounded-l-md h-9 text-sm font-medium text-gray-700 whitespace-nowrap">
                              🇸🇬 +65
                            </div>
                            <div className="relative flex-grow">
                              <PhoneIcon className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                              <Input
                                type="tel"
                                inputMode="numeric"
                                placeholder="9123 4567"
                                className={`pl-8 h-9 text-sm rounded-l-none border-l-0 ${errors.phone ? 'border-red-500' : ''}`}
                                value={phone.length <= 4 ? phone : `${phone.slice(0,4)} ${phone.slice(4)}`}
                                onChange={(e)=>{
                                  const v = sanitizePhoneInput(e.target.value);
                                  setPhone(v);
                                  let msg;
                                  if (v.length === 0) {
                                    msg = undefined;
                                  } else if (!/^[3689]/.test(v)) {
                                    msg = 'Must start with 3, 6, 8, or 9';
                                  } else if (v.length < 8) {
                                    msg = 'Enter 8 digits';
                                  } else if (!isValidSgMobile(v)) {
                                    msg = 'Invalid Singapore mobile number';
                                  }
                                  setErrors(prev=>({ ...prev, phone: msg }));
                                }}
                                disabled={otpState !== 'idle'}
                                maxLength={9}
                                name="tel"
                                autoComplete="tel"
                                aria-invalid={!!errors.phone}
                              />
                            </div>
                          </div>
                          {otpState === 'idle' && (
                            <Button
                              type="button"
                              onClick={handleSendOtp}
                              disabled={loadingPhase==='sending' || !isValidSgMobile(phone)}
                              className="w-28 h-9 bg-black hover:bg-gray-800 text-white text-sm"
                            >
                              {loadingPhase==='sending' ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Verify'}
                            </Button>
                          )}
                          {otpState === 'verified' && (
                            <motion.div
                              key="verified-ok"
                              initial={{ scale: 0.9, opacity: 0 }}
                              animate={{ scale: 1, opacity: 1 }}
                              transition={{ type: 'spring', stiffness: 500, damping: 24 }}
                              className="flex items-center justify-center gap-2 text-white font-medium text-sm w-28 h-9 bg-green-500 rounded-md"
                            >
                              <CheckCircle2 className="w-5 h-5" />
                              <motion.span
                                initial={{ scale: 1 }}
                                animate={{ scale: [1, 1.08, 1], filter: ['brightness(1)', 'brightness(1.2)', 'brightness(1)'] }}
                                transition={{ duration: 0.9, times: [0, 0.5, 1] }}
                              >
                                OK
                              </motion.span>
                            </motion.div>
                          )}
                        </div>
                        {errors.phone && <div className="text-red-600 text-xs mt-1">{errors.phone}</div>}
                        <AnimatePresence initial={false}>
                          {otpState === 'pending' && (
                            <motion.div
                              key="otp-panel"
                              initial={{ height: 0, opacity: 0, y: -8 }}
                              animate={{ height: 'auto', opacity: 1, y: 0 }}
                              exit={{ height: 0, opacity: 0, y: -8 }}
                              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                              style={{ overflow: 'hidden' }}
                              className="space-y-2 p-3 bg-gray-50 rounded-lg border mt-2"
                           >
                              <div className="flex items-center justify-between">
                                <Label className="text-sm font-medium text-gray-800">Enter Code</Label>
                                <Button type="button" variant="ghost" size="sm" onClick={handleCancelOtp} className="text-gray-500 hover:text-gray-700 h-6 px-1">
                                  <X className="w-3 h-3" />
                                </Button>
                              </div>
                              <p className="text-xs text-gray-500 !-mt-1">Sent to +65 {phone.length<=4?phone:`${phone.slice(0,4)} ${phone.slice(4)}`}</p>
                              <div className="flex items-center gap-2">
                                <div className="relative flex-grow">
                                  <ShieldCheck className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                                  <Input
                                    type="tel"
                                    inputMode="numeric"
                                    autoComplete="one-time-code"
                                    placeholder="123456"
                                    className="pl-8 tracking-wider h-9 text-sm"
                                    maxLength={6}
                                    value={otp}
                                    onChange={(e)=>setOtp(e.target.value.replace(/\D/g,'').slice(0,6))}
                                  />
                                </div>
                                <Button type="button" size="sm" onClick={handleVerifyOtp} disabled={loadingPhase==='verifying' || showSuccessTick} className={`h-9 px-4 text-sm w-28 ${showSuccessTick ? 'bg-green-500 hover:bg-green-600 text-white' : ''}`}>
                                  {showSuccessTick ? <CheckCircle2 className="w-5 h-5" /> : (loadingPhase==='verifying' ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Confirm')}
                                </Button>
                              </div>
                              <div className="text-center text-xs text-gray-500 pt-1">
                                Didn't receive a code?{' '}
                                <Button type="button" variant="link" size="sm" onClick={handleSendOtp} disabled={resendCooldown>0} className="h-auto p-0 text-xs font-semibold text-blue-600 hover:text-blue-800 disabled:text-gray-500 disabled:no-underline">
                                  {resendCooldown>0 ? (resendCooldown>60 ? `Wait ${Math.ceil(resendCooldown/60)} min` : `Resend in ${resendCooldown}s`) : 'Resend now'}
                                </Button>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                        {(role==='agent' || role==='driver_partner') && (
                          <>
                            <label className="block text-sm text-gray-600">Date of birth</label>
                            <Input
                              type="tel"
                              inputMode="numeric"
                              placeholder="DD/MM/YYYY"
                              className={`w-full border rounded p-2 ${errors.dob || dobIncomplete ? 'border-red-500 focus:border-red-500 focus:ring-red-500' : ''}`}
                              value={dob}
                              onChange={e=>handleDobChange(e.target.value)}
                              onBlur={()=>{
                                const digits = dob.replace(/\D/g,'');
                                setDobIncomplete(digits.length>0 && digits.length!==8);
                              }}
                              maxLength={10}
                              name="bday"
                              autoComplete="bday"
                              aria-invalid={!!(errors.dob || dobIncomplete)}
                            />
                            {(errors.dob || dobIncomplete || ageError) && (
                              <div className="flex items-center gap-1 text-xs text-red-600 bg-red-50 p-1.5 rounded border mt-1">
                                <AlertCircle className="w-3 h-3" />
                                <span>{errors.dob || ageError || 'Please enter full year (DDMMYYYY)'}</span>
                              </div>
                            )}
                          </>
                        )}
                        {(role==='agent' || role==='fleet_owner') && (
                          <>
                            <label className="block text-sm text-gray-600">Company Name (optional)</label>
                            <input className="w-full border rounded p-2" value={companyName} onChange={e=>setCompanyName(e.target.value)} placeholder="Company" name="organization" autoComplete="organization" />
                          </>
                        )}
                      </div>
                      <div className="flex justify-end mt-2">
                        <LoadingButton loading={loading} onClick={saveBasic}>Continue</LoadingButton>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Step 2 */}
              <div className="w-full flex-shrink-0 p-6 space-y-4">
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Commission payout method</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button onClick={()=>setPayoutMethod('PayNow')} className={`border rounded p-3 ${payoutMethod==='PayNow'?'border-black':'border-gray-200'}`}>PayNow</button>
                    <button onClick={()=>setPayoutMethod('Bank Transfer')} className={`border rounded p-3 ${payoutMethod==='Bank Transfer'?'border-black':'border-gray-200'}`}>Bank Transfer</button>
                  </div>
                </div>
                {payoutMethod==='PayNow' && (
                  <div className="space-y-2">
                    <label className="block text-sm text-gray-600">PayNow ID</label>
                    <div className="grid grid-cols-3 gap-2">
                      <button type="button" onClick={()=>{ setPaynowType('mobile'); if (isValidSgMobile(phone)) setPaynowId(`+65${phone}`); else setPaynowId(''); setErrors(prev=>({ ...prev, paynowId: undefined })); }} className={`border rounded p-2 text-sm ${paynowType==='mobile'?'border-black':'border-gray-200'}`}>Mobile</button>
                      <button type="button" onClick={()=>{ setPaynowType('nric'); setPaynowId(''); setErrors(prev=>({ ...prev, paynowId: undefined })); }} className={`border rounded p-2 text-sm ${paynowType==='nric'?'border-black':'border-gray-200'}`}>NRIC/FIN</button>
                      <button type="button" onClick={()=>{ setPaynowType('uen'); setPaynowId(''); setErrors(prev=>({ ...prev, paynowId: undefined })); }} className={`border rounded p-2 text-sm ${paynowType==='uen'?'border-black':'border-gray-200'}`}>UEN</button>
                    </div>

                    {paynowType === 'mobile' && (
                      <div className="flex items-center gap-1">
                        <div className="flex-grow flex">
                          <div className="flex items-center px-3 bg-gray-50 border border-r-0 rounded-l-md h-9 text-sm font-medium text-gray-700 whitespace-nowrap">🇸🇬 +65</div>
                          <div className="relative flex-grow">
                            <PhoneIcon className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                            <Input
                              type="tel"
                              inputMode="numeric"
                              placeholder="9123 4567"
                              className={`pl-8 h-9 text-sm rounded-l-none border-l-0 ${errors.paynowId ? 'border-red-500' : ''}`}
                              value={(function(){
                                const digits = String(paynowId || '').replace(/\D/g,'').replace(/^65/, '').slice(0,8);
                                return digits.length <= 4 ? digits : `${digits.slice(0,4)} ${digits.slice(4)}`;
                              })()}
                              onChange={(e)=>{
                                const raw = e.target.value;
                                let digits = String(raw || '').replace(/\D/g,'');
                                if (digits.startsWith('65')) digits = digits.slice(2);
                                digits = digits.slice(0,8);
                                const nextVal = digits ? `+65${digits}` : '';
                                setPaynowId(nextVal);
                                let msg;
                                if (digits.length === 0) {
                                  msg = 'PayNow mobile is required';
                                } else if (!/^[3689]/.test(digits)) {
                                  msg = 'Must start with 3, 6, 8, or 9';
                                } else if (digits.length < 8) {
                                  msg = 'Enter 8 digits';
                                } else if (!isValidSgMobile(digits)) {
                                  msg = 'Invalid Singapore mobile number';
                                }
                                setErrors(prev=>({ ...prev, paynowId: msg }));
                              }}
                              maxLength={9}
                              aria-invalid={!!errors.paynowId}
                            />
                          </div>
                        </div>
                      </div>
                    )}

                    {paynowType === 'nric' && (
                      <Input
                        type="text"
                        placeholder="e.g. S1234567A"
                        className={`${errors.paynowId ? 'border-red-500' : ''}`}
                        value={paynowId}
                        onChange={(e)=>{
                          const v = String(e.target.value || '').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,9);
                          setPaynowId(v);
                          const valid = isValidNricFin(v);
                          setErrors(prev=>({ ...prev, paynowId: v ? (valid? undefined : 'Enter valid NRIC/FIN (e.g., S1234567A)') : 'NRIC/FIN is required' }));
                        }}
                        aria-invalid={!!errors.paynowId}
                      />
                    )}

                    {paynowType === 'uen' && (
                      <Input
                        type="text"
                        placeholder="e.g. 201912345A"
                        className={`${errors.paynowId ? 'border-red-500' : ''}`}
                        value={paynowId}
                        onChange={(e)=>{
                          const v = String(e.target.value || '').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,10);
                          setPaynowId(v);
                          const valid = (/^\d{8}[A-Z]$/.test(v)) || (/^\d{9}[A-Z]$/.test(v)) || (/^[ST]\d{2}[A-Z]\d{4}[A-Z]$/.test(v));
                          setErrors(prev=>({ ...prev, paynowId: v ? (valid? undefined : 'Enter valid UEN (9 or 10 chars, ends with letter)') : 'UEN is required' }));
                        }}
                        aria-invalid={!!errors.paynowId}
                      />
                    )}

                    {errors.paynowId && <div className="text-red-600 text-xs">{errors.paynowId}</div>}
                  </div>
                )}
                {payoutMethod==='Bank Transfer' && (
                  <div className="grid grid-cols-1 gap-2">
                    <div>
                      <label className="block text-sm text-gray-600">Bank name</label>
                      <select
                        className={`w-full border rounded p-2 ${errors.bankName ? 'border-red-500' : ''}`}
                        value={bankName}
                        onChange={e=>{ setBankName(e.target.value); if (errors.bankName) setErrors(prev=>({ ...prev, bankName: undefined })); }}
                        aria-invalid={!!errors.bankName}
                      >
                        <option value="" disabled>Select Bank</option>
                        <option value="DBS">DBS</option>
                        <option value="POSB">POSB</option>
                        <option value="OCBC">OCBC</option>
                        <option value="UOB">UOB</option>
                        <option value="Standard Chartered">Standard Chartered</option>
                        <option value="Citibank">Citibank</option>
                        <option value="Maybank">Maybank</option>
                        <option value="HSBC">HSBC</option>
                        <option value="CIMB">CIMB</option>
                        <option value="Bank of China">Bank of China</option>
                        <option value="ICBC">ICBC</option>
                        <option value="RHB">RHB</option>
                        <option value="State Bank of India">State Bank of India</option>
                      </select>
                      {errors.bankName && <div className="text-red-600 text-xs mt-1">{errors.bankName}</div>}
                    </div>
                    <div>
                      <label className="block text-sm text-gray-600">Account number</label>
                      <input
                        className={`w-full border rounded p-2 ${errors.bankAccount ? 'border-red-500' : ''}`}
                        value={bankAccount}
                        inputMode="numeric"
                        maxLength={20}
                        onChange={e=>{
                          const digits = String(e.target.value || '').replace(/\D/g,'').slice(0,20);
                          setBankAccount(digits);
                          if (errors.bankAccount) setErrors(prev=>({ ...prev, bankAccount: undefined }));
                        }}
                        placeholder="Account number (digits only)"
                        aria-invalid={!!errors.bankAccount}
                      />
                      <div className="text-xs text-gray-500 mt-1">Up to 20 digits. Please remove any dashes.</div>
                      {errors.bankAccount && <div className="text-red-600 text-xs mt-1">{errors.bankAccount}</div>}
                    </div>
                  </div>
                )}
                <div className="flex justify-between">
                  <Button variant="ghost" className="bg-gray-100 text-gray-800 hover:bg-gray-200" onClick={back}>Back</Button>
                  <LoadingButton loading={loading} onClick={savePayout}>Continue</LoadingButton>
                </div>
              </div>

              {/* Step 3 */}
              <div className="w-full flex-shrink-0 p-6 space-y-4">
                {role === 'driver_partner' && (
                  <>
                    <div className="grid grid-cols-1 gap-2">
                      {errors._server && (
                        <div className="text-red-600 text-sm mb-2">{errors._server}</div>
                      )}
                      <div>
                        <label className="block text-sm text-gray-600">Car plate number</label>
                        <input className={`w-full border rounded p-2 ${errors.plate ? 'border-red-500' : ''}`} value={plate} onChange={e=>{ setPlate(e.target.value.toUpperCase()); if (errors.plate) setErrors(prev=>({ ...prev, plate: undefined })); }} placeholder="e.g. SGP1234A" />
                        {errors.plate && <div className="text-red-600 text-xs mt-1">{errors.plate}</div>}
                      </div>
                      <div>
                        <label className="block text-sm text-gray-600">Make</label>
                        <select className={`w-full border rounded p-2 ${errors.make ? 'border-red-500' : ''}`} value={make} onChange={e=>{ const val=e.target.value; setMake(val); setErrors(prev=>({ ...prev, make: undefined, customMake: undefined, model: undefined, customModel: undefined })); if (val!=='Other') { setModel(''); setCustomMake(''); } }}>
                          <option value="" disabled>Select Make</option>
                          {Object.keys(makesToModels).sort().map(m => <option key={m} value={m}>{m}</option>)}
                          <option value="Other">Other</option>
                        </select>
                        {errors.make && <div className="text-red-600 text-xs mt-1">{errors.make}</div>}
                        {make==='Other' && (
                          <input className={`w-full border rounded p-2 mt-2 ${errors.customMake ? 'border-red-500' : ''}`} placeholder="Enter make" value={customMake} onChange={(e)=>{ setCustomMake(e.target.value); if (errors.customMake) setErrors(prev=>({ ...prev, customMake: undefined })); }} />
                        )}
                        {errors.customMake && <div className="text-red-600 text-xs mt-1">{errors.customMake}</div>}
                      </div>
                      <div>
                        <label className="block text-sm text-gray-600">Model</label>
                        {make==='Other' ? (
                          <>
                            <input className={`w-full border rounded p-2 ${errors.customModel ? 'border-red-500' : ''}`} placeholder="Enter model" value={customModel} onChange={(e)=>{ setCustomModel(e.target.value); if (errors.customModel) setErrors(prev=>({ ...prev, customModel: undefined })); }} />
                            {errors.customModel && <div className="text-red-600 text-xs mt-1">{errors.customModel}</div>}
                          </>
                        ) : (
                          <>
                            <select className={`w-full border rounded p-2 ${errors.model ? 'border-red-500' : ''}`} value={model} onChange={e=>{ setModel(e.target.value); if (errors.model) setErrors(prev=>({ ...prev, model: undefined })); }}>
                              <option value="" disabled>Select Model</option>
                              {models.slice().sort().map(mo => <option key={mo} value={mo}>{mo}</option>)}
                              <option value="Other">Other</option>
                            </select>
                            {errors.model && <div className="text-red-600 text-xs mt-1">{errors.model}</div>}
                            {model==='Other' && (
                              <input className={`w-full border rounded p-2 mt-2 ${errors.customModel ? 'border-red-500' : ''}`} placeholder="Enter model" value={customModel} onChange={(e)=>{ setCustomModel(e.target.value); if (errors.customModel) setErrors(prev=>({ ...prev, customModel: undefined })); }} />
                            )}
                            {errors.customModel && <div className="text-red-600 text-xs mt-1">{errors.customModel}</div>}
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex justify-between">
                      <Button variant="ghost" className="bg-gray-100 text-gray-800 hover:bg-gray-200" onClick={back}>Back</Button>
                      <LoadingButton loading={loading} onClick={createCar}>Finish</LoadingButton>
                    </div>
                  </>
                )}

                {role === 'fleet_owner' && (
                  <>
                    <div className="rounded border p-3">
                      <div className="mt-2">
                        <label className="block text-sm text-gray-600 mb-1 font-bold">Upload CSV file</label>
                        <input type="file" accept=".csv,text/csv" onChange={handleCsvFileChange} className="block w-full text-sm text-gray-700 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-sm file:font-medium file:bg-gray-100 file:text-gray-700 hover:file:bg-gray-200" />
                        <div className="text-xs text-gray-500 mt-1">Choose a .csv file with headers: plate_number, make, model</div>
                      </div>
                      <div className="mt-3">
                        {!carsSaved && (
                          <>
                            <div className="text-sm font-medium text-gray-800 mb-2">Edit cars</div>
                            <div ref={gridRef} className="relative border rounded max-h-64 overflow-auto">
                          <table className="min-w-full text-sm">
                            <thead className="bg-gray-50">
                              <tr>
                                <th className="text-left px-3 py-2 border-b">Plate number</th>
                                <th className="text-left px-3 py-2 border-b">Make</th>
                                <th className="text-left px-3 py-2 border-b">Model</th>
                                <th className="text-left px-3 py-2 border-b w-20">Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {carsRows.map((r, idx) => (
                                <tr key={idx} className="odd:bg-white even:bg-gray-50">
                                  <td className="px-3 py-1.5 border-b align-top">
                                    <input
                                      className={`w-full border rounded p-1 ${rowErrors[idx] ? 'border-red-500' : ''}`}
                                      value={r.plate_number}
                                      onChange={e=>{
                                        const v = e.target.value.toUpperCase();
                                        setCarsRows(rows=>rows.map((row,i)=> i===idx? { ...row, plate_number: v } : row));
                                      }}
                                      placeholder="SGP1234A"
                                    />
                                    {rowErrors[idx] && <div className="text-[11px] text-red-600 mt-1">{rowErrors[idx]}</div>}
                                  </td>
                                  <td className="px-3 py-1.5 border-b">
                                    <input
                                      className="w-full border rounded p-1"
                                      value={r.make}
                                      onChange={e=>{
                                        const v = e.target.value;
                                        setCarsRows(rows=>rows.map((row,i)=> i===idx? { ...row, make: v } : row));
                                      }}
                                      placeholder="Toyota"
                                    />
                                  </td>
                                  <td className="px-3 py-1.5 border-b">
                                    <input
                                      className="w-full border rounded p-1"
                                      value={r.model}
                                      onChange={e=>{
                                        const v = e.target.value;
                                        setCarsRows(rows=>rows.map((row,i)=> i===idx? { ...row, model: v } : row));
                                      }}
                                      placeholder="Corolla"
                                    />
                                  </td>
                                  <td className="px-3 py-1.5 border-b">
                                    <button type="button" className="text-xs text-red-600 underline" onClick={()=> setCarsRows(rows => rows.filter((_,i)=> i!==idx))}>Remove</button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          {gridShowUpHint && (
                            <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-white">
                              <div className="flex justify-center items-end h-full">
                                <ChevronsUp className="w-5 h-5 text-gray-400 mb-1" />
                              </div>
                            </div>
                          )}
                          {gridShowDownHint && (
                            <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-white">
                              <div className="flex justify-center items-end h-full">
                                <ChevronsDown className="w-5 h-5 text-gray-400 mb-1" />
                              </div>
                            </div>
                          )}
                            </div>
                            <div className="flex items-center gap-2 mt-2">
                              <Button type="button" variant="outline" onClick={()=> setCarsRows(rows=> [...rows, { plate_number: '', make: '', model: '' }])}>Add row</Button>
                              <Button type="button" variant="ghost" className="bg-gray-100 text-gray-800 hover:bg-gray-200" onClick={()=> setCarsRows([{ plate_number: '', make: '', model: '' }])}>Clear</Button>
                              <span className="ml-auto" />
                              <a className="text-blue-600 underline text-sm inline-block" href={`data:text/csv,plate_number,make,model%0ASGP1234A,Toyota,Corolla%0ASLK1234B,Honda,Civic`} download="cars-template.csv">Download CSV template</a>
                            </div>
                          </>
                        )}
                        {carsSaved && (
                          <div className="mt-2">
                            <div className="text-sm font-medium text-gray-800 mb-2">Review cars</div>
                            <ul className="list-disc pl-5 space-y-1 text-sm text-gray-800">
                              {savedCars.map((c, i) => (
                                <li key={i}><span className="font-medium">{c.plate_number}</span> — {c.make} {c.model}</li>
                              ))}
                            </ul>
                            <div className="flex justify-end mt-2">
                              <Button variant="outline" onClick={()=> setCarsSaved(false)}>Edit</Button>
                            </div>
                          </div>
                        )}
                      </div>
                      {!carsSaved ? (
                        <div className="flex justify-end mt-2">
                          <LoadingButton loading={loading} onClick={validateAndStageCars}>Save</LoadingButton>
                        </div>
                      ) : (
                        <div className="flex justify-end mt-2">
                          <LoadingButton loading={loading} onClick={finalizeFleetCars}>Finish</LoadingButton>
                        </div>
                      )}
                    </div>

                    <div className="flex justify-between">
                      <Button variant="ghost" className="bg-gray-100 text-gray-800 hover:bg-gray-200" onClick={back}>Back</Button>
                      <Button onClick={()=>navigate('/PendingApproval')}>Finish</Button>
                    </div>
                  </>
                )}

                {role === 'agent' && (
                  <div className="space-y-4">
                    <div className="text-gray-700">You’re all set. You can start using your dashboard.</div>
                    <div className="flex justify-between">
                      <Button variant="ghost" className="bg-gray-100 text-gray-800 hover:bg-gray-200" onClick={back}>Back</Button>
                      <Button onClick={()=>navigate('/PendingApproval')}>Finish</Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}


