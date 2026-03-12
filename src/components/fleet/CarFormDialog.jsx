import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import Save from "lucide-react/icons/save";
import makeModelsRaw from "@/data/mktr_make_models.json";
import {
  ALLOWED_PLATE_PREFIXES,
  isValidSgPlate,
  parseSgPlate,
} from "@/utils/validation";
import CarMakeModelFields from "@/components/fleet/CarMakeModelFields";
import CarDetailFields from "@/components/fleet/CarDetailFields";

export default function CarFormDialog({
  open,
  onOpenChange,
  car,
  onSubmit,
  fleetOwners,
  currentUserRole,
  currentUserId
}) {
  const [formData, setFormData] = useState({
    plate_number: "",
    fleet_owner_id: "",
    make: "",
    model: "",
    year: "",
    color: "",
    type: "sedan",
    status: "active"
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [customMake, setCustomMake] = useState("");
  const [customModel, setCustomModel] = useState("");

  // Build make->models mapping like onboarding
  const makesToModels = useMemo(() => {
    return Object.keys(makeModelsRaw || {}).reduce((acc, make) => {
      const list = Array.isArray(makeModelsRaw[make]) ? makeModelsRaw[make].filter(Boolean) : [];
      acc[make] = list;
      return acc;
    }, {});
  }, []);

  // SG plate validation — shared from @/utils/validation
  const formatPlateInputToStrict = (plate) => parseSgPlate(plate);
  const isValidAllowedPlateFormat = (raw) => isValidSgPlate(raw);

  useEffect(() => {
    if (car) {
      setFormData({
        plate_number: car.plate_number || "",
        fleet_owner_id: car.fleet_owner_id || "",
        make: car.make || "",
        model: car.model || "",
        year: car.year || "",
        color: car.color || "",
        type: car.type || "sedan",
        status: car.status || "active"
      });
      // Pre-fill custom make/model when existing values are outside our list
      const knownMakes = Object.keys(makesToModels || {});
      if (car.make && !knownMakes.includes(car.make)) {
        setFormData((prev) => ({ ...prev, make: 'Other' }));
        setCustomMake(car.make);
      }
      if (car.model && car.make && (knownMakes.includes(car.make))) {
        const knownModels = makesToModels[car.make] || [];
        if (!knownModels.includes(car.model)) {
          setFormData((prev) => ({ ...prev, model: 'Other' }));
          setCustomModel(car.model);
        }
      }
    } else {
      setFormData({
        plate_number: "",
        fleet_owner_id: currentUserRole === 'fleet_owner' ? currentUserId : "",
        make: "",
        model: "",
        year: "",
        color: "",
        type: "sedan",
        status: "active"
      });
      setCustomMake("");
      setCustomModel("");
    }
    setError("");
    setFieldErrors({});
  }, [car, open]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    if (name === 'plate_number') {
      const next = formatPlateInputToStrict(value);
      setFormData((prev) => ({ ...prev, plate_number: next }));
      if (next.length === 0) {
        setFieldErrors((prev) => ({ ...prev, plate_number: undefined }));
      } else if (!isValidAllowedPlateFormat(next)) {
        setFieldErrors((prev) => ({ ...prev, plate_number: 'Format: EA–EZ or SB–SN + 1–4 digits + letter' }));
      } else {
        setFieldErrors((prev) => ({ ...prev, plate_number: undefined }));
      }
      return;
    }
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSelectChange = (name, value) => {
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setFieldErrors((prev)=>({ ...prev, _server: undefined }));

    try {
      const submitErrors = {};
      const plateClean = formatPlateInputToStrict(formData.plate_number);
      if (!plateClean) submitErrors.plate_number = 'Plate number is required';
      else if (!isValidAllowedPlateFormat(plateClean)) submitErrors.plate_number = 'Enter valid car plate (EA–EZ or SB–SN + 1–4 digits + letter)';

      if (!formData.make) submitErrors.make = 'Please select the car make';
      const finalMake = formData.make === 'Other' ? (customMake || '').trim() : formData.make;
      if (formData.make === 'Other' && !finalMake) submitErrors.customMake = 'Please enter the car make';

      let finalModel = formData.model;
      if (formData.make !== 'Other') {
        if (!formData.model) submitErrors.model = 'Please select the car model';
        if (formData.model === 'Other') {
          finalModel = (customModel || '').trim();
          if (!finalModel) submitErrors.customModel = 'Please enter the car model';
        }
      } else {
        finalModel = (customModel || '').trim();
        if (!finalModel) submitErrors.customModel = submitErrors.customModel || 'Please enter the car model';
      }

      if (currentUserRole === 'admin' && !formData.fleet_owner_id) {
        submitErrors.fleet_owner_id = 'Fleet owner is required';
      }

      if (Object.keys(submitErrors).length > 0) {
        setFieldErrors((prev) => ({ ...prev, ...submitErrors }));
        throw new Error(Object.values(submitErrors)[0] || 'Validation failed');
      }

      // Convert year to number for validation
      const submitData = {
        ...formData,
        plate_number: plateClean,
        make: finalMake,
        model: finalModel,
        year: formData.year ? parseInt(formData.year) : undefined
      };

      await onSubmit(submitData);
      onOpenChange(false);
    } catch (err) {
      console.error('Car form submission error:', err);

      // Handle specific validation errors
      let errorMessage = err.message || "Failed to save vehicle";

      if (errorMessage.includes("Validation error") || errorMessage.includes("must be unique")) {
        errorMessage = "A vehicle with this plate number already exists. Please use a different plate number.";
      } else if (errorMessage.includes("Fleet owner not found")) {
        errorMessage = "Selected fleet owner not found. Please select a valid fleet owner.";
      }

      setError(errorMessage);
    }
    setLoading(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{car ? "Edit Vehicle" : "Add New Vehicle"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          <div>
            <Label htmlFor="plate_number">Plate Number *</Label>
            <Input
              id="plate_number"
              name="plate_number"
              value={formData.plate_number}
              onChange={handleChange}
              placeholder="e.g., SGP1234A"
              required
              className={fieldErrors.plate_number ? 'border-red-500 focus-visible:ring-red-500' : ''}
            />
            {fieldErrors.plate_number && (
              <div className="text-red-600 text-xs mt-1">{fieldErrors.plate_number}</div>
            )}
          </div>

          {currentUserRole === 'admin' && (
            <div>
              <Label htmlFor="fleet_owner_id">Fleet Owner *</Label>
              <Select
                value={formData.fleet_owner_id}
                onValueChange={(value) => handleSelectChange("fleet_owner_id", value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select fleet owner" />
                </SelectTrigger>
                <SelectContent>
                  {fleetOwners.map((owner) => (
                    <SelectItem key={owner.id} value={owner.id}>
                      {owner.full_name || owner.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <CarMakeModelFields
            formData={formData}
            setFormData={setFormData}
            fieldErrors={fieldErrors}
            setFieldErrors={setFieldErrors}
            customMake={customMake}
            setCustomMake={setCustomMake}
            customModel={customModel}
            setCustomModel={setCustomModel}
            makesToModels={makesToModels}
          />

          <CarDetailFields
            formData={formData}
            handleChange={handleChange}
            handleSelectChange={handleSelectChange}
          />

          {error && (
            <div className="text-red-600 text-sm bg-red-50 p-3 rounded">
              {error}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading} className="bg-blue-600 hover:bg-blue-700">
              <Save className="w-4 h-4 mr-2" />
              {loading ? "Saving..." : "Save Vehicle"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
