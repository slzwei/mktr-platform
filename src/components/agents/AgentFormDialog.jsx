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
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Save from "lucide-react/icons/save";
import { agentInviteSchema } from "@/schemas/agent";

const formatSgPhone = (raw) => {
  const digits = String(raw || "").replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 4) return digits;
  return `${digits.slice(0, 4)} ${digits.slice(4)}`;
};

export default function AgentFormDialog({ open, onOpenChange, agent, onSubmit }) {
  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(agentInviteSchema),
    defaultValues: {
      full_name: "",
      email: "",
      phone: "",
      dateOfBirth: "",
      owed_leads_count: 0,
    },
  });

  useEffect(() => {
    if (open) {
      if (agent) {
        reset({
          full_name: agent.fullName || `${agent.firstName || ''} ${agent.lastName || ''}`.trim(),
          email: agent.email || "",
          phone: formatSgPhone(agent.phone || ""),
          dateOfBirth: agent.dateOfBirth ? String(agent.dateOfBirth).slice(0, 10) : "",
          owed_leads_count: agent.owed_leads_count || 0,
        });
      } else {
        reset({ full_name: "", email: "", phone: "", dateOfBirth: "", owed_leads_count: 0 });
      }
    }
  }, [agent, open, reset]);

  // Custom phone formatting
  const handlePhoneChange = (e) => {
    setValue("phone", formatSgPhone(e.target.value));
  };

  const phoneValue = watch("phone");

  const onFormSubmit = async (data) => {
    try {
      await onSubmit(data);
      onOpenChange(false);
    } catch (err) {
      setError("root", { message: err?.message || "Failed to save agent" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{agent ? "Edit Agent" : "Invite New Agent"}</DialogTitle>
          <DialogDescription>
            {agent ? "Update the agent's information below." : "Enter the details to invite a new agent to your team."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onFormSubmit)} className="space-y-4 py-4">
          <div>
            <Label htmlFor="full_name">Full Name *</Label>
            <Input
              id="full_name"
              placeholder="Agent's full name"
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
              placeholder="agent@company.com"
              {...register("email")}
            />
            {errors.email && (
              <p className="text-red-600 text-xs mt-1">{errors.email.message}</p>
            )}
          </div>

          {agent && (
            <div>
              <Label htmlFor="phone">Phone Number</Label>
              <Input
                id="phone"
                type="tel"
                placeholder="9123 4567"
                value={phoneValue}
                onChange={handlePhoneChange}
              />
              {errors.phone && (
                <p className="text-red-600 text-xs mt-1">{errors.phone.message}</p>
              )}
            </div>
          )}

          {agent && (
            <div>
              <Label htmlFor="dateOfBirth">Date of Birth</Label>
              <Input
                id="dateOfBirth"
                type="date"
                {...register("dateOfBirth")}
              />
            </div>
          )}

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
              {isSubmitting ? "Inviting..." : agent ? "Save Agent" : "Send Invite"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
