import { useState, useEffect } from"react";
import { useForm, Controller } from"react-hook-form";
import { zodResolver } from"@hookform/resolvers/zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from"@/components/ui/dialog";
import { Button } from"@/components/ui/button";
import { Input } from"@/components/ui/input";
import { Label } from"@/components/ui/label";
import { Textarea } from"@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from"@/components/ui/select";
import Loader2 from"lucide-react/icons/loader-2";
import { Campaign } from"@/api/entities";
import { leadPackageTemplateSchema } from"@/schemas/leadPackage";

export default function LeadPackageTemplateDialog({ open, onOpenChange, onSubmit, editingPackage = null }) {
 const [campaigns, setCampaigns] = useState([]);

 const {
 register,
 handleSubmit,
 reset,
 control,
 setError,
 formState: { errors, isSubmitting },
 } = useForm({
 resolver: zodResolver(leadPackageTemplateSchema),
 defaultValues: {
 name:"",
 description:"",
 campaignId:"",
 type:"basic",
 leadCount: 100,
 price: 0,
 isPublic: true,
 status:"active",
 },
 });

 useEffect(() => {
 if (open) {
 loadCampaigns();
 reset(editingPackage
 ? {
 name: editingPackage.name ||"",
 description: editingPackage.description ||"",
 campaignId: editingPackage.campaignId ||"",
 type: editingPackage.type ||"basic",
 leadCount: editingPackage.leadCount || 100,
 price: editingPackage.price || 0,
 isPublic: editingPackage.isPublic !== false,
 status: editingPackage.status ||"active",
 }
 : {
 name:"",
 description:"",
 campaignId:"",
 type:"basic",
 leadCount: 100,
 price: 0,
 isPublic: true,
 status:"active",
 }
 );
 }
 }, [open, editingPackage, reset]);

 const loadCampaigns = async () => {
 try {
 const response = await Campaign.list({ status: 'active', limit: 100 });
 const list = response.campaigns || (Array.isArray(response) ? response : []);
 setCampaigns(list);
 } catch (err) {
 console.error("Failed to load campaigns", err);
 }
 };

 const onFormSubmit = async (data) => {
 try {
 await onSubmit(data);
 onOpenChange(false);
 } catch (err) {
 setError("root", { message: err.message ||"Failed to save package"});
 }
 };

 return (
 <Dialog open={open} onOpenChange={onOpenChange}>
 <DialogContent className="sm:max-w-[500px] max-h-[85vh] overflow-y-auto">
 <DialogHeader>
 <DialogTitle>{editingPackage ? 'Edit Package Template' : 'Create Package Template'}</DialogTitle>
 </DialogHeader>

 <form onSubmit={handleSubmit(onFormSubmit)} className="space-y-4">
 {errors.root && (
 <div className="bg-destructive/10 text-destructive p-3 rounded-md text-sm">
 {errors.root.message}
 </div>
 )}

 <div className="space-y-2">
 <Label htmlFor="name">Package Name *</Label>
 <Input
 id="name" placeholder="e.g., Gold Package (100 Leads)" {...register("name")}
 />
 {errors.name && (
 <p className="text-destructive text-xs mt-1">{errors.name.message}</p>
 )}
 </div>

 <div className="space-y-2">
 <Label htmlFor="campaign">Campaign *</Label>
 <Controller
 name="campaignId" control={control}
 render={({ field }) => (
 <Select value={field.value} onValueChange={field.onChange}>
 <SelectTrigger>
 <SelectValue placeholder="Select a campaign"/>
 </SelectTrigger>
 <SelectContent>
 {campaigns.map((c) => (
 <SelectItem key={c.id} value={c.id}>
 {c.name}
 </SelectItem>
 ))}
 </SelectContent>
 </Select>
 )}
 />
 {errors.campaignId && (
 <p className="text-destructive text-xs mt-1">{errors.campaignId.message}</p>
 )}
 </div>

 <div className="space-y-2">
 <Label htmlFor="type">Package Type</Label>
 <Controller
 name="type" control={control}
 render={({ field }) => (
 <Select value={field.value} onValueChange={field.onChange}>
 <SelectTrigger>
 <SelectValue placeholder="Select type"/>
 </SelectTrigger>
 <SelectContent>
 <SelectItem value="basic">Basic</SelectItem>
 <SelectItem value="premium">Premium</SelectItem>
 <SelectItem value="enterprise">Enterprise</SelectItem>
 <SelectItem value="custom">Custom</SelectItem>
 </SelectContent>
 </Select>
 )}
 />
 </div>

 <div className="grid grid-cols-2 gap-4">
 <div className="space-y-2">
 <Label htmlFor="leadCount">Total Leads *</Label>
 <Input
 id="leadCount" type="number" min="1" {...register("leadCount")}
 />
 {errors.leadCount && (
 <p className="text-destructive text-xs mt-1">{errors.leadCount.message}</p>
 )}
 </div>
 <div className="space-y-2">
 <Label htmlFor="price">Price (SGD) *</Label>
 <Input
 id="price" type="number" min="0" step="0.01" {...register("price")}
 />
 {errors.price && (
 <p className="text-destructive text-xs mt-1">{errors.price.message}</p>
 )}
 </div>
 </div>

 <div className="space-y-2">
 <Label htmlFor="description">Description</Label>
 <Textarea
 id="description" placeholder="Package details..." {...register("description")}
 />
 </div>

 <div className="flex justify-end gap-3 pt-4">
 <Button variant="outline" type="button" onClick={() => onOpenChange(false)}>
 Cancel
 </Button>
 <Button type="submit" disabled={isSubmitting}>
 {isSubmitting && <Loader2 className="w-4 h-4 mr-2 animate-spin"/>}
 {editingPackage ? 'Save Changes' : 'Create Template'}
 </Button>
 </div>
 </form>
 </DialogContent>
 </Dialog>
 );
}
