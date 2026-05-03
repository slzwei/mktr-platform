import { Loader2 } from"lucide-react";
import {
 AlertDialog,
 AlertDialogAction,
 AlertDialogCancel,
 AlertDialogContent,
 AlertDialogDescription,
 AlertDialogFooter,
 AlertDialogHeader,
 AlertDialogTitle,
} from"@/components/ui/alert-dialog";

export default function ReassignConfirmDialog({
 open,
 onOpenChange,
 precheck,
 campaignName,
 generating,
 onConfirm,
}) {
 return (
 <AlertDialog open={open} onOpenChange={onOpenChange}>
 <AlertDialogContent>
 <AlertDialogHeader>
 <AlertDialogTitle>Confirm reassignment</AlertDialogTitle>
 <AlertDialogDescription>
 {precheck.toReassign.length} car{precheck.toReassign.length !== 1 ? 's' : ''} already have a QR assigned to another campaign.
 Proceeding will reassign them to"{campaignName}". This keeps the same QR and link slug and preserves analytics.
 </AlertDialogDescription>
 </AlertDialogHeader>
 <div className="max-h-48 overflow-auto rounded border p-2 bg-muted text-sm">
 {precheck.toReassign.map(({ car, tag }) => (
 <div key={car.id} className="flex justify-between py-1">
 <span className="font-medium">{car.plate_number}</span>
 <span className="text-muted-foreground">from {precheck.campaignNames[tag.campaignId] || tag.campaignId || 'Unknown'}</span>
 </div>
 ))}
 {precheck.alreadyOnCampaign.length > 0 && (
 <div className="mt-3 text-muted-foreground">
 {precheck.alreadyOnCampaign.length} car{precheck.alreadyOnCampaign.length !== 1 ? 's are' : ' is'} already on this campaign and will be skipped.
 </div>
 )}
 </div>
 <AlertDialogFooter>
 <AlertDialogCancel disabled={generating}>Cancel</AlertDialogCancel>
 <AlertDialogAction
 onClick={onConfirm}
 disabled={generating}
 className="bg-primary hover:bg-primary/90" >
 {generating ? <Loader2 className="w-4 h-4 mr-2 animate-spin"/> : null}
 Confirm and Assign
 </AlertDialogAction>
 </AlertDialogFooter>
 </AlertDialogContent>
 </AlertDialog>
 );
}
