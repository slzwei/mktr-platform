import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Plus, Edit, Trash2, CheckCircle, XCircle } from "lucide-react";
import { format } from "date-fns";

/**
 * Dialog for viewing/editing an agent's assigned lead packages.
 *
 * Props:
 *  - open / onOpenChange
 *  - agent                   the agent whose packages we're managing
 *  - packages                array of package assignment objects
 *  - editingAssignmentId     id of the assignment being edited (or null)
 *  - editLeadCount           controlled string for the lead-count input
 *  - onEditLeadCountChange   (value) => void
 *  - onStartEdit             (assignment) => void
 *  - onCancelEdit            () => void
 *  - onUpdateAssignment      (assignmentId) => void
 *  - onDeleteAssignment      (assignmentId) => void
 *  - onAssignPackage         () => void   — opens the "Assign Package" dialog
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
              className="bg-blue-600 hover:bg-blue-700"
            >
              <Plus className="w-4 h-4 mr-2" />
              Assign Package
            </Button>
          </div>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-y-auto divide-y dark:divide-gray-700">
          {packages.length === 0 ? (
            <div className="text-sm text-gray-500 dark:text-gray-400 p-8 text-center bg-gray-50 dark:bg-gray-800 rounded-lg border border-dashed border-gray-200 dark:border-gray-700">
              No packages assigned yet.
            </div>
          ) : (
            packages.map((assignment) => (
              <div key={assignment.id} className="py-4 first:pt-0 last:pb-0">
                <div className="flex items-start justify-between gap-4">
                  {/* Package info */}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-gray-900 dark:text-gray-100">
                        {assignment.package?.name || "Unknown Package"}
                      </p>
                      <Badge
                        variant="outline"
                        className={`
                          ${
                            assignment.status === "active"
                              ? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-700"
                              : ""
                          }
                          ${
                            assignment.status === "exhausted"
                              ? "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700"
                              : ""
                          }
                          ${
                            assignment.status === "expired"
                              ? "bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-700"
                              : ""
                          }
                        `}
                      >
                        {assignment.status}
                      </Badge>
                    </div>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                      Campaign: {assignment.package?.campaign?.name || "N/A"}
                    </p>
                    <div className="flex items-center gap-4 mt-2 text-xs text-gray-500 dark:text-gray-400">
                      <span>
                        Purchased:{" "}
                        {assignment.purchaseDate
                          ? format(
                              new Date(assignment.purchaseDate),
                              "MMM d, yyyy"
                            )
                          : "-"}
                      </span>
                      <span>Price: ${assignment.priceSnapshot}</span>
                    </div>
                  </div>

                  {/* Leads remaining — edit or display */}
                  {editingAssignmentId === assignment.id ? (
                    <div className="flex items-center justify-end gap-2">
                      <Input
                        type="number"
                        className="h-8 w-20 text-right"
                        value={editLeadCount}
                        onChange={(e) => onEditLeadCountChange(e.target.value)}
                        min="0"
                      />
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-400 hover:bg-green-50 dark:hover:bg-green-950/30"
                          onClick={() => onUpdateAssignment(assignment.id)}
                        >
                          <CheckCircle className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                          onClick={onCancelEdit}
                        >
                          <XCircle className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="text-right group relative">
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100 flex items-center justify-end gap-2">
                        {assignment.leadsRemaining} / {assignment.leadsTotal}
                        <Edit
                          className="w-3 h-3 text-gray-400 dark:text-gray-500 cursor-pointer opacity-0 group-hover:opacity-100 hover:text-blue-600 dark:hover:text-blue-400 transition-opacity"
                          onClick={() => onStartEdit(assignment)}
                        />
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        leads remaining
                      </p>
                    </div>
                  )}

                  {/* Delete button */}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-gray-400 dark:text-gray-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30"
                    onClick={() => onDeleteAssignment(assignment.id)}
                  >
                    <Trash2 className="h-4 w-4" />
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
