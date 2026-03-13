import { useEffect, useMemo, useState, Fragment, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { apiClient } from '@/api/client';
import { useAuthStore } from '@/stores/authStore';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import Loader2 from 'lucide-react/icons/loader-2';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import makeModelsRaw from '@/data/mktr_make_models.json';
import { sendOtp, verifyOtp } from '@/components/lib/customFunctions';
import {
  isValidSgPlate as isValidAllowedPlateFormat,
  parseSgPlate as formatPlateInputToStrict,
  isValidSgMobile,
} from '@/utils/validation';

import {
  sanitizePhoneInput,
  isValidNricFin,
  formatDateInput,
  calculateAge,
  parseCsvToRows,
  collectGridCars,
  findDuplicatePlates,
} from '@/components/onboarding/helpers';
import StepProfile from '@/components/onboarding/StepProfile';
import StepPayout from '@/components/onboarding/StepPayout';
import StepFinal from '@/components/onboarding/StepFinal';

const makesToModels = Object.keys(makeModelsRaw || {}).reduce((acc, make) => {
  const list = Array.isArray(makeModelsRaw[make]) ? makeModelsRaw[make].filter(Boolean) : [];
  acc[make] = list;
  return acc;
}, {});

export default function Onboarding() {
  const navigate = useNavigate();
  const refreshUser = useAuthStore((s) => s.refreshUser);
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

  // ── Effects ──────────────────────────────────────────────

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
    refreshUser().then(setUser).catch(() => setUser(null));
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
    const counts = normalizedPlates.reduce((acc, p) => { if (p) acc[p] = (acc[p] || 0) + 1; return acc; }, {});
    const nextErrors = carsRows.map((r, idx) => {
      const plateVal = normalizedPlates[idx];
      if (!plateVal) return '';
      if (!isValidAllowedPlateFormat(plateVal)) {
        return 'Format: Prefix (EA\u2013EZ or SB\u2013SN) + 1\u20134 digits + letter';
      }
      if (counts[plateVal] > 1) return 'Duplicate plate in list';
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

  // ── Loading gate ─────────────────────────────────────────

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black text-white">
        <Loader2 className="h-6 w-6 animate-spin mr-2" /> Loading...
      </div>
    );
  }

  // ── Navigation helpers ───────────────────────────────────

  const next = () => setStep((s) => s + 1);
  const back = () => setStep((s) => Math.max(0, s - 1));
  const goToStep = (target) => {
    if (typeof target !== 'number') return;
    if (target <= maxVisitedStep) setStep(target);
  };

  // ── Role change ──────────────────────────────────────────

  function resetForRoleChange(newRole) {
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

  // ── OTP handlers ─────────────────────────────────────────

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

  // ── DOB handler ──────────────────────────────────────────

  function handleDobChange(value) {
    const formatted = formatDateInput(value);
    setDob(formatted);
    const digitsOnly = formatted.replace(/\D/g, '');
    if (digitsOnly.length > 0 && digitsOnly.length !== 8) setDobIncomplete(true); else setDobIncomplete(false);
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

  // ── Step 1: save profile ─────────────────────────────────

  async function saveBasic() {
    setLoading(true);
    try {
      const newErrors = {};
      if (!firstName.trim()) newErrors.firstName = 'First name is required';
      if (!lastName.trim()) newErrors.lastName = 'Last name is required';
      if (!phone.trim()) newErrors.phone = 'Phone number is required';
      if (phone && !isValidSgMobile(phone)) newErrors.phone = 'Enter a valid SG number starting with 3, 6, 8, or 9';
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
      let dobIso;
      if (dob && dob.length === 10 && (role === 'agent' || role === 'driver_partner')) {
        const [d, m, y] = dob.split('/');
        const parsed = new Date(Number(y), Number(m) - 1, Number(d));
        if (!isNaN(parsed.getTime())) dobIso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      }
      const profilePayload = { firstName, lastName, phone };
      if ((role === 'agent' || role === 'driver_partner') && dobIso) profilePayload.dateOfBirth = dobIso;
      if ((role === 'agent' || role === 'fleet_owner') && companyName) profilePayload.companyName = companyName;

      const profileResp = await apiClient.put('/auth/profile', profilePayload);
      const roleResp = await apiClient.post('/auth/onboarding/role', { role });
      try {
        const refreshed = await refreshUser();
        if (refreshed) { /* no-op, just ensuring local cache is updated */ }
      } catch (_) { /* non-critical refresh */ }
      next();
    } catch (e) {
      setErrors((prev) => ({ ...prev, _server: e?.message || 'Validation failed' }));
    } finally {
      setLoading(false);
    }
  }

  // ── Step 2: save payout ──────────────────────────────────

  async function savePayout() {
    setLoading(true);
    try {
      const newErrors = {};
      if (payoutMethod === 'PayNow') {
        if (paynowType === 'mobile') {
          let digits = String(paynowId || '').replace(/\D/g, '');
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
          let digits = String(paynowId || '').replace(/\D/g, '');
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

  // ── Step 3: driver car ───────────────────────────────────

  async function createCar() {
    setLoading(true);
    try {
      const finalMake = make === 'Other' ? (customMake || '').trim() : make;
      const finalModel = (make === 'Other' || model === 'Other') ? (customModel || '').trim() : model;
      const plateClean = String(plate || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

      const newErrors = {};
      if (!plateClean) newErrors.plate = 'Car plate is required';
      else if (!isValidAllowedPlateFormat(plateClean)) newErrors.plate = 'Enter valid car plate (EA\u2013EZ or SB\u2013SN + 1\u20134 digits + letter)';
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
      navigate('/PendingApproval');
    } catch (e) {
      setErrors((prev) => ({ ...prev, _server: e?.message || 'Failed to create car' }));
    } finally {
      setLoading(false);
    }
  }

  // ── Step 3: fleet bulk ───────────────────────────────────

  function loadRowsFromCsvString(text) {
    const rows = parseCsvToRows(text);
    if (rows.length > 0) setCarsRows(rows);
  }

  async function validateAndStageCars() {
    const cars = collectGridCars(carsRows);
    if (cars.length === 0) {
      alert('No valid rows. Please add at least one complete row.');
      return;
    }
    const dups = findDuplicatePlates(cars);
    if (dups.length > 0) {
      alert(`Duplicate car plates found: ${dups.join(', ')}`);
      return;
    }
    const invalid = cars.filter(c => !isValidAllowedPlateFormat(c.plate_number));
    if (invalid.length > 0) {
      alert(`Invalid car plates (format failed): ${invalid.map(i => i.plate_number).join(', ')}`);
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

  // ── Derived values ───────────────────────────────────────

  const stepTitle = (() => {
    if (step === 0) return 'Tell us about yourself';
    if (step === 1) return 'How should we pay your commissions?';
    if (step === 2) {
      if (role === 'driver_partner') return 'Tell us about your car!';
      if (role === 'fleet_owner') return 'Add your fleet details';
      if (role === 'agent') return 'You\u2019re all set \u2014 ready to start?';
    }
    return 'Welcome! Let\u2019s set up your account';
  })();

  const steps = [
    { key: 0, label: 'Profile' },
    { key: 1, label: 'Payout' },
    { key: 2, label: role === 'driver_partner' ? 'Vehicle' : role === 'fleet_owner' ? 'Fleet' : 'Done' }
  ];

  const roleLabel = role === 'driver_partner' ? 'Driver' : (role === 'fleet_owner' ? 'Fleet Owner' : 'Agent');

  // ── Render ───────────────────────────────────────────────

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
              <StepProfile
                role={role}
                changeRole={changeRole}
                firstName={firstName}
                setFirstName={setFirstName}
                lastName={lastName}
                setLastName={setLastName}
                phone={phone}
                setPhone={setPhone}
                dob={dob}
                handleDobChange={handleDobChange}
                dobIncomplete={dobIncomplete}
                setDobIncomplete={setDobIncomplete}
                ageError={ageError}
                companyName={companyName}
                setCompanyName={setCompanyName}
                otp={otp}
                setOtp={setOtp}
                otpState={otpState}
                loadingPhase={loadingPhase}
                resendCooldown={resendCooldown}
                showSuccessTick={showSuccessTick}
                handleSendOtp={handleSendOtp}
                handleVerifyOtp={handleVerifyOtp}
                handleCancelOtp={handleCancelOtp}
                sanitizePhoneInput={sanitizePhoneInput}
                errors={errors}
                setErrors={setErrors}
                loading={loading}
                saveBasic={saveBasic}
                user={user}
              />

              {/* Step 2 */}
              <StepPayout
                payoutMethod={payoutMethod}
                setPayoutMethod={setPayoutMethod}
                paynowType={paynowType}
                setPaynowType={setPaynowType}
                paynowId={paynowId}
                setPaynowId={setPaynowId}
                bankName={bankName}
                setBankName={setBankName}
                bankAccount={bankAccount}
                setBankAccount={setBankAccount}
                phone={phone}
                errors={errors}
                setErrors={setErrors}
                loading={loading}
                savePayout={savePayout}
                back={back}
              />

              {/* Step 3 */}
              <StepFinal
                role={role}
                plate={plate}
                setPlate={setPlate}
                make={make}
                setMake={setMake}
                model={model}
                setModel={setModel}
                models={models}
                customMake={customMake}
                setCustomMake={setCustomMake}
                customModel={customModel}
                setCustomModel={setCustomModel}
                carsRows={carsRows}
                setCarsRows={setCarsRows}
                carsSaved={carsSaved}
                setCarsSaved={setCarsSaved}
                savedCars={savedCars}
                rowErrors={rowErrors}
                gridRef={gridRef}
                gridShowDownHint={gridShowDownHint}
                gridShowUpHint={gridShowUpHint}
                errors={errors}
                setErrors={setErrors}
                loading={loading}
                createCar={createCar}
                validateAndStageCars={validateAndStageCars}
                finalizeFleetCars={finalizeFleetCars}
                handleCsvFileChange={handleCsvFileChange}
                back={back}
                navigate={navigate}
                makesToModels={makesToModels}
              />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
