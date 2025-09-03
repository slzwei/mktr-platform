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
import Save from "lucide-react/icons/save";

export default function DriverFormDialog({ 
  open, 
  onOpenChange, 
  driver, 
  onSubmit
}) {
  const [formData, setFormData] = useState({
    full_name: "",
    email: "",
    phone: ""
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (driver) {
      setFormData({
        full_name: driver.full_name || "",
        email: driver.email || "",
        phone: driver.phone || ""
      });
    } else {
      setFormData({
        full_name: "",
        email: "",
        phone: ""
      });
    }
    setError("");
  }, [driver, open]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
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

      // Split full_name into firstName and lastName for User model
      const nameParts = formData.full_name.trim().split(' ');
      const firstName = nameParts[0] || '';
      const lastName = nameParts.slice(1).join(' ') || nameParts[0] || ''; // Use first name as last name if only one name
      
      const submitData = {
        firstName,
        lastName,
        email: formData.email,
        phone: formData.phone,
        role: 'driver_partner'
      };

      await onSubmit(submitData);
      onOpenChange(false);
    } catch (err) {
      setError(err.message || "Failed to save driver");
    }
    setLoading(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{driver ? "Edit Driver" : "Add New Driver"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-4">
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
              placeholder="driver@example.com"
              required
            />
          </div>

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