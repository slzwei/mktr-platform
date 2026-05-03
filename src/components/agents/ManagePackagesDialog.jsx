import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from"@/components/ui/dialog";
import { Button } from"@/components/ui/button";
import { Badge } from"@/components/ui/badge";
import { Input } from"@/components/ui/input";
import { Plus, Edit, Trash2, CheckCircle, XCircle } from"lucide-react";
import { format } from"date-fns";

/**
 * Dialog for viewing/editing an agent's assigned lead packages.
 *
 * Props:
 * - open / onOpenChange
 * - agent the agent whose packages we're managing
 * - packages array of package assignment objects
 * - editingAssignmentId id of the assignment being edited (or null)
 * - editLeadCount controlled string for the lead-count input
 * - onEditLeadCountChange (value) => void
 * - onStartEdit (assignment) => void
 * - onCancelEdit () => void
 * - onUpdateAssignment (assignmentId) => void
 * - onDeleteAssignment (assignmentId) => void
 * - onAssignPackage () => void — opens the"Assign Package"dialog
 */
export default function ManagePackagesDialog({
 open,
 onOpenChange,
 agent,
 packages,
 editingAssignmentId,
 editLeadCount,
 onEditLeadCountChange,
 onStartEdit,
 onCancelEdit,
 onUpdateAssignment,
 onDeleteAssignment,
 onAssignPackage,
}) {
 return (
 <Dialog open={open} onOpenChange={onOpenChange}>
 <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
 <DialogHeader>
 <div className="flex items-center justify-between gap-4">
 <div>
 <DialogTitle>
 Packages assigned to {agent?.fullName || agent?.email}
 </DialogTitle>
 <DialogDescription>
 View active lead package assignments.
 </DialogDescription>
 </div>
 <Button
 onClick={onAssignPackage}
 className="bg-primary hover:bg-primary/90" >
 <Plus className="w-4 h-4 mr-2"/>
 Assign Package
 </Button>
 </div>
 </DialogHeader>

 <div className="max-h-[60vh] overflow-y-auto divide-y dark:divide-gray-700">
 {packages.length === 0 ? (
 <div className="text-sm text-muted-foreground p-8 text-center bg-muted rounded-lg border border-dashed border-border">
 No packages assigned yet.
 </div>
 ) : (
 packages.map((assignment) => (
 <div key={assignment.id} className="py-4 first:pt-0 last:pb-0">
 <div className="flex items-start justify-between gap-4">
 {/* Package info */}
 <div className="min-w-0">
 <div className="flex items-center gap-2">
 <p className="font-semibold text-foreground">
 {assignment.package?.name ||"Unknown Package"}
 </p>
 <Badge
 variant="outline" className={`
 ${
 assignment.status ==="active" ?"bg-success/10 text-success border-success/30" :"" }
 ${
 assignment.status ==="exhausted" ?"bg-muted text-muted-foreground border-border" :"" }
 ${
 assignment.status ==="expired" ?"bg-warning/10 text-warning border-warning/30" :"" }
 `}
 >
 {assignment.status}
 </Badge>
 </div>
 <p className="text-sm text-muted-foreground mt-1">
 Campaign: {assignment.package?.campaign?.name ||"N/A"}
 </p>
 <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
 <span>
 Purchased:{""}
 {assignment.purchaseDate
 ? format(
 new Date(assignment.purchaseDate),
"MMM d, yyyy" )
 :"-"}
 </span>
 <span>Price: ${assignment.priceSnapshot}</span>
 </div>
 </div>

 {/* Leads remaining — edit or display */}
 {editingAssignmentId === assignment.id ? (
 <div className="flex items-center justify-end gap-2">
 <Input
 type="number" className="h-8 w-20 text-right" value={editLeadCount}
 onChange={(e) => onEditLeadCountChange(e.target.value)}
 min="0" />
 <div className="flex gap-1">
 <Button
 variant="ghost" size="icon" aria-label="Save lead count" className="h-8 w-8 text-success hover:text-success hover:bg-success/10" onClick={() => onUpdateAssignment(assignment.id)}
 >
 <CheckCircle className="h-4 w-4" aria-hidden="true" />
 </Button>
 <Button
 variant="ghost" size="icon" aria-label="Cancel edit" className="h-8 w-8 text-muted-foreground hover:text-muted-foreground dark:hover:text-muted-foreground hover:bg-muted" onClick={onCancelEdit}
 >
 <XCircle className="h-4 w-4" aria-hidden="true" />
 </Button>
 </div>
 </div>
 ) : (
 <div className="text-right group relative">
 <p className="text-sm font-medium text-foreground flex items-center justify-end gap-2">
 {assignment.leadsRemaining} / {assignment.leadsTotal}
 <button
 type="button"
 onClick={() => onStartEdit(assignment)}
 aria-label={`Edit leads remaining for ${assignment.packageName || 'package'}`}
 className="p-0.5 -m-0.5 rounded text-muted-foreground opacity-60 hover:opacity-100 focus-visible:opacity-100 hover:text-primary focus-visible:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-opacity"
 >
 <Edit className="w-3 h-3" aria-hidden="true" />
 </button>
 </p>
 <p className="text-xs text-muted-foreground">
 leads remaining
 </p>
 </div>
 )}

 {/* Delete button */}
 <Button
 variant="ghost" size="icon" aria-label={`Delete ${assignment.packageName || 'package'} assignment`} className="h-8 w-8 text-muted-foreground hover:text-destructive dark:hover:text-destructive hover:bg-destructive/10" onClick={() => onDeleteAssignment(assignment.id)}
 >
 <Trash2 className="h-4 w-4" aria-hidden="true" />
 </Button>
 </div>
 </div>
 ))
 )}
 </div>
 </DialogContent>
 </Dialog>
 );
}
