import React from"react";
import { Link } from"react-router-dom";
import { Badge } from"@/components/ui/badge";
import { Button } from"@/components/ui/button";
import { Checkbox } from"@/components/ui/checkbox";
import {
 Table,
 TableBody,
 TableCell,
 TableHead,
 TableHeader,
 TableRow,
} from"@/components/ui/table";
import TableEmpty from"@/components/common/TableEmpty";
import {
 DropdownMenu,
 DropdownMenuContent,
 DropdownMenuItem,
 DropdownMenuLabel,
 DropdownMenuSeparator,
 DropdownMenuTrigger,
} from"@/components/ui/dropdown-menu";
import {
 Plus,
 Edit,
 Eye,
 Phone,
 Mail,
 Package,
 Trash2,
 MoreHorizontal,
 CheckCircle,
 XCircle,
 ShieldAlert,
 UserCheck,
} from"lucide-react";
import { format } from"date-fns";
import { sourceBadge, isLyfeAgent, isMktrLeadsAgent, isLocalAgent } from"@/lib/agentSource";

/**
 * Determines whether an agent is in a"pending registration"state.
 * Only meaningful for LOCAL rows: mirrored agents (Lyfe / MKTR Leads) have no
 * local password and emailVerified=false by construction, so without the
 * source guard every mirrored agent rendered as"Invited"with a Resend item —
 * hiding the Activate/Deactivate action entirely.
 */
const isPending = (agent) =>
 isLocalAgent(agent) &&
 agent?.isActive === true &&
 (agent?.status ==="pending_registration"||
 !!agent?.invitationToken ||
 agent?.emailVerified === false);

/**
 * Agent list table with selection, inline actions, and a row-level dropdown menu.
 *
 * Props:
 * - agents filtered agent list
 * - selectedAgentIds array of selected ids
 * - onSelectAll (checked) => void
 * - onSelectAgent (agentId, checked) => void
 * - onBulkDelete () => void
 * - onViewDetails (agent) => void
 * - onEditAgent (agent) => void
 * - onDeleteAgent (agent) => void
 * - onToggleStatus (agent) => void
 * - onResendInvite (agent) => void
 * - onApprove (agentId) => void
 * - onReject (agentId) => void
 * - onManagePackages (agent) => void
 * - onAssignPackage (agent) => void
 */
export default function AgentTable({
 agents,
 selectedAgentIds,
 onSelectAll,
 onSelectAgent,
 onBulkDelete,
 onViewDetails,
 onEditAgent,
 onDeleteAgent,
 onToggleStatus,
 onResendInvite,
 onApprove,
 onReject,
 onManagePackages,
 onAssignPackage,
}) {
 return (
 <>
 {/* Bulk Action Bar */}
 {selectedAgentIds.length > 0 && (
 <div className="bg-primary/10 border-b border-border p-3 flex items-center justify-between animate-in slide-in-from-top-2">
 <span className="text-sm text-info font-medium ml-2">
 {selectedAgentIds.length} agents selected
 </span>
 <Button
 variant="destructive" size="sm" onClick={onBulkDelete}
 className="bg-destructive hover:bg-destructive/90 h-8" >
 <Trash2 className="w-4 h-4 mr-2"/>
 Delete Selected
 </Button>
 </div>
 )}

 <div className="overflow-x-auto">
 <Table>
 <TableHeader>
 <TableRow className="bg-muted/50 hover:bg-muted/50 border-border">
 <TableHead className="w-12 h-12 px-4 text-center">
 {/* Selection exists only for bulk-DELETE, which is a local-row concept:
 mirrored agents are owned by their source app. */}
 <Checkbox
 checked={
 agents.some(isLocalAgent) &&
 selectedAgentIds.length === agents.filter(isLocalAgent).length
 }
 disabled={!agents.some(isLocalAgent)}
 onCheckedChange={onSelectAll}
 aria-label="Select all" />
 </TableHead>
 <TableHead className="py-3 px-6 font-medium text-muted-foreground min-w-[200px]">
 Agent
 </TableHead>
 <TableHead className="py-3 px-6 font-medium text-muted-foreground min-w-[250px]">
 Contact
 </TableHead>
 <TableHead className="py-3 px-6 font-medium text-muted-foreground min-w-[110px]">
 Source
 </TableHead>
 <TableHead className="py-3 px-6 font-medium text-muted-foreground min-w-[140px]">
 Status
 </TableHead>
 <TableHead className="py-3 px-6 font-medium text-muted-foreground min-w-[160px]">
 Leads Owed
 </TableHead>
 <TableHead className="py-3 px-6 font-medium text-muted-foreground min-w-[140px]">
 Joined
 </TableHead>
 <TableHead className="py-3 px-6 font-medium text-muted-foreground text-right w-[80px]">
 Actions
 </TableHead>
 </TableRow>
 </TableHeader>
 <TableBody>
 {agents.length === 0 ? (
 <TableEmpty
 colSpan={8}
 icon={UserCheck}
 title="No agents found"
 description="Try adjusting your filters, or invite a new agent to get started." />
 ) : (
 agents.map((agent) => (
 <AgentRow
 key={agent.id}
 agent={agent}
 isSelected={selectedAgentIds.includes(agent.id)}
 onSelect={onSelectAgent}
 onViewDetails={onViewDetails}
 onEditAgent={onEditAgent}
 onDeleteAgent={onDeleteAgent}
 onToggleStatus={onToggleStatus}
 onResendInvite={onResendInvite}
 onApprove={onApprove}
 onReject={onReject}
 onManagePackages={onManagePackages}
 onAssignPackage={onAssignPackage}
 />
 ))
 )}
 </TableBody>
 </Table>
 </div>
 </>
 );
}

