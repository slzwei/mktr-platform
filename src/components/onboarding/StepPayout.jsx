import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import PhoneIcon from 'lucide-react/icons/phone';
import { isValidSgMobile } from '@/utils/validation';
import { isValidNricFin } from '@/components/onboarding/helpers';
import LoadingButton from '@/components/onboarding/LoadingButton';

export default function StepPayout({
  payoutMethod,
  setPayoutMethod,
  paynowType,
  setPaynowType,
  paynowId,
  setPaynowId,
  bankName,
  setBankName,
  bankAccount,
  setBankAccount,
  phone,
  errors,
  setErrors,
  loading,
  savePayout,
  back,
}) {
  return (
    <div className="w-full flex-shrink-0 p-6 space-y-4">
      <div>
        <label className="block text-sm text-gray-600 mb-1">Commission payout method</label>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => setPayoutMethod('PayNow')} className={`border rounded p-3 ${payoutMethod === 'PayNow' ? 'border-black' : 'border-gray-200'}`}>PayNow</button>
          <button onClick={() => setPayoutMethod('Bank Transfer')} className={`border rounded p-3 ${payoutMethod === 'Bank Transfer' ? 'border-black' : 'border-gray-200'}`}>Bank Transfer</button>
        </div>
      </div>
      {payoutMethod === 'PayNow' && (
        <div className="space-y-2">
          <label className="block text-sm text-gray-600">PayNow ID</label>
          <div className="grid grid-cols-3 gap-2">
            <button type="button" onClick={() => { setPaynowType('mobile'); if (isValidSgMobile(phone)) setPaynowId(`+65${phone}`); else setPaynowId(''); setErrors(prev => ({ ...prev, paynowId: undefined })); }} className={`border rounded p-2 text-sm ${paynowType === 'mobile' ? 'border-black' : 'border-gray-200'}`}>Mobile</button>
            <button type="button" onClick={() => { setPaynowType('nric'); setPaynowId(''); setErrors(prev => ({ ...prev, paynowId: undefined })); }} className={`border rounded p-2 text-sm ${paynowType === 'nric' ? 'border-black' : 'border-gray-200'}`}>NRIC/FIN</button>
            <button type="button" onClick={() => { setPaynowType('uen'); setPaynowId(''); setErrors(prev => ({ ...prev, paynowId: undefined })); }} className={`border rounded p-2 text-sm ${paynowType === 'uen' ? 'border-black' : 'border-gray-200'}`}>UEN</button>
          </div>

          {paynowType === 'mobile' && (
            <div className="flex items-center gap-1">
              <div className="flex-grow flex">
                <div className="flex items-center px-3 bg-gray-50 border border-r-0 rounded-l-md h-9 text-sm font-medium text-gray-700 whitespace-nowrap">{"\uD83C\uDDF8\uD83C\uDDEC"} +65</div>
                <div className="relative flex-grow">
                  <PhoneIcon className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <Input
                    type="tel"
                    inputMode="numeric"
                    placeholder=""
                    className={`pl-8 h-9 text-sm rounded-l-none border-l-0 ${errors.paynowId ? 'border-red-500' : ''}`}
                    value={(function () {
                      const digits = String(paynowId || '').replace(/\D/g, '').replace(/^65/, '').slice(0, 8);
                      return digits.length <= 4 ? digits : `${digits.slice(0, 4)} ${digits.slice(4)}`;
                    })()}
                    onChange={(e) => {
                      const raw = e.target.value;
                      let digits = String(raw || '').replace(/\D/g, '');
                      if (digits.startsWith('65')) digits = digits.slice(2);
                      digits = digits.slice(0, 8);
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
                      setErrors(prev => ({ ...prev, paynowId: msg }));
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
              onChange={(e) => {
                const v = String(e.target.value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 9);
                setPaynowId(v);
                const valid = isValidNricFin(v);
                setErrors(prev => ({ ...prev, paynowId: v ? (valid ? undefined : 'Enter valid NRIC/FIN (e.g., S1234567A)') : 'NRIC/FIN is required' }));
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
              onChange={(e) => {
                const v = String(e.target.value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
                setPaynowId(v);
                const valid = (/^\d{8}[A-Z]$/.test(v)) || (/^\d{9}[A-Z]$/.test(v)) || (/^[ST]\d{2}[A-Z]\d{4}[A-Z]$/.test(v));
                setErrors(prev => ({ ...prev, paynowId: v ? (valid ? undefined : 'Enter valid UEN (9 or 10 chars, ends with letter)') : 'UEN is required' }));
              }}
              aria-invalid={!!errors.paynowId}
            />
          )}

          {errors.paynowId && <div className="text-red-600 text-xs">{errors.paynowId}</div>}
        </div>
      )}
      {payoutMethod === 'Bank Transfer' && (
        <div className="grid grid-cols-1 gap-2">
          <div>
            <label className="block text-sm text-gray-600">Bank name</label>
            <select
              className={`w-full border rounded p-2 ${errors.bankName ? 'border-red-500' : ''}`}
              value={bankName}
              onChange={e => { setBankName(e.target.value); if (errors.bankName) setErrors(prev => ({ ...prev, bankName: undefined })); }}
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
              onChange={e => {
                const digits = String(e.target.value || '').replace(/\D/g, '').slice(0, 20);
                setBankAccount(digits);
                if (errors.bankAccount) setErrors(prev => ({ ...prev, bankAccount: undefined }));
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
  );
}
