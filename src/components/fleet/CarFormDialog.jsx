import { useState, useEffect } from "react";
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
    }
    setError("");
  }, [car, open]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSelectChange = (name, value) => {
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      if (!formData.plate_number.trim()) {
        throw new Error("Plate number is required");
      }
      if (!formData.make.trim()) {
        throw new Error("Car make is required");
      }
      if (currentUserRole === 'admin' && !formData.fleet_owner_id) {
        throw new Error("Fleet owner is required");
      }

      // Convert year to number for validation
      const submitData = {
        ...formData,
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
              placeholder="e.g., SBS1234A"
              required
            />
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

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="make">Car Make *</Label>
              <Input
                id="make"
                name="make"
                value={formData.make}
                onChange={handleChange}
                placeholder="e.g., Toyota"
                required
              />
            </div>

            <div>
              <Label htmlFor="model">Car Model</Label>
              <Input
                id="model"
                name="model"
                value={formData.model}
                onChange={handleChange}
                placeholder="e.g., Camry"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="year">Year</Label>
              <Input
                id="year"
                name="year"
                type="number"
                value={formData.year}
                onChange={handleChange}
                placeholder="2020"
                min="1900"
                max="2030"
              />
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
                id="color"
                name="color"
                value={formData.color}
                onChange={handleChange}
                placeholder="e.g., White"
              />
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