// ---------------------------------------------------------------------------
// Single row — kept in same file to avoid excessive file proliferation.
// Wrapped in React.memo to avoid re-renders when sibling rows change
// (e.g. selection toggling on a different row).
// ---------------------------------------------------------------------------

const AgentRow = React.memo(function AgentRow({
 agent,
 isSelected,
 onSelect,
 onViewDetails,
 onEditAgent,
 onDeleteAgent,
 onToggleStatus,
 onResendInvite,
 onApprove,
 onReject,
 onManagePackages,
 onAssignPackage,
}) {
 const pendingApproval =
 agent.approvalStatus ==="pending"|| agent.status ==="pending_approval";
 const pendingRegistration = isPending(agent);
 const isActive = agent.isActive && !pendingApproval && !pendingRegistration;
 const lyfe = isLyfeAgent(agent);
 const mktrLeads = isMktrLeadsAgent(agent);
 const local = isLocalAgent(agent);
 const source = sourceBadge(agent);

 const renderStatusBadge = () => {
 if (pendingApproval)
 return (
 <Badge
 variant="outline" className="bg-warning/10 text-warning border-warning/30 hover:bg-warning/10" >
 Pending Approval
 </Badge>
 );
 if (pendingRegistration)
 return (
 <Badge
 variant="outline" className="bg-info/10 text-info border-info/30 hover:bg-info/10" >
 Invited
 </Badge>
 );
 if (isActive)
 return (
 <Badge
 variant="outline" className="bg-success/10 text-success border-success/30 hover:bg-success/10" >
 Active
 </Badge>
 );
 return (
 <Badge
 variant="outline" className="bg-muted text-muted-foreground border-border hover:bg-muted" >
 Inactive
 </Badge>
 );
 };

 return (
 <TableRow
 className={`hover:bg-muted/50 border-border ${
 isSelected ?"bg-primary/10":"" }`}
 >
 {/* Checkbox — selection drives bulk-delete, a local-row concept */}
 <TableCell className="px-4 text-center">
 <Checkbox
 checked={isSelected}
 disabled={!local}
 onCheckedChange={(checked) => onSelect(agent.id, checked)}
 aria-label={`Select ${agent.fullName}`}
 />
 </TableCell>

 {/* Agent name + avatar */}
 <TableCell className="px-6 py-4">
 <div className="flex items-center gap-3">
 <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-medium uppercase text-xs">
 {agent.fullName?.[0] || agent.email?.[0] ||"?"}
 </div>
 <div>
 <Link
 to={`/AdminAgents/${agent.id}`}
 className="font-medium text-foreground hover:text-primary transition-colors" >
 {agent.fullName ||
 `${agent.firstName ||""} ${agent.lastName ||""}`.trim()}
 </Link>
 <p className="text-xs text-muted-foreground">
 ID: {agent.id.slice(-8)}
 </p>
 </div>
 </div>
 </TableCell>

 {/* Contact */}
 <TableCell className="px-6 py-4 max-w-[250px]">
 <div className="space-y-1 text-sm">
 <div className="flex items-start gap-1.5 text-muted-foreground break-all">
 <Mail className="w-3 h-3 text-muted-foreground shrink-0 mt-0.5"/>
 <span className="leading-tight">{agent.email}</span>
 </div>
 {agent.phone && (
 <div className="flex items-center gap-1.5 text-muted-foreground">
 <Phone className="w-3 h-3 text-muted-foreground shrink-0"/>
 {agent.phone}
 </div>
 )}
 </div>
 </TableCell>

 {/* Source */}
 <TableCell className="px-6 py-4">
 <Badge variant="outline" className={`${source.className} hover:bg-transparent whitespace-nowrap`}>
 {source.label}
 </Badge>
 </TableCell>

 {/* Status */}
 <TableCell className="px-6 py-4">{renderStatusBadge()}</TableCell>

 {/* Leads owed — credits are per-campaign ledgers, so when an agent holds
 more than one bucket the split is shown under the total. */}
 <TableCell className="px-6 py-4">
 <div className="flex items-center gap-2">
 <Badge
 variant="secondary" className="font-mono bg-muted text-foreground border-border" >
 {agent.owed_leads_count || 0}
 </Badge>
 <Button
 variant="ghost" size="sm" className="h-6 px-2 text-xs text-primary hover:text-primary hover:bg-primary/10 whitespace-nowrap" onClick={() => onAssignPackage(agent)}
 >
 <Plus className="w-3 h-3 mr-1"/> Assign
 </Button>
 </div>
 {(() => {
 const breakdown = agent.owed_leads_breakdown || [];
 const manual = agent.owed_leads_manual_count || 0;
 const buckets = breakdown.length + (manual > 0 ? 1 : 0);
 if (buckets <= 1) return null;
 return (
 <div className="mt-1 space-y-0.5">
 {breakdown.map((b) => (
 <p key={b.campaignId || 'none'} className="text-[11px] leading-tight text-muted-foreground whitespace-nowrap">
 {b.campaignName || 'No campaign'} · {b.leadsRemaining}
 </p>
 ))}
 {manual > 0 && (
 <p className="text-[11px] leading-tight text-muted-foreground whitespace-nowrap">
 Manual · {manual}
 </p>
 )}
 </div>
 );
 })()}
 </TableCell>

 {/* Joined date */}
 <TableCell className="px-6 py-4 text-sm text-muted-foreground whitespace-nowrap">
 {agent.createdAt
 ? format(new Date(agent.createdAt),"MMM d, yyyy")
 : agent.created_date
 ? format(new Date(agent.created_date),"MMM d, yyyy")
 :"-"}
 </TableCell>

 {/* Actions dropdown */}
 <TableCell className="px-6 py-4 text-right">
 <DropdownMenu>
 <DropdownMenuTrigger asChild>
 <Button
 variant="ghost" className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground dark:hover:text-muted-foreground" >
 <MoreHorizontal className="h-4 w-4"/>
 </Button>
 </DropdownMenuTrigger>
 <DropdownMenuContent align="end" className="w-48">
 <DropdownMenuLabel>Manage Agent</DropdownMenuLabel>
 <DropdownMenuItem onClick={() => onViewDetails(agent)}>
 <Eye className="mr-2 h-4 w-4"/> View Profile
 </DropdownMenuItem>
 <DropdownMenuItem asChild>
 <Link
 to={`/AdminAgents/${agent.id}`}
 className="w-full cursor-pointer" >
 <UserCheck className="mr-2 h-4 w-4"/> View Assigned Leads
 </Link>
 </DropdownMenuItem>
 <DropdownMenuItem onClick={() => onEditAgent(agent)} disabled={lyfe}>
 <Edit className="mr-2 h-4 w-4"/> {lyfe ?"Edit (managed in Lyfe)":"Edit Profile"}
 </DropdownMenuItem>
 <DropdownMenuSeparator />
 <DropdownMenuItem onClick={() => onManagePackages(agent)}>
 <Package className="mr-2 h-4 w-4"/> Manage Packages
 </DropdownMenuItem>
 <DropdownMenuItem onClick={() => onAssignPackage(agent)}>
 <Package className="mr-2 h-4 w-4"/> Assign Lead Package
 </DropdownMenuItem>
 <DropdownMenuSeparator />
 {pendingApproval && (
 <>
 <DropdownMenuItem
 onClick={() => onApprove(agent.id)}
 className="text-success" >
 <CheckCircle className="mr-2 h-4 w-4"/> Approve
 </DropdownMenuItem>
 <DropdownMenuItem
 onClick={() => onReject(agent.id)}
 className="text-destructive" >
 <XCircle className="mr-2 h-4 w-4"/> Reject
 </DropdownMenuItem>
 </>
 )}
 {isPending(agent) ? (
 <DropdownMenuItem onClick={() => onResendInvite(agent)}>
 <Mail className="mr-2 h-4 w-4"/> Resend Invite
 </DropdownMenuItem>
 ) : (
 <DropdownMenuItem onClick={() => onToggleStatus(agent)} disabled={lyfe}>
 {agent.isActive ? (
 <>
 <ShieldAlert className="mr-2 h-4 w-4"/>
 {lyfe ?"Deactivate (in Lyfe)": mktrLeads ?"Deactivate in MKTR Leads":"Deactivate"}
 </>
 ) : (
 <>
 <CheckCircle className="mr-2 h-4 w-4"/>
 {lyfe ?"Activate (in Lyfe)": mktrLeads ?"Reactivate in MKTR Leads":"Activate"}
 </>
 )}
 </DropdownMenuItem>
 )}
 <DropdownMenuSeparator />
 {/* Delete is a local-row concept; mirrored agents are owned by their
 source app — retire them by deactivating instead. */}
 <DropdownMenuItem
 onClick={() => onDeleteAgent(agent)}
 disabled={!local}
 className="text-destructive" >
 <Trash2 className="mr-2 h-4 w-4"/>
 {local ?"Delete Agent": lyfe ?"Delete (managed in Lyfe)":"Delete (deactivate instead)"}
 </DropdownMenuItem>
 </DropdownMenuContent>
 </DropdownMenu>
 </TableCell>
 </TableRow>
 );
});
