import React, { useState, useEffect } from "react";
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
import { Save } from "lucide-react";

export default function CarFormDialog({ 
  open, 
  onOpenChange, 
  car, 
  onSubmit, 
  fleetOwners
}) {
  const [formData, setFormData] = useState({
    plate_number: "",
    fleet_owner_id: "",
    model: "",
    year: "",
    color: "",
    status: "active"
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (car) {
      setFormData({
        plate_number: car.plate_number || "",
        fleet_owner_id: car.fleet_owner_id || "",
        model: car.model || "",
        year: car.year || "",
        color: car.color || "",
        status: car.status || "active"
      });
    } else {
      setFormData({
        plate_number: "",
        fleet_owner_id: "",
        model: "",
        year: "",
        color: "",
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
      if (!formData.fleet_owner_id) {
        throw new Error("Fleet owner is required");
      }

      await onSubmit(formData);
      onOpenChange(false);
    } catch (err) {
      setError(err.message || "Failed to save vehicle");
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

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="model">Car Model</Label>
              <Input
                id="model"
                name="model"
                value={formData.model}
                onChange={handleChange}
                placeholder="e.g., Toyota Camry"
              />
            </div>

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