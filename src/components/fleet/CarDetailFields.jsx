import { Input } from"@/components/ui/input";
import { Label } from"@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from"@/components/ui/select";

export default function CarDetailFields({
 formData,
 handleChange,
 handleSelectChange,
}) {
 return (
 <>
 <div className="grid grid-cols-2 gap-4">
 <div>
 <Label htmlFor="year">Year</Label>
 <Input
 id="year" name="year" type="number" value={formData.year}
 onChange={handleChange}
 placeholder="2020" min="1900" max="2030" />
 </div>

 <div>
 <Label htmlFor="type">Vehicle Type *</Label>
 <Select
 value={formData.type}
 onValueChange={(value) => handleSelectChange("type", value)}
 >
 <SelectTrigger>
 <SelectValue />
 </SelectTrigger>
 <SelectContent>
 <SelectItem value="sedan">Sedan</SelectItem>
 <SelectItem value="suv">SUV</SelectItem>
 <SelectItem value="truck">Truck</SelectItem>
 <SelectItem value="van">Van</SelectItem>
 <SelectItem value="coupe">Coupe</SelectItem>
 <SelectItem value="hatchback">Hatchback</SelectItem>
 <SelectItem value="convertible">Convertible</SelectItem>
 <SelectItem value="other">Other</SelectItem>
 </SelectContent>
 </Select>
 </div>
 </div>

 <div className="grid grid-cols-2 gap-4">
 <div>
 <Label htmlFor="color">Color</Label>
 <Input
 id="color" name="color" value={formData.color}
 onChange={handleChange}
 placeholder="e.g., White" />
 </div>

 <div>
 <Label htmlFor="status">Status</Label>
 <Select
 value={formData.status}
 onValueChange={(value) => handleSelectChange("status", value)}
 >
 <SelectTrigger>
 <SelectValue />
 </SelectTrigger>
 <SelectContent>
 <SelectItem value="active">Active</SelectItem>
 <SelectItem value="maintenance">Maintenance</SelectItem>
 <SelectItem value="inactive">Inactive</SelectItem>
 </SelectContent>
 </Select>
 </div>
 </div>
 </>
 );
}
