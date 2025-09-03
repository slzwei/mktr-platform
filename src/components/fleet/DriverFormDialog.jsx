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

export default function DriverFormDialog({ 
  open, 
  onOpenChange, 
  driver, 
  onSubmit
}) {
  const [formData, setFormData] = useState({
    full_name: "",
    email: "",
    phone: "",
    license_number: "",
    payout_method: "",
    bank_account_number: "",
    status: "active"
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (driver) {
      setFormData({
        full_name: driver.full_name || "",
        email: driver.email || "",
        phone: driver.phone || "",
        license_number: driver.license_number || "",
        payout_method: driver.payout_method || "",
        bank_account_number: driver.bank_account_number || "",
        status: driver.status || "active"
      });
    } else {
      setFormData({
        full_name: "",
        email: "",
        phone: "",
        license_number: "",
        payout_method: "",
        bank_account_number: "",
        status: "active"
      });
    }
    setError("");
  }, [driver, open]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSelectChange = (name, value) => {
    setFormData((prev) => ({ 
      ...prev, 
      [name]: value,
      // Clear conditional fields when payout method changes
      ...(name === 'payout_method' && {
        bank_account_number: value === 'Bank Transfer' ? prev.bank_account_number : "",
        phone: value === 'PayNow' ? prev.phone : prev.phone
      })
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      if (!formData.full_name.trim()) {
        throw new Error("Full name is required");
      }
      if (!formData.email.trim()) {
        throw new Error("Email is required");
      }
      if (!formData.license_number.trim()) {
        throw new Error("License number is required");
      }

      // Conditional validation for payout methods
      if (formData.payout_method === 'PayNow' && !formData.phone.trim()) {
        throw new Error("Phone number is required for PayNow");
      }
      if (formData.payout_method === 'Bank Transfer' && !formData.bank_account_number.trim()) {
        throw new Error("Bank account number is required for Bank Transfer");
      }

      await onSubmit(formData);
      onOpenChange(false);
    } catch (err) {
      setError(err.message || "Failed to save driver");
    }
    setLoading(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{driver ? "Edit Driver" : "Add New Driver"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="full_name">Full Name *</Label>
              <Input
                id="full_name"
                name="full_name"
                value={formData.full_name}
                onChange={handleChange}
                placeholder="Driver's full name"
                required
              />
            </div>

            <div>
              <Label htmlFor="email">Email Address *</Label>
              <Input
                id="email"
                name="email"
                type="email"
                value={formData.email}
                onChange={handleChange}
                placeholder="driver@email.com"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="license_number">License Number *</Label>
              <Input
                id="license_number"
                name="license_number"
                value={formData.license_number}
                onChange={handleChange}
                placeholder="License number"
                required
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
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label htmlFor="payout_method">Payout Method</Label>
            <Select 
              value={formData.payout_method} 
              onValueChange={(value) => handleSelectChange("payout_method", value)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select payout method" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PayNow">PayNow</SelectItem>
                <SelectItem value="Bank Transfer">Bank Transfer</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Conditional payout fields */}
          {formData.payout_method === 'PayNow' && (
            <div>
              <Label htmlFor="phone">Phone Number *</Label>
              <Input
                id="phone"
                name="phone"
                value={formData.phone}
                onChange={handleChange}
                placeholder="+65 XXXX XXXX"
                required
              />
              <p className="text-xs text-gray-500 mt-1">Required for PayNow payments</p>
            </div>
          )}

          {formData.payout_method === 'Bank Transfer' && (
            <div>
              <Label htmlFor="bank_account_number">Bank Account Number *</Label>
              <Input
                id="bank_account_number"
                name="bank_account_number"
                value={formData.bank_account_number}
                onChange={handleChange}
                placeholder="Bank account number"
                required
              />
              <p className="text-xs text-gray-500 mt-1">Required for bank transfers</p>
            </div>
          )}

          {/* Optional phone field when not using PayNow */}
          {formData.payout_method !== 'PayNow' && (
            <div>
              <Label htmlFor="phone">Phone Number</Label>
              <Input
                id="phone"
                name="phone"
                value={formData.phone}
                onChange={handleChange}
                placeholder="+65 XXXX XXXX"
              />
            </div>
          )}

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
              {loading ? "Saving..." : "Save Driver"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}