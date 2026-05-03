import { Input } from"@/components/ui/input";
import { Label } from"@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from"@/components/ui/select";

export default function CarMakeModelFields({
 formData,
 setFormData,
 fieldErrors,
 setFieldErrors,
 customMake,
 setCustomMake,
 customModel,
 setCustomModel,
 makesToModels,
}) {
 return (
 <div className="grid grid-cols-2 gap-4">
 <div>
 <Label htmlFor="make">Car Make *</Label>
 <Select
 value={formData.make}
 onValueChange={(value) => {
 setFormData((prev) => ({ ...prev, make: value, model: '' }));
 setFieldErrors((prev)=>({ ...prev, make: undefined, model: undefined, customMake: undefined, customModel: undefined }));
 if (value !== 'Other') setCustomMake('');
 }}
 >
 <SelectTrigger id="make">
 <SelectValue placeholder="Select make"/>
 </SelectTrigger>
 <SelectContent>
 {Object.keys(makesToModels).sort().map((m) => (
 <SelectItem key={m} value={m}>{m}</SelectItem>
 ))}
 <SelectItem value="Other">Other</SelectItem>
 </SelectContent>
 </Select>
 {fieldErrors.make && <div className="text-destructive text-xs mt-1">{fieldErrors.make}</div>}
 {formData.make === 'Other' && (
 <div className="mt-2">
 <Input
 placeholder="Enter make" value={customMake}
 onChange={(e)=>{ setCustomMake(e.target.value); if (fieldErrors.customMake) setFieldErrors((prev)=>({ ...prev, customMake: undefined })); }}
 className={fieldErrors.customMake ? 'border-destructive focus-visible:ring-destructive/30' : ''}
 />
 {fieldErrors.customMake && <div className="text-destructive text-xs mt-1">{fieldErrors.customMake}</div>}
 </div>
 )}
 </div>

 <div>
 <Label htmlFor="model">Car Model *</Label>
 {formData.make === 'Other' ? (
 <>
 <Input
 id="model" name="custom_model" placeholder="Enter model" value={customModel}
 onChange={(e)=>{ setCustomModel(e.target.value); if (fieldErrors.customModel) setFieldErrors((prev)=>({ ...prev, customModel: undefined })); }}
 className={fieldErrors.customModel ? 'border-destructive focus-visible:ring-destructive/30' : ''}
 />
 {fieldErrors.customModel && <div className="text-destructive text-xs mt-1">{fieldErrors.customModel}</div>}
 </>
 ) : (
 <>
 <Select
 value={formData.model}
 onValueChange={(value) => {
 setFormData((prev) => ({ ...prev, model: value }));
 setFieldErrors((prev)=>({ ...prev, model: undefined, customModel: undefined }));
 if (value !== 'Other') setCustomModel('');
 }}
 >
 <SelectTrigger id="model">
 <SelectValue placeholder="Select model"/>
 </SelectTrigger>
 <SelectContent>
 {(makesToModels[formData.make] || []).slice().sort().map((mo) => (
 <SelectItem key={mo} value={mo}>{mo}</SelectItem>
 ))}
 <SelectItem value="Other">Other</SelectItem>
 </SelectContent>
 </Select>
 {fieldErrors.model && <div className="text-destructive text-xs mt-1">{fieldErrors.model}</div>}
 {formData.model === 'Other' && (
 <div className="mt-2">
 <Input
 placeholder="Enter model" value={customModel}
 onChange={(e)=>{ setCustomModel(e.target.value); if (fieldErrors.customModel) setFieldErrors((prev)=>({ ...prev, customModel: undefined })); }}
 className={fieldErrors.customModel ? 'border-destructive focus-visible:ring-destructive/30' : ''}
 />
 {fieldErrors.customModel && <div className="text-destructive text-xs mt-1">{fieldErrors.customModel}</div>}
 </div>
 )}
 </>
 )}
 </div>
 </div>
 );
}
