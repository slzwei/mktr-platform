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
import Save from "lucide-react/icons/save";
import FormRow from "@/components/common/FormRow";
import SubmitButton from "@/components/common/SubmitButton";
import { mktrLeadsInviteSchema, mktrLeadsEditSchema } from "@/schemas/mktrLeadsAgent";

/**
 * Invite (agent === null) or edit (agent with mktrLeadsId) an MKTR Leads agent.
 *
 * MKTR Leads is the source of truth: invites create a pending invitation in
 * that app (the person signs in there with their phone via OTP, which creates
 * the agent account; it mirrors here within ~10 minutes), and edits write back
 * to that app before refreshing the local mirror. Phone is identity in MKTR
 * Leads, so it is required on invite and not editable afterwards.
 */
export default function MktrLeadsAgentDialog({ open, onOpenChange, agent, onSubmit }) {
  const isEdit = !!agent;
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(isEdit ? mktrLeadsEditSchema : mktrLeadsInviteSchema),
    defaultValues: { phone: "", full_name: "", email: "", agency: "" },
  });

  useEffect(() => {
    if (open) {
      reset({
        phone: "",
        full_name: agent ? agent.fullName || `${agent.firstName || ""} ${agent.lastName || ""}`.trim() : "",
        email: agent?.email || "",
        agency: agent?.companyName || "",
      });
    }
  }, [agent, open, reset]);

  const onFormSubmit = async (data) => {
    try {
      await onSubmit(data, agent);
      onOpenChange(false);
    } catch (err) {
      setError("root", { message: err?.message || "Failed to save agent" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit MKTR Leads Agent" : "Invite MKTR Leads Agent"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Changes are saved in the MKTR Leads app (the source of truth) and mirrored here."
              : "They'll sign into the MKTR Leads app with this number via OTP to activate, then appear here within ~10 minutes."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onFormSubmit)} className="space-y-4 py-4">
          {!isEdit && (
            <FormRow label="Mobile Number" required error={errors.phone?.message}>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground shrink-0">+65</span>
                <Input type="tel" placeholder="9123 4567" {...register("phone")} />
              </div>
            </FormRow>
          )}

          <FormRow label="Full Name" required={isEdit} error={errors.full_name?.message}>
            <Input placeholder="Agent's full name" {...register("full_name")} />
          </FormRow>

          <FormRow label="Email Address" error={errors.email?.message}>
            <Input type="email" placeholder="agent@company.com (optional)" {...register("email")} />
          </FormRow>

          <FormRow label="Agency" error={errors.agency?.message}>
            <Input placeholder="Agency / company (optional)" {...register("agency")} />
          </FormRow>

          {errors.root && (
            <div className="text-destructive text-sm bg-destructive/10 p-3 rounded" role="alert">
              {errors.root.message}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <SubmitButton
              pending={isSubmitting}
              pendingText={isEdit ? "Saving..." : "Inviting..."}
              className="bg-primary hover:bg-primary/90"
            >
              <Save className="w-4 h-4" />
              {isEdit ? "Save Agent" : "Send Invite"}
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
