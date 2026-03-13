import { useEffect } from "react";
import { useForm, Controller } from "react-hook-form";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import Save from "lucide-react/icons/save";
import { fleetOwnerSchema } from "@/schemas/fleet";

export default function FleetOwnerFormDialog({
  open,
  onOpenChange,
  fleetOwner,
  onSubmit
}) {
  const {
    register,
    handleSubmit,
    reset,
    control,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(fleetOwnerSchema),
    defaultValues: {
      full_name: "",
      email: "",
      phone: "",
      company_name: "",
      uen: "",
      payout_method: "",
      status: "active",
    },
  });

  useEffect(() => {
    if (open) {
      reset(fleetOwner
        ? {
            full_name: fleetOwner.full_name || "",
            email: fleetOwner.email || "",
            phone: fleetOwner.phone || "",
            company_name: fleetOwner.company_name || "",
            uen: fleetOwner.uen || "",
            payout_method: fleetOwner.payout_method || "",
            status: fleetOwner.status || "active",
          }
        : {
            full_name: "",
            email: "",
            phone: "",
            company_name: "",
            uen: "",
            payout_method: "",
            status: "active",
          }
      );
    }
  }, [fleetOwner, open, reset]);

  const onFormSubmit = async (data) => {
    try {
      await onSubmit(data);
      onOpenChange(false);
    } catch (err) {
      setError("root", { message: err.message || "Failed to save fleet owner" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{fleetOwner ? "Edit Fleet Owner" : "Add New Fleet Owner"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onFormSubmit)} className="space-y-4 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="full_name">Full Name *</Label>
              <Input
                id="full_name"
                placeholder="Fleet owner's full name"
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
                placeholder="owner@company.com"
                {...register("email")}
              />
              {errors.email && (
                <p className="text-red-600 text-xs mt-1">{errors.email.message}</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
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

            <div>
              <Label htmlFor="company_name">Company Name</Label>
              <Input
                id="company_name"
                placeholder="Company name (optional)"
                {...register("company_name")}
              />
              {errors.company_name && (
                <p className="text-red-600 text-xs mt-1">{errors.company_name.message}</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="uen">UEN</Label>
              <Input
                id="uen"
                placeholder="Unique Entity Number (optional)"
                {...register("uen")}
              />
              {errors.uen && (
                <p className="text-red-600 text-xs mt-1">{errors.uen.message}</p>
              )}
            </div>

            <div>
              <Label htmlFor="payout_method">Payout Method</Label>
              <Controller
                name="payout_method"
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select payout method" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PayNow">PayNow</SelectItem>
                      <SelectItem value="Bank Transfer">Bank Transfer</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
              {errors.payout_method && (
                <p className="text-red-600 text-xs mt-1">{errors.payout_method.message}</p>
              )}
            </div>
          </div>

          <div>
            <Label htmlFor="status">Status</Label>
            <Controller
              name="status"
              control={control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
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
              {isSubmitting ? "Saving..." : "Save Fleet Owner"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
