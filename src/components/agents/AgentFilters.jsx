import { Input } from"@/components/ui/input";
import {
 Select,
 SelectTrigger,
 SelectContent,
 SelectItem,
 SelectValue,
} from"@/components/ui/select";
import { Search } from"lucide-react";

/**
 * Search input + status filter for the agents list.
 *
 * Props:
 * - searchTerm / onSearchChange
 * - statusFilter / onStatusFilterChange
 */
export default function AgentFilters({
 searchTerm,
 onSearchChange,
 statusFilter,
 onStatusFilterChange,
}) {
 return (
 <div className="flex flex-col lg:flex-row gap-4 items-start lg:items-center">
 <div className="relative flex-1 w-full lg:max-w-md">
 <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4"/>
 <Input
 placeholder="Search agents..." value={searchTerm}
 onChange={(e) => onSearchChange(e.target.value)}
 className="pl-9 h-9 bg-muted/50 border-border focus:bg-background" />
 </div>
 <div className="w-full lg:w-[180px]">
 <Select value={statusFilter} onValueChange={onStatusFilterChange}>
 <SelectTrigger className="h-9 bg-card">
 <SelectValue placeholder="Filter by status"/>
 </SelectTrigger>
 <SelectContent>
 <SelectItem value="all">All statuses</SelectItem>
 <SelectItem value="pending">Pending Registration</SelectItem>
 <SelectItem value="active">Active</SelectItem>
 <SelectItem value="inactive">Inactive</SelectItem>
 </SelectContent>
 </Select>
 </div>
 </div>
 );
}
