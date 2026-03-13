import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
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
import { driverInviteSchema } from "@/schemas/fleet";

export default function DriverFormDialog({
  open,
  onOpenChange,
  driver,
  onSubmit
}) {
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(driverInviteSchema),
    defaultValues: { full_name: "", email: "", phone: "" },
  });

  useEffect(() => {
    if (open) {
      reset(driver
        ? { full_name: driver.full_name || "", email: driver.email || "", phone: driver.phone || "" }
        : { full_name: "", email: "", phone: "" }
      );
    }
  }, [driver, open, reset]);

  const onFormSubmit = async (data) => {
    try {
      // Split full_name into firstName and lastName for User model
      const nameParts = data.full_name.trim().split(' ');
      const firstName = nameParts[0] || '';
      const lastName = nameParts.slice(1).join(' ') || nameParts[0] || '';

      const submitData = {
        firstName,
        lastName,
        email: data.email,
        phone: data.phone,
        role: 'driver_partner'
      };

      await onSubmit(submitData);
      onOpenChange(false);
    } catch (err) {
      setError("root", { message: err.message || "Failed to save driver" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{driver ? "Edit Driver" : "Add New Driver"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onFormSubmit)} className="space-y-4 py-4">
          <div>
            <Label htmlFor="full_name">Full Name *</Label>
            <Input
              id="full_name"
              placeholder="Driver's full name"
              {...register("full_name")}
            />
            {errors.full_name && (
              <p className="text-red-600 text-xs mt-1">{errors.full_name.message}</p>
            )}
          </div>

          <div>
            <Label htmlFor="email">Email Address *</Label>
            <Input
              id="email"
              type="email"
              placeholder="driver@example.com"
              {...register("email")}
            />
            {errors.email && (
              <p className="text-red-600 text-xs mt-1">{errors.email.message}</p>
            )}
          </div>

          <div>
            <Label htmlFor="phone">Phone Number</Label>
            <Input
              id="phone"
              placeholder="+65 XXXX XXXX"
              {...register("phone")}
            />
            {errors.phone && (
              <p className="text-red-600 text-xs mt-1">{errors.phone.message}</p>
            )}
          </div>

          {errors.root && (
            <div className="text-red-600 text-sm bg-red-50 p-3 rounded">
              {errors.root.message}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting} className="bg-blue-600 hover:bg-blue-700">
              <Save className="w-4 h-4 mr-2" />
              {isSubmitting ? "Saving..." : "Save Driver"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
