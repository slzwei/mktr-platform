import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { auth, entities, apiClient } from "@/api/client";
import makeModelsRaw from "@/data/mktr_make_models.json";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DollarSign, BarChart3, AlertTriangle } from "lucide-react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import CommissionSummary from "@/components/dashboard/CommissionSummary";
import { format } from "date-fns";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Phone, Mail, ShieldCheck, Loader2, AlertCircle, X, CheckCircle2 } from "lucide-react";
import { sendOtp, verifyOtp } from "@/components/lib/customFunctions";
import { motion } from "framer-motion";
import { toast } from "@/components/ui/use-toast";

const BANK_OPTIONS = [
  'DBS',
  'POSB',
  'OCBC',
  'UOB',
  'Standard Chartered',
  'Citibank',
  'Maybank',
  'HSBC',
  'CIMB',
  'Bank of China',
  'ICBC',
  'RHB',
  'State Bank of India'
];

export default function DriverDashboard() {
  const location = useLocation();
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState("30d");
  const [commissions, setCommissions] = useState([]);
  const [scanTrend, setScanTrend] = useState([]);
  const [earnTrend, setEarnTrend] = useState([]);
  const [lifetimeEarnings, setLifetimeEarnings] = useState(0);
  const [lifetimeScans, setLifetimeScans] = useState(0);
  // Profile form state
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [phone, setPhone] = useState(''); // store 8-digit local
  const [payoutMethod, setPayoutMethod] = useState('');
  const [paynowType, setPaynowType] = useState('Number'); // 'UEN' | 'Number' | 'NRIC'
  const [paynowValue, setPaynowValue] = useState('');
  const [bankName, setBankName] = useState('');
  const [bankAccount, setBankAccount] = useState('');
  const [otp, setOtp] = useState('');
  const [otpState, setOtpState] = useState('idle'); // 'idle' | 'pending' | 'verified'
  const [loadingKind, setLoadingKind] = useState(null); // 'sending' | 'verifying' | 'updating'
  const [errorMsg, setErrorMsg] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);
  const [nricError, setNricError] = useState('');
  const [paynowError, setPaynowError] = useState('');
  const [showSuccessTick, setShowSuccessTick] = useState(false);

  // Car details state
  const [carId, setCarId] = useState(null);
  const [carPlate, setCarPlate] = useState('');
  const [carMake, setCarMake] = useState('');
  const [carModel, setCarModel] = useState('');
  const [carCustomMake, setCarCustomMake] = useState('');
  const [carCustomModel, setCarCustomModel] = useState('');
  const [carErrors, setCarErrors] = useState({});
  const [carSaving, setCarSaving] = useState(false);

  const makesToModels = useMemo(() => {
    return Object.keys(makeModelsRaw || {}).reduce((acc, make) => {
      const list = Array.isArray(makeModelsRaw[make]) ? makeModelsRaw[make].filter(Boolean) : [];
      acc[make] = list;
      return acc;
    }, {});
  }, []);
  const availableModels = useMemo(() => makesToModels[carMake] || [], [carMake, makesToModels]);

  // Derive sidebar-controlled section from query param
  const query = new URLSearchParams(location.search);
  const section = query.get('tab') || 'dashboard';

  useEffect(() => {
    loadBase();
  }, []);

  useEffect(() => {
    if (user) {
      loadData(period);
      loadLifetime();
      // Initialize profile form
      setEmail(user.email || '');
      const raw = (user.phone || '').replace(/\D/g, '');
      const local8 = raw.startsWith('65') ? raw.slice(2, 10) : raw.slice(0, 8);
      setPhone(local8);
      const pm = user?.payout?.method || '';
      setPayoutMethod(pm);
      if (pm === 'PayNow') {
        const existing = user?.payout?.paynowId || '';
        const detected = detectPaynowType(existing);
        setPaynowType(detected);
        if (detected === 'Number') {
          const local8 = String(existing || '').replace(/^\+65/, '').replace(/\D/g, '').slice(0, 8);
          setPaynowValue(local8);
        } else {
          setPaynowValue(String(existing || '').toUpperCase());
        }
      } else if (pm === 'Bank Transfer') {
        setBankName(user?.payout?.bankName || '');
        setBankAccount(user?.payout?.bankAccount || '');
      }
      // Load driver's assigned car details
      loadAssignedCar();
    }
  }, [user, period]);

  useEffect(() => {
    let timer;
    if (resendCooldown > 0) {
      timer = setTimeout(() => setResendCooldown((v) => v - 1), 1000);
    }
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  const loadBase = async () => {
    try {
      const me = await auth.getCurrentUser();
      setUser(me);
    } catch (e) {
      console.error("Failed to load user", e);
    } finally {
      setLoading(false);
    }
  };

  const loadData = async (p) => {
    try {
      try {
        const resp = await apiClient.get(`/dashboard/driver/commissions`, { period: p });
        setCommissions(resp?.data?.commissions || []);
      } catch (e) {
        setCommissions([]);
      }

      let scans = [];
      try {
        const resp = await apiClient.get(`/dashboard/driver/scans`, { period: p });
        scans = resp?.data?.trend || [];
      } catch (_) {
        const qrData = await entities.QrTag.list({});
        const qrList = Array.isArray(qrData) ? qrData : (qrData.qrTags || []);
        const mine = (qrList || []).filter((q) => String(q.ownerUserId) === String(user.id));
        const map = new Map();
        const now = new Date();
        if (p === "1d") {
          for (let h = 0; h < 24; h++) map.set(h, 0);
          for (const q of mine) {
            const daily = q?.analytics?.hourlyScans || {};
            const keyDate = format(now, "yyyy-MM-dd");
            const byHour = daily?.[keyDate] || {};
            for (const [hStr, cnt] of Object.entries(byHour)) {
              const h = parseInt(hStr, 10);
              map.set(h, (map.get(h) || 0) + (cnt || 0));
            }
          }
          scans = Array.from(map.entries()).map(([hour, count]) => ({ label: `${hour}:00`, count }));
        } else {
          const days = p === "7d" ? 7 : 30;
          for (let i = days - 1; i >= 0; i--) {
            const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
            const key = format(d, "yyyy-MM-dd");
            map.set(key, 0);
          }
          for (const q of mine) {
            const daily = q?.analytics?.dailyScans || {};
            for (const [day, cnt] of Object.entries(daily)) {
              if (map.has(day)) map.set(day, (map.get(day) || 0) + (cnt || 0));
            }
          }
          scans = Array.from(map.entries()).map(([day, count]) => ({ label: `${day.slice(8)}-${day.slice(5, 7)}`, count }));
        }
      }
      setScanTrend(scans);
      try {
        const commResp = await apiClient.get(`/dashboard/driver/commissions`, { period: p });
        const comms = commResp?.data?.commissions || [];
        const map = new Map();
        if (p === '1d') {
          for (let h = 0; h < 24; h++) map.set(`${h}:00`, 0);
          for (const c of comms) {
            const dt = new Date(c.created_date);
            const hour = dt.getHours();
            const key = `${hour}:00`;
            if (map.has(key)) map.set(key, (map.get(key) || 0) + (Number(c.amount_driver) || 0));
          }
          setEarnTrend(Array.from(map.entries()).map(([label, amount]) => ({ label, amount })));
        } else {
          const now = new Date();
          const days = p === '7d' ? 7 : 30;
          for (let i = days - 1; i >= 0; i--) {
            const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
            const key = d.toISOString().split('T')[0];
            map.set(key, 0);
          }
          for (const c of comms) {
            const key = new Date(c.created_date).toISOString().split('T')[0];
            if (map.has(key)) map.set(key, (map.get(key) || 0) + (Number(c.amount_driver) || 0));
          }
          setEarnTrend(Array.from(map.entries()).map(([day, amount]) => ({ label: `${day.slice(8)}-${day.slice(5, 7)}`, amount })));
        }
      } catch (_) {
        setEarnTrend([]);
      }
    } catch (e) {
      console.error("Failed to load driver data", e);
    }
  };

  const loadLifetime = async () => {
    try {
      const [commResp, scansResp] = await Promise.all([
        apiClient.get(`/dashboard/driver/commissions`, { period: 'all' }),
        apiClient.get(`/dashboard/driver/scans`, { period: 'all' })
      ]);
      const lifetimeCommissions = commResp?.data?.commissions || [];
      const totalEarned = lifetimeCommissions.reduce((sum, c) => sum + (Number(c.amount_driver) || 0), 0);
      setLifetimeEarnings(totalEarned);
      setLifetimeScans(scansResp?.data?.total || 0);
    } catch (e) { }
  };

  const loadAssignedCar = async () => {
    try {
      const resp = await apiClient.get(`/fleet/cars`, { limit: 200 });
      const cars = resp?.data?.cars || [];
      const mine = cars.find((c) => String(c.current_driver_id || c.currentDriver?.id) === String(user.id));
      if (mine) {
        setCarId(mine.id);
        setCarPlate(String(mine.plate_number || ''));
        const makeValue = String(mine.make || '');
        const modelValue = String(mine.model || '');
        if (makeValue && makesToModels[makeValue]) {
          setCarMake(makeValue);
          setCarModel(modelValue);
          setCarCustomMake('');
          setCarCustomModel('');
        } else if (makeValue) {
          setCarMake('Other');
          setCarModel('Other');
          setCarCustomMake(makeValue);
          setCarCustomModel(modelValue);
        } else {
          setCarMake('');
          setCarModel('');
          setCarCustomMake('');
          setCarCustomModel('');
        }
      } else {
        setCarId(null);
        setCarPlate('');
        setCarMake('');
        setCarModel('');
        setCarCustomMake('');
        setCarCustomModel('');
      }
    } catch (_) { }
  };

  // Plate validation — align with onboarding rules (EA–EZ or SB–SN + 1–4 digits + letter)
  const LETTERS_NO_IO = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K', 'L', 'M', 'N', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'];
  const SERIES_SECOND_LETTERS = ['B', 'C', 'D', 'F', 'G', 'J', 'K', 'L', 'M', 'N'];
  const ALLOWED_PREFIXES = useMemo(() => new Set([
    ...LETTERS_NO_IO.map((l) => `E${l}`),
    ...SERIES_SECOND_LETTERS.flatMap((sec) => LETTERS_NO_IO.map((third) => `S${sec}${third}`))
  ]), []);
  const formatPlateInputToStrict = (plate) => String(plate || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const isValidAllowedPlateFormat = (raw) => {
    const v = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!v) return false;
    let prefix = '';
    if (v.startsWith('S')) prefix = v.slice(0, 3); else if (v.startsWith('E')) prefix = v.slice(0, 2); else return false;
    if (!ALLOWED_PREFIXES.has(prefix)) return false;
    const rest = v.slice(prefix.length);
    const match = rest.match(/^(\d{1,4})([A-Z])$/);
    return !!match;
  };

  const saveCarDetails = async () => {
    if (!carId) return;
    const cleanPlate = formatPlateInputToStrict(carPlate);
    const newErrors = {};
    if (!cleanPlate) newErrors.plate = 'Car plate is required';
    else if (!isValidAllowedPlateFormat(cleanPlate)) newErrors.plate = 'Enter valid car plate (EA–EZ or SB–SN + 1–4 digits + letter)';
    if (!carMake) newErrors.make = 'Please select the car make';
    const finalMake = carMake === 'Other' ? (carCustomMake || '').trim() : carMake;
    const finalModel = (carMake === 'Other' || carModel === 'Other') ? (carCustomModel || '').trim() : carModel;
    if (carMake === 'Other' && !finalMake) newErrors.customMake = 'Please enter the car make';
    if (carMake !== 'Other' && !carModel) newErrors.model = 'Please select the car model';
    if ((carMake === 'Other' || carModel === 'Other') && !finalModel) newErrors.customModel = 'Please enter the car model';
    if (Object.keys(newErrors).length > 0) {
      setCarErrors(newErrors);
      return;
    }

    try {
      setCarSaving(true);
      await apiClient.put(`/fleet/cars/${carId}`, {
        plate_number: cleanPlate,
        make: finalMake,
        model: finalModel
      });
      toast({ title: 'Car updated', description: 'Your vehicle details were saved successfully.' });
      setCarErrors({});
      await loadAssignedCar();
    } catch (e) {
      toast({ title: 'Update failed', description: e?.message || 'Unable to save car details', variant: 'destructive' });
    } finally {
      setCarSaving(false);
    }
  };

  // Helper: display formatting for phone (XXXX XXXX)
  const displayPhone = (value) => {
    const digits = (value || '').replace(/\D/g, '');
    if (digits.length <= 4) return digits;
    return `${digits.slice(0, 4)} ${digits.slice(4, 8)}`;
  };

  const handlePhoneChange = (value) => {
    let digits = (value || '').replace(/\D/g, '');
    if (digits.startsWith('65') && digits.length > 8) digits = digits.slice(2);
    setPhone(digits.slice(0, 8));
  };

  const getFullPhone = () => `+65${phone}`;

  const handleSendOtp = async () => {
    if (phone.length !== 8) {
      setErrorMsg('Please enter a valid 8-digit Singapore phone number.');
      return;
    }
    const first = phone[0];
    if (!['3', '6', '8', '9'].includes(first)) {
      setErrorMsg('Invalid number. Must start with 3, 6, 8, or 9.');
      return;
    }
    setLoadingKind('sending');
    setErrorMsg('');
    try {
      const resp = await sendOtp(getFullPhone());
      const result = resp.data || resp;
      if (result.success) {
        setOtpState('pending');
        setResendCooldown(30);
      } else {
        setErrorMsg(result.message || 'Failed to send verification code.');
      }
    } catch (e) {
      setErrorMsg(e?.message || 'Unable to send verification code.');
    }
    setLoadingKind(null);
  };

  const handleVerifyOtp = async () => {
    if (otp.length < 6) {
      setErrorMsg('Please enter the 6-digit OTP.');
      return;
    }
    setLoadingKind('verifying');
    setErrorMsg('');
    try {
      const resp = await verifyOtp(getFullPhone(), otp);
      const result = resp.data || resp;
      if (result.success) {
        setShowSuccessTick(true);
        setTimeout(() => {
          setOtpState('verified');
          setShowSuccessTick(false);
        }, 800);
      } else {
        setErrorMsg(result.message || 'Verification failed.');
        setOtp('');
      }
    } catch (e) {
      setErrorMsg(e?.message || 'Verification failed.');
      setOtp('');
    }
    setLoadingKind(null);
  };

  const handleCancelOtp = () => {
    setOtpState('idle');
    setOtp('');
    setErrorMsg('');
    setResendCooldown(0);
  };

  const handleUpdateProfile = async () => {
    try {
      setLoadingKind('updating');
      setErrorMsg('');
      // Validate email
      if (!isValidEmail(email)) {
        setEmailError('Please enter a valid email address');
        setLoadingKind(null);
        return;
      }
      // Require phone verified if phone differs from user's original
      const originalRaw = (user?.phone || '').replace(/\D/g, '');
      const originalLocal = originalRaw.startsWith('65') ? originalRaw.slice(2, 10) : originalRaw.slice(0, 8);
      const phoneChanged = phone && phone !== originalLocal;
      if (phoneChanged && otpState !== 'verified') {
        setErrorMsg('Please verify your new phone number.');
        setLoadingKind(null);
        return;
      }

      // Save profile (email/phone)
      const updates = { email };
      if (phone) updates.phone = `65${phone}`; // store without '+' for backend
      await apiClient.put('/auth/profile', updates);

      // Save payout
      if (payoutMethod) {
        let payload;
        if (payoutMethod === 'PayNow') {
          let paynowId = paynowValue;
          if (paynowType === 'Number') {
            const digits = (paynowValue || '').replace(/\D/g, '').slice(0, 8);
            if (!digits || digits.length !== 8) {
              setPaynowError('Please enter an 8-digit PayNow number');
              setLoadingKind(null);
              return;
            }
            paynowId = `+65${digits}`;
          } else if (paynowType === 'UEN') {
            if (!isValidUEN(paynowValue)) {
              setErrorMsg('Invalid UEN format. Example: 201912345Z or T18LL0001K');
              setLoadingKind(null);
              return;
            }
          } else if (paynowType === 'NRIC') {
            if (!isValidNRIC(paynowValue)) {
              setErrorMsg('Invalid NRIC/FIN format. Example: S1234567D');
              setLoadingKind(null);
              return;
            }
          }
          payload = { method: 'PayNow', paynowId, bankName: null, bankAccount: null };
        } else if (payoutMethod === 'Bank Transfer') {
          payload = { method: 'Bank Transfer', bankName, bankAccount, paynowId: null };
        }
        await apiClient.post('/auth/onboarding/payout', payload);
      }

      // Refresh local user cache
      const refreshed = await auth.getCurrentUser(true);
      setUser(refreshed);
      toast({ title: 'Profile updated', description: 'Your details and payout method were saved successfully.' });
    } catch (e) {
      setErrorMsg(e?.message || 'Failed to update profile.');
    }
    setLoadingKind(null);
  };

  const isValidEmail = (value) => {
    const v = String(value || '').trim();
    // Simple but effective email pattern for UI validation
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(v);
  };

  // Detect PayNow id type from stored value
  const detectPaynowType = (value) => {
    const v = String(value || '').trim().toUpperCase();
    if (/^\+65\d{8}$/.test(v)) return 'Number';
    if (isValidNRIC(v)) return 'NRIC';
    if (isValidUEN(v)) return 'UEN';
    return 'Number';
  };

  // Validation helpers for UEN and NRIC formats
  const isValidUEN = (value) => {
    const v = String(value || '').trim().toUpperCase();
    // Enforce ending with a letter and max length 10
    if (!/^[A-Z0-9]{8,9}[A-Z]$/.test(v)) return false;
    // Accept common UEN patterns
    const patterns = [
      /^[0-9]{8}[A-Z]$/,                      // 8-digit + letter
      /^[0-9]{9}[A-Z]$/,                      // 4-digit year + 5 digits + letter (ACRA local companies)
      /^[ST][0-9]{2}[A-Z]{2}[0-9]{4}[A-Z]$/,  // S/T + YY + entity + 4 digits + letter (e.g., T18LL0001K)
      /^R[0-9]{2}[A-Z]{2}[0-9]{4}[A-Z]$/      // R + YY + type + 4 digits + letter
    ];
    return patterns.some((re) => re.test(v));
  };

  const isValidNRIC = (value) => {
    const v = String(value || '').trim().toUpperCase();
    if (!/^[STFGM][0-9]{7}[A-Z]$/.test(v)) return false;
    const prefix = v[0];
    const digits = v.slice(1, 8).split('').map((c) => parseInt(c, 10));
    const suffix = v[8];
    const weights = [2, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let i = 0; i < 7; i++) sum += digits[i] * weights[i];
    if (prefix === 'T' || prefix === 'G') sum += 4; // Adjustment for T/G
    const remainder = sum % 11;
    const mapST = ['J', 'Z', 'I', 'H', 'G', 'F', 'E', 'D', 'C', 'B', 'A'];
    const mapFG = ['X', 'W', 'U', 'T', 'R', 'Q', 'P', 'N', 'M', 'L', 'K'];
    const mapping = (prefix === 'S' || prefix === 'T') ? mapST : mapFG; // Treat M like F/G
    return mapping[remainder] === suffix;
  };

  // Helpers for PayNow phone formatting
  const displayPaynowPhone = (value) => {
    const digits = (value || '').replace(/\D/g, '');
    const local = digits.startsWith('65') ? digits.slice(2, 10) : digits.slice(0, 8);
    if (local.length <= 4) return local;
    return `${local.slice(0, 4)} ${local.slice(4, 8)}`;
  };

  const handlePaynowPhoneChange = (value) => {
    let digits = (value || '').replace(/\D/g, '');
    if (digits.startsWith('65') && digits.length > 8) digits = digits.slice(2);
    const local8 = digits.slice(0, 8);
    setPaynowValue(local8);
    if (local8.length > 0 && local8.length !== 8) setPaynowError('Enter 8 digits'); else setPaynowError('');
  };

  const handleUENChange = (value) => {
    const cleaned = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
    setPaynowValue(cleaned);
    if (cleaned.length > 0 && !isValidUEN(cleaned)) setPaynowError('Invalid UEN format. Example: 201912345Z or T18LL0001K'); else setPaynowError('');
  };

  const handleNRICChange = (value) => {
    const cleaned = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 9);
    setPaynowValue(cleaned);
    if (cleaned.length > 0 && !isValidNRIC(cleaned)) setNricError('Invalid NRIC/FIN format. Example: S1234567D'); else setNricError('');
  };

  if (loading) {
    return (
      <div className="p-6 lg:p-8">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-gray-200 rounded w-64"></div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {Array(4).fill(0).map((_, i) => (
              <div key={i} className="h-32 bg-gray-200 rounded-xl"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!user || user.role !== 'driver_partner') {
    return (
      <div className="p-6 lg:p-8 flex items-center justify-center min-h-[calc(100vh-64px)]">
        <Card className="max-w-md w-full text-center p-8">
          <CardHeader>
            <AlertTriangle className="w-16 h-16 text-yellow-500 mx-auto mb-4" />
            <CardTitle>Access Denied</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-gray-600 mb-4">You do not have permission to view this dashboard.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 bg-gray-50 min-h-screen">
      <div className="max-w-7xl mx-auto">
        {(() => {
          // derive original verified phone for UI comparisons
          const originalRaw = (user?.phone || '').replace(/\D/g, '');
          var _originalLocal = originalRaw.startsWith('65') ? originalRaw.slice(2, 10) : originalRaw.slice(0, 8);
          // expose on window for debugging if needed
          return null;
        })()}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Welcome back, {user?.full_name || user?.fullName || 'Driver'}!</h1>
          <div className="flex items-center gap-4 text-gray-600">
            <Badge variant="outline" className="bg-indigo-50 text-indigo-700 border-indigo-200">Driver Partner</Badge>
            <span className="text-sm">{format(new Date(), 'EEEE, dd MMMM yyyy')}</span>
          </div>
        </div>

        {/* Only show dashboard when tab is not profile/history/payslip */}
        {section === 'profile' && (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Profile</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs font-medium">Email</Label>
                    <div className="relative">
                      <Mail className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400" />
                      <Input
                        type="email"
                        className={`pl-7 h-8 text-sm ${emailError ? 'border-red-500 focus:border-red-500 focus:ring-red-500' : ''}`}
                        value={email}
                        onChange={(e) => { const v = e.target.value; setEmail(v); setEmailError(v && !isValidEmail(v) ? 'Please enter a valid email address' : ''); }}
                        onBlur={(e) => { const v = e.target.value; setEmailError(v && !isValidEmail(v) ? 'Please enter a valid email address' : ''); }}
                        disabled
                      />
                      <div className="text-xs text-gray-500 mt-1">Email is linked to Google and cannot be changed.</div>
                    </div>
                    {emailError && (
                      <div className="text-xs text-red-600 mt-1">{emailError}</div>
                    )}
                  </div>
                  <div>
                    <Label className="text-xs font-medium">Contact Number</Label>
                    <div className="flex items-center gap-1">
                      <div className="relative flex-grow">
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-700 text-sm whitespace-nowrap">🇸🇬 +65</span>
                        <Input
                          type="tel"
                          placeholder="9123 4567"
                          className="pl-16 pr-24 h-8 text-sm"
                          value={displayPhone(phone)}
                          onChange={(e) => handlePhoneChange(e.target.value)}
                          disabled={otpState !== 'idle'}
                          maxLength={9}
                        />
                        {(() => {
                          const originalRaw = (user?.phone || '').replace(/\D/g, '');
                          const originalLocal = originalRaw.startsWith('65') ? originalRaw.slice(2, 10) : originalRaw.slice(0, 8);
                          const phoneChanged = (phone || '') !== (originalLocal || '');
                          const showVerified = (!phoneChanged && otpState === 'idle') || otpState === 'verified';
                          return showVerified ? (
                            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 text-green-700 bg-green-50 border border-green-200 rounded px-2 h-6 text-[11px]">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>Verified</span>
                            </div>
                          ) : null;
                        })()}
                      </div>
                      {(() => {
                        const originalRaw = (user?.phone || '').replace(/\D/g, '');
                        const originalLocal = originalRaw.startsWith('65') ? originalRaw.slice(2, 10) : originalRaw.slice(0, 8);
                        const phoneChanged = (phone || '') !== (originalLocal || '');
                        if (otpState === 'idle' && phoneChanged) {
                          return (
                            <motion.div initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ type: 'spring', stiffness: 400, damping: 30 }}>
                              <Button type="button" onClick={handleSendOtp} disabled={loadingKind === 'sending' || phone.length !== 8} className="w-28 h-8 bg-black hover:bg-gray-800 text-white font-medium text-sm">
                                {loadingKind === 'sending' ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Verify'}
                              </Button>
                            </motion.div>
                          );
                        }
                        return null;
                      })()}
                      {otpState === 'verified' && (
                        <div className="flex items-center justify-center gap-2 text-white font-medium text-sm w-28 h-8 bg-green-500 rounded-md">
                          <CheckCircle2 className="w-5 h-5" />
                          <span>OK</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {otpState === 'pending' && (
                  <div className="space-y-2 p-3 bg-gray-50 rounded-lg border">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm font-medium text-gray-800">Enter Code</Label>
                      <Button type="button" variant="ghost" size="sm" onClick={handleCancelOtp} className="text-gray-500 hover:text-gray-700 h-6 px-1">
                        <X className="w-3 h-3" />
                      </Button>
                    </div>
                    <p className="text-xs text-gray-500 !-mt-1">Sent to +65 {displayPhone(phone)}</p>
                    <div className="flex items-center gap-2">
                      <div className="relative flex-grow">
                        <ShieldCheck className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                        <Input id="otp" type="tel" inputMode="numeric" autoComplete="one-time-code" placeholder="123456" className="pl-8 tracking-wider h-9 text-sm" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} />
                      </div>
                      <Button type="button" size="sm" onClick={handleVerifyOtp} disabled={loadingKind === 'verifying' || showSuccessTick} className={`h-9 px-4 text-sm w-28 transition-colors duration-300 ${showSuccessTick ? 'bg-green-500 hover:bg-green-600' : ''}`}>
                        {showSuccessTick ? <CheckCircle2 className="w-5 h-5 text-white" /> : (loadingKind === 'verifying' ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Confirm')}
                      </Button>
                    </div>
                    <div className="text-center text-xs text-gray-500 pt-1">
                      Didn't receive a code?{' '}
                      <Button type="button" variant="link" size="sm" onClick={handleSendOtp} disabled={resendCooldown > 0} className="h-auto p-0 text-xs font-semibold text-blue-600 hover:text-blue-800 disabled:text-gray-500 disabled:no-underline">
                        {resendCooldown > 0 ? (resendCooldown > 60 ? `Wait ${Math.ceil(resendCooldown / 60)} min` : `Resend in ${resendCooldown}s`) : 'Resend now'}
                      </Button>
                    </div>
                  </div>
                )}

                {errorMsg && (
                  <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 p-2 rounded border">
                    <AlertCircle className="w-3 h-3" />
                    <span>{errorMsg}</span>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs font-medium">Payout Method</Label>
                    <Select value={payoutMethod} onValueChange={(v) => { setPayoutMethod(v); setPaynowValue(''); setBankName(''); setBankAccount(''); }}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select method" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="PayNow">PayNow</SelectItem>
                        <SelectItem value="Bank Transfer">Bank Transfer</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    {payoutMethod === 'PayNow' ? (
                      <div className="space-y-2">
                        <Label className="text-xs font-medium">PayNow Type</Label>
                        <Select value={paynowType} onValueChange={(v) => { setPaynowType(v); setPaynowValue(''); }}>
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="UEN">UEN</SelectItem>
                            <SelectItem value="Number">Phone Number</SelectItem>
                            <SelectItem value="NRIC">NRIC</SelectItem>
                          </SelectContent>
                        </Select>
                        {paynowType === 'Number' ? (
                          <div>
                            <Label className="text-xs font-medium">PayNow Number</Label>
                            <div>
                              <div className="relative h-8">
                                <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-gray-700 text-sm whitespace-nowrap">🇸🇬 +65</span>
                                <Input
                                  type="tel"
                                  placeholder="9123 4567"
                                  className={`pl-16 h-8 text-sm ${paynowError ? 'border-red-500 focus:border-red-500 focus:ring-red-500' : ''}`}
                                  value={displayPaynowPhone(paynowValue)}
                                  onChange={(e) => handlePaynowPhoneChange(e.target.value)}
                                  maxLength={9}
                                />
                              </div>
                              {paynowError && (
                                <div className="text-xs text-red-600 mt-1">{paynowError}</div>
                              )}
                            </div>
                          </div>
                        ) : (
                          <div>
                            <Label className="text-xs font-medium">{paynowType === 'UEN' ? 'UEN' : 'NRIC'}</Label>
                            <Input
                              type="text"
                              className={`w-full h-8 text-sm ${paynowType === 'NRIC' && nricError ? 'border-red-500 focus:border-red-500 focus:ring-red-500' : ''}`}
                              placeholder={paynowType === 'UEN' ? 'e.g., 201912345Z' : 'e.g., S1234567A'}
                              value={paynowValue}
                              onChange={(e) => (paynowType === 'UEN' ? handleUENChange(e.target.value) : handleNRICChange(e.target.value))}
                              maxLength={paynowType === 'UEN' ? 10 : 9}
                            />
                            {paynowType === 'NRIC' && nricError && (
                              <div className="text-xs text-red-600 mt-1">{nricError}</div>
                            )}
                          </div>
                        )}
                      </div>
                    ) : payoutMethod === 'Bank Transfer' ? (
                      <div className="grid grid-cols-1 gap-2">
                        <div>
                          <Label className="text-xs font-medium">Bank Name</Label>
                          <Select value={bankName} onValueChange={(v) => setBankName(v)}>
                            <SelectTrigger className="w-full h-8 text-sm">
                              <SelectValue placeholder="Select Bank" />
                            </SelectTrigger>
                            <SelectContent>
                              {BANK_OPTIONS.map((b) => (
                                <SelectItem key={b} value={b}>{b}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label className="text-xs font-medium">Bank Account Number</Label>
                          <Input
                            type="text"
                            className="w-full h-8 text-sm"
                            inputMode="numeric"
                            placeholder="Up to 20 digits (no dashes)"
                            value={bankAccount}
                            maxLength={20}
                            onChange={(e) => {
                              const digits = String(e.target.value || '').replace(/\D/g, '').slice(0, 20);
                              setBankAccount(digits);
                            }}
                          />
                          <div className="text-[10px] text-gray-500 mt-1">Up to 20 digits. Please remove any dashes.</div>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <Label className="text-xs font-medium">PayNow / Bank Details</Label>
                        <Input type="text" className="w-full h-8 text-sm" placeholder="Select a payout method to enter details" disabled />
                      </div>
                    )}
                  </div>
                </div>

                <div className="pt-2">
                  <Button onClick={handleUpdateProfile} disabled={loadingKind === 'updating'} className="bg-black hover:bg-gray-800">
                    {loadingKind === 'updating' ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Update'}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card className="mt-6">
              <CardHeader>
                <CardTitle className="text-lg">Car Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {!carId ? (
                  <div className="text-sm text-gray-500">No car assigned yet.</div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <Label className="text-xs font-medium">Car plate number</Label>
                      <Input
                        className={`h-8 text-sm ${carErrors.plate ? 'border-red-500 focus:border-red-500 focus:ring-red-500' : ''}`}
                        value={carPlate}
                        onChange={(e) => {
                          const v = formatPlateInputToStrict(e.target.value);
                          setCarPlate(v);
                          if (v.length === 0) {
                            setCarErrors(prev => ({ ...prev, plate: undefined }));
                          } else if (!isValidAllowedPlateFormat(v)) {
                            setCarErrors(prev => ({ ...prev, plate: 'Format: EA–EZ or SB–SN + 1–4 digits + letter' }));
                          } else {
                            setCarErrors(prev => ({ ...prev, plate: undefined }));
                          }
                        }}
                        placeholder="e.g., SGP1234A"
                      />
                      {carErrors.plate && <div className="text-xs text-red-600 mt-1">{carErrors.plate}</div>}
                    </div>
                    <div>
                      <Label className="text-xs font-medium">Make</Label>
                      <select
                        className={`w-full border rounded h-8 text-sm px-2 ${carErrors.make ? 'border-red-500' : ''}`}
                        value={carMake}
                        onChange={(e) => { const val = e.target.value; setCarMake(val); setCarErrors(prev => ({ ...prev, make: undefined, customMake: undefined, model: undefined, customModel: undefined })); if (val !== 'Other') { setCarModel(''); setCarCustomMake(''); } }}
                      >
                        <option value="" disabled>Select Make</option>
                        {Object.keys(makesToModels).sort().map(m => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                        <option value="Other">Other</option>
                      </select>
                      {carErrors.make && <div className="text-xs text-red-600 mt-1">{carErrors.make}</div>}
                      {carMake === 'Other' && (
                        <Input className={`h-8 mt-2 text-sm ${carErrors.customMake ? 'border-red-500' : ''}`} placeholder="Enter make" value={carCustomMake} onChange={(e) => { setCarCustomMake(e.target.value); if (carErrors.customMake) setCarErrors(prev => ({ ...prev, customMake: undefined })); }} />
                      )}
                      {carErrors.customMake && <div className="text-xs text-red-600 mt-1">{carErrors.customMake}</div>}
                    </div>
                    <div className="md:col-span-2">
                      <Label className="text-xs font-medium">Model</Label>
                      {carMake === 'Other' ? (
                        <>
                          <Input className={`h-8 text-sm ${carErrors.customModel ? 'border-red-500' : ''}`} placeholder="Enter model" value={carCustomModel} onChange={(e) => { setCarCustomModel(e.target.value); if (carErrors.customModel) setCarErrors(prev => ({ ...prev, customModel: undefined })); }} />
                          {carErrors.customModel && <div className="text-xs text-red-600 mt-1">{carErrors.customModel}</div>}
                        </>
                      ) : (
                        <>
                          <select
                            className={`w-full border rounded h-8 text-sm px-2 ${carErrors.model ? 'border-red-500' : ''}`}
                            value={carModel}
                            onChange={(e) => { setCarModel(e.target.value); if (carErrors.model) setCarErrors(prev => ({ ...prev, model: undefined })); }}
                          >
                            <option value="" disabled>Select Model</option>
                            {availableModels.slice().sort().map(mo => (
                              <option key={mo} value={mo}>{mo}</option>
                            ))}
                            <option value="Other">Other</option>
                          </select>
                          {carErrors.model && <div className="text-xs text-red-600 mt-1">{carErrors.model}</div>}
                          {carModel === 'Other' && (
                            <Input className={`h-8 mt-2 text-sm ${carErrors.customModel ? 'border-red-500' : ''}`} placeholder="Enter model" value={carCustomModel} onChange={(e) => { setCarCustomModel(e.target.value); if (carErrors.customModel) setCarErrors(prev => ({ ...prev, customModel: undefined })); }} />
                          )}
                          {carErrors.customModel && <div className="text-xs text-red-600 mt-1">{carErrors.customModel}</div>}
                        </>
                      )}
                    </div>
                  </div>
                )}

                <div className="pt-2">
                  <Button onClick={saveCarDetails} disabled={!carId || carSaving} className="bg-black hover:bg-gray-800">
                    {carSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save Car'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </>
        )}

        {section === 'history' && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Payout History</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-sm text-gray-500">No payouts recorded yet.</div>
            </CardContent>
          </Card>
        )}

        {section === 'payslip' && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Payslip</CardTitle>
            </CardHeader>
            <CardContent>
              <Button variant="outline">Download Latest Payslip (Coming Soon)</Button>
            </CardContent>
          </Card>
        )}

        {section === 'dashboard' || !['profile', 'history', 'payslip'].includes(section) ? (
          <>
            <div className="grid lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 space-y-6">
                <Card className="shadow-md">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0">
                    <CardTitle className="text-lg">Successful Scans Trend</CardTitle>
                    <div className="w-40">
                      <Select value={period} onValueChange={setPeriod}>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="30d">Last 30 days</SelectItem>
                          <SelectItem value="7d">Last 7 days</SelectItem>
                          <SelectItem value="1d">Today (hourly)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="w-full h-72">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={scanTrend} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
                          <XAxis dataKey="label" tick={{ fontSize: 12 }} stroke="#94a3b8" />
                          <YAxis allowDecimals={false} tick={{ fontSize: 12 }} stroke="#94a3b8" />
                          <Tooltip formatter={(v) => [v, 'Scans']} labelStyle={{ color: '#64748b' }} />
                          <Line type="monotone" dataKey="count" stroke="#6366f1" strokeWidth={3} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>
                <Card className="shadow-md">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0">
                    <CardTitle className="text-lg">Earnings Trend</CardTitle>
                    <div className="w-40">
                      <Select value={period} onValueChange={setPeriod}>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="30d">Last 30 days</SelectItem>
                          <SelectItem value="7d">Last 7 days</SelectItem>
                          <SelectItem value="1d">Today (hourly)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="w-full h-72">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={earnTrend} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
                          <XAxis dataKey="label" tick={{ fontSize: 12 }} stroke="#94a3b8" />
                          <YAxis allowDecimals={false} tick={{ fontSize: 12 }} stroke="#94a3b8" tickFormatter={(v) => `$${v}`} />
                          <Tooltip formatter={(v) => [`$${Number(v).toFixed(2)}`, 'Earnings']} labelStyle={{ color: '#64748b' }} />
                          <Line type="monotone" dataKey="amount" stroke="#10b981" strokeWidth={3} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>
              </div>

              <div className="space-y-6">
                <CommissionSummary
                  commissions={commissions}
                  userRole="driver_partner"
                  period={period}
                  lifetimeEarnings={lifetimeEarnings}
                  lifetimeScans={lifetimeScans}
                />
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}


