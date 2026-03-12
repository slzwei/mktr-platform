import { Button } from '@/components/ui/button';
import ChevronsDown from 'lucide-react/icons/chevrons-down';
import ChevronsUp from 'lucide-react/icons/chevrons-up';
import LoadingButton from '@/components/onboarding/LoadingButton';

export default function StepFinal({
  role,
  plate,
  setPlate,
  make,
  setMake,
  model,
  setModel,
  models,
  customMake,
  setCustomMake,
  customModel,
  setCustomModel,
  carsRows,
  setCarsRows,
  carsSaved,
  setCarsSaved,
  savedCars,
  rowErrors,
  gridRef,
  gridShowDownHint,
  gridShowUpHint,
  errors,
  setErrors,
  loading,
  createCar,
  validateAndStageCars,
  finalizeFleetCars,
  handleCsvFileChange,
  back,
  navigate,
  makesToModels,
}) {
  return (
    <div className="w-full flex-shrink-0 p-6 space-y-4">
      {role === 'driver_partner' && (
        <>
          <div className="grid grid-cols-1 gap-2">
            {errors._server && (
              <div className="text-red-600 text-sm mb-2">{errors._server}</div>
            )}
            <div>
              <label className="block text-sm text-gray-600">Car plate number</label>
              <input className={`w-full border rounded p-2 ${errors.plate ? 'border-red-500' : ''}`} value={plate} onChange={e => { setPlate(e.target.value.toUpperCase()); if (errors.plate) setErrors(prev => ({ ...prev, plate: undefined })); }} placeholder="e.g. SGP1234A" />
              {errors.plate && <div className="text-red-600 text-xs mt-1">{errors.plate}</div>}
            </div>
            <div>
              <label className="block text-sm text-gray-600">Make</label>
              <select className={`w-full border rounded p-2 ${errors.make ? 'border-red-500' : ''}`} value={make} onChange={e => { const val = e.target.value; setMake(val); setErrors(prev => ({ ...prev, make: undefined, customMake: undefined, model: undefined, customModel: undefined })); if (val !== 'Other') { setModel(''); setCustomMake(''); } }}>
                <option value="" disabled>Select Make</option>
                {Object.keys(makesToModels).sort().map(m => <option key={m} value={m}>{m}</option>)}
                <option value="Other">Other</option>
              </select>
              {errors.make && <div className="text-red-600 text-xs mt-1">{errors.make}</div>}
              {make === 'Other' && (
                <input className={`w-full border rounded p-2 mt-2 ${errors.customMake ? 'border-red-500' : ''}`} placeholder="Enter make" value={customMake} onChange={(e) => { setCustomMake(e.target.value); if (errors.customMake) setErrors(prev => ({ ...prev, customMake: undefined })); }} />
              )}
              {errors.customMake && <div className="text-red-600 text-xs mt-1">{errors.customMake}</div>}
            </div>
            <div>
              <label className="block text-sm text-gray-600">Model</label>
              {make === 'Other' ? (
                <>
                  <input className={`w-full border rounded p-2 ${errors.customModel ? 'border-red-500' : ''}`} placeholder="Enter model" value={customModel} onChange={(e) => { setCustomModel(e.target.value); if (errors.customModel) setErrors(prev => ({ ...prev, customModel: undefined })); }} />
                  {errors.customModel && <div className="text-red-600 text-xs mt-1">{errors.customModel}</div>}
                </>
              ) : (
                <>
                  <select className={`w-full border rounded p-2 ${errors.model ? 'border-red-500' : ''}`} value={model} onChange={e => { setModel(e.target.value); if (errors.model) setErrors(prev => ({ ...prev, model: undefined })); }}>
                    <option value="" disabled>Select Model</option>
                    {models.slice().sort().map(mo => <option key={mo} value={mo}>{mo}</option>)}
                    <option value="Other">Other</option>
                  </select>
                  {errors.model && <div className="text-red-600 text-xs mt-1">{errors.model}</div>}
                  {model === 'Other' && (
                    <input className={`w-full border rounded p-2 mt-2 ${errors.customModel ? 'border-red-500' : ''}`} placeholder="Enter model" value={customModel} onChange={(e) => { setCustomModel(e.target.value); if (errors.customModel) setErrors(prev => ({ ...prev, customModel: undefined })); }} />
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
                                onChange={e => {
                                  const v = e.target.value.toUpperCase();
                                  setCarsRows(rows => rows.map((row, i) => i === idx ? { ...row, plate_number: v } : row));
                                }}
                                placeholder="SGP1234A"
                              />
                              {rowErrors[idx] && <div className="text-[11px] text-red-600 mt-1">{rowErrors[idx]}</div>}
                            </td>
                            <td className="px-3 py-1.5 border-b">
                              <input
                                className="w-full border rounded p-1"
                                value={r.make}
                                onChange={e => {
                                  const v = e.target.value;
                                  setCarsRows(rows => rows.map((row, i) => i === idx ? { ...row, make: v } : row));
                                }}
                                placeholder="Toyota"
                              />
                            </td>
                            <td className="px-3 py-1.5 border-b">
                              <input
                                className="w-full border rounded p-1"
                                value={r.model}
                                onChange={e => {
                                  const v = e.target.value;
                                  setCarsRows(rows => rows.map((row, i) => i === idx ? { ...row, model: v } : row));
                                }}
                                placeholder="Corolla"
                              />
                            </td>
                            <td className="px-3 py-1.5 border-b">
                              <button type="button" className="text-xs text-red-600 underline" onClick={() => setCarsRows(rows => rows.filter((_, i) => i !== idx))}>Remove</button>
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
                    <Button type="button" variant="outline" onClick={() => setCarsRows(rows => [...rows, { plate_number: '', make: '', model: '' }])}>Add row</Button>
                    <Button type="button" variant="ghost" className="bg-gray-100 text-gray-800 hover:bg-gray-200" onClick={() => setCarsRows([{ plate_number: '', make: '', model: '' }])}>Clear</Button>
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
                    <Button variant="outline" onClick={() => setCarsSaved(false)}>Edit</Button>
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
            <Button onClick={() => navigate('/PendingApproval')}>Finish</Button>
          </div>
        </>
      )}

      {role === 'agent' && (
        <div className="space-y-4">
          <div className="text-gray-700">You're all set. You can start using your dashboard.</div>
          <div className="flex justify-between">
            <Button variant="ghost" className="bg-gray-100 text-gray-800 hover:bg-gray-200" onClick={back}>Back</Button>
            <Button onClick={() => navigate('/PendingApproval')}>Finish</Button>
          </div>
        </div>
      )}
    </div>
  );
}
