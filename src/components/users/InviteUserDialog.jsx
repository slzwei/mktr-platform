import { Button } from"@/components/ui/button";
import { Input } from"@/components/ui/input";
import { Label } from"@/components/ui/label";
import {
 Dialog,
 DialogContent,
 DialogHeader,
 DialogTitle,
 DialogDescription,
 DialogFooter
} from"@/components/ui/dialog";
import {
 Select,
 SelectContent,
 SelectItem,
 SelectTrigger,
 SelectValue,
} from"@/components/ui/select";

export default function InviteUserDialog({
 open,
 onOpenChange,
 inviteData,
 onInviteDataChange,
 onSubmit,
 loading,
}) {
 return (
 <Dialog open={open} onOpenChange={onOpenChange}>
 <DialogContent>
 <DialogHeader>
 <DialogTitle>Invite New User</DialogTitle>
 <DialogDescription>
 Send an invitation to a new user to join the platform.
 </DialogDescription>
 </DialogHeader>
 <form onSubmit={onSubmit}>
 <div className="grid gap-4 py-4">
 <div className="grid grid-cols-4 items-center gap-4">
 <Label htmlFor="fullName" className="text-right">Name</Label>
 <Input
 id="fullName" value={inviteData.fullName}
 onChange={(e) => onInviteDataChange({ ...inviteData, fullName: e.target.value })}
 className="col-span-3" placeholder="John Doe" required
 />
 </div>
 <div className="grid grid-cols-4 items-center gap-4">
 <Label htmlFor="email" className="text-right">Email</Label>
 <Input
 id="email" type="email" value={inviteData.email}
 onChange={(e) => onInviteDataChange({ ...inviteData, email: e.target.value })}
 className="col-span-3" placeholder="john@example.com" required
 />
 </div>
 <div className="grid grid-cols-4 items-center gap-4">
 <Label htmlFor="role" className="text-right">Role</Label>
 <Select
 value={inviteData.role}
 onValueChange={(val) => onInviteDataChange({ ...inviteData, role: val })}
 >
 <SelectTrigger className="col-span-3">
 <SelectValue placeholder="Select a role"/>
 </SelectTrigger>
 <SelectContent>
 <SelectItem value="user">User</SelectItem>
 <SelectItem value="agent">Agent</SelectItem>
 <SelectItem value="admin">Admin</SelectItem>
 </SelectContent>
 </Select>
 </div>
 </div>
 <DialogFooter>
 <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
 <Button type="submit" disabled={loading}>
 {loading ?"Sending...":"Send Invitation"}
 </Button>
 </DialogFooter>
 </form>
 </DialogContent>
 </Dialog>
 );
}
