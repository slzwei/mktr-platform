import { Button } from"@/components/ui/button";
import { Input } from"@/components/ui/input";
import { Label } from"@/components/ui/label";
import { Separator } from"@/components/ui/separator";
import { format } from"date-fns";
import { Phone, Mail, MapPin, Calendar, User } from"lucide-react";

export default function ContactInfoCard({
 isEditing,
 firstName,
 lastName,
 email,
 phone,
 prospect,
 isUpdating,
 onFirstNameChange,
 onLastNameChange,
 onEmailChange,
 onPhoneChange,
 onSaveEdits,
 onCancelEdit,
}) {
 return (
 <div className="space-y-4">
 <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider flex items-center gap-2">
 <User className="w-4 h-4 text-muted-foreground"/>
 Contact Info
 </h3>
 {isEditing ? (
 <div className="space-y-3 bg-card p-3 rounded-lg border shadow-sm">
 <div className="grid grid-cols-2 gap-2">
 <div>
 <Label className="text-xs">First Name</Label>
 <Input value={firstName} onChange={(e) => onFirstNameChange(e.target.value)} className="h-8"/>
 </div>
 <div>
 <Label className="text-xs">Last Name</Label>
 <Input value={lastName} onChange={(e) => onLastNameChange(e.target.value)} className="h-8"/>
 </div>
 </div>
 <div>
 <Label className="text-xs">Email</Label>
 <Input value={email} onChange={(e) => onEmailChange(e.target.value)} className="h-8"/>
 </div>
 <div>
 <Label className="text-xs">Phone</Label>
 <Input value={phone} onChange={(e) => onPhoneChange(e.target.value)} className="h-8"/>
 </div>
 <div className="pt-2 flex gap-2">
 <Button size="sm" onClick={onSaveEdits} disabled={isUpdating} className="w-full">
 Save
 </Button>
 <Button size="sm" variant="outline" onClick={onCancelEdit} className="w-full">
 Cancel
 </Button>
 </div>
 </div>
 ) : (
 <div className="bg-card rounded-lg border shadow-sm p-4 space-y-3">
 <div className="group flex items-start gap-3">
 <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
 <Phone className="w-4 h-4 text-primary"/>
 </div>
 <div className="flex-1 min-w-0">
 <p className="text-xs font-medium text-muted-foreground">Phone</p>
 <p className="text-sm font-medium text-foreground break-all">{phone || '—'}</p>
 </div>
 </div>
 <Separator />
 <div className="group flex items-start gap-3">
 <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
 <Mail className="w-4 h-4 text-primary"/>
 </div>
 <div className="flex-1 min-w-0">
 <p className="text-xs font-medium text-muted-foreground">Email</p>
 <p className="text-sm font-medium text-foreground break-all">{email || '—'}</p>
 </div>
 </div>
 <Separator />
 <div className="group flex items-start gap-3">
 <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
 <Calendar className="w-4 h-4 text-primary"/>
 </div>
 <div className="flex-1 min-w-0">
 <p className="text-xs font-medium text-muted-foreground">Date of Birth</p>
 <p className="text-sm font-medium text-foreground">
 {prospect.date_of_birth ? format(new Date(prospect.date_of_birth), 'MMM d, yyyy') : '—'}
 </p>
 </div>
 </div>
 <Separator />
 <div className="group flex items-start gap-3">
 <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
 <MapPin className="w-4 h-4 text-primary"/>
 </div>
 <div className="flex-1 min-w-0">
 <p className="text-xs font-medium text-muted-foreground">Postal Code</p>
 <p className="text-sm font-medium text-foreground">{prospect.postal_code || '—'}</p>
 </div>
 </div>
 </div>
 )}
 </div>
 );
}
