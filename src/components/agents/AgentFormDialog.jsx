import { useEffect } from"react";
import { useForm } from"react-hook-form";
import { zodResolver } from"@hookform/resolvers/zod";
import { Button } from"@/components/ui/button";
import {
 Dialog,
 DialogContent,
 DialogHeader,
 DialogTitle,
 DialogFooter,
 DialogDescription,
} from"@/components/ui/dialog";
import { Input } from"@/components/ui/input";
import Save from"lucide-react/icons/save";
import FormRow from"@/components/common/FormRow";
import SubmitButton from"@/components/common/SubmitButton";
import { agentInviteSchema } from"@/schemas/agent";

const formatSgPhone = (raw) => {
 let digits = String(raw ||"").replace(/\D/g,"");
 // Stored canonical form is 65XXXXXXXX — strip the country code instead of
 // truncating the trailing digits (the old slice(0,8) mangled"6591234567"
 // into"6591 2345").
 if (digits.length === 10 && digits.startsWith("65")) digits = digits.slice(2);
 digits = digits.slice(0, 8);
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
 full_name:"",
 email:"",
 phone:"",
 dateOfBirth:"",
 owed_leads_count: 0,
 },
 });

 useEffect(() => {
 if (open) {
 if (agent) {
 reset({
 full_name: agent.fullName || `${agent.firstName || ''} ${agent.lastName || ''}`.trim(),
 email: agent.email ||"",
 phone: formatSgPhone(agent.phone ||""),
 dateOfBirth: agent.dateOfBirth ? String(agent.dateOfBirth).slice(0, 10) :"",
 owed_leads_count: agent.owed_leads_count || 0,
 });
 } else {
 reset({ full_name:"", email:"", phone:"", dateOfBirth:"", owed_leads_count: 0 });
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
 setError("root", { message: err?.message ||"Failed to save agent"});
 }
 };

 return (
 <Dialog open={open} onOpenChange={onOpenChange}>
 <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
 <DialogHeader>
 <DialogTitle>{agent ?"Edit Agent":"Invite New Agent"}</DialogTitle>
 <DialogDescription>
 {agent ?"Update the agent's information below.":"Enter the details to invite a new agent to your team."}
 </DialogDescription>
 </DialogHeader>
 <form onSubmit={handleSubmit(onFormSubmit)} className="space-y-4 py-4">
 <FormRow label="Full Name" required error={errors.full_name?.message}>
 <Input placeholder="Agent's full name" {...register("full_name")}/>
 </FormRow>

 <FormRow label="Email Address" required error={errors.email?.message}>
 <Input type="email" placeholder="agent@company.com" {...register("email")}/>
 </FormRow>

 {agent && (
 <FormRow label="Phone Number" error={errors.phone?.message}>
 <Input type="tel" placeholder="9123 4567" value={phoneValue} onChange={handlePhoneChange}/>
 </FormRow>
 )}

 {agent && (
 <FormRow label="Date of Birth" error={errors.dateOfBirth?.message}>
 <Input type="date" {...register("dateOfBirth")}/>
 </FormRow>
 )}

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
 pendingText="Inviting..." className="bg-primary hover:bg-primary/90" >
 <Save className="w-4 h-4"/>
 {agent ?"Save Agent":"Send Invite"}
 </SubmitButton>
 </DialogFooter>
 </form>
 </DialogContent>
 </Dialog>
 );
}
