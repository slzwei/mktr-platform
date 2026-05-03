import { Input } from"@/components/ui/input";
import { Button } from"@/components/ui/button";
import {
 Select,
 SelectContent,
 SelectItem,
 SelectTrigger,
 SelectValue,
} from"@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from"@/components/ui/tabs";
import {
 Search,
 LayoutGrid,
 List as ListIcon,
} from"lucide-react";

export default function UserFilters({
 searchTerm,
 onSearchChange,
 roleFilter,
 onRoleFilterChange,
 lifecycleTab,
 onLifecycleTabChange,
 viewMode,
 onViewModeChange,
 pagination,
 onPageSizeChange,
 pendingApprovalCount,
}) {
 return (
 <div className="space-y-4">
 {/* Tabs */}
 <Tabs value={lifecycleTab} onValueChange={onLifecycleTabChange} className="w-full">
 <TabsList className="bg-transparent border-b border-border w-full justify-start h-auto p-0 gap-6 rounded-none">
 <TabsTrigger
 value="all" className="data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:border-b-2 data-[state=active]:border-ring rounded-none px-0 py-2 text-muted-foreground hover:text-foreground dark:hover:text-muted-foreground transition-colors" >
 All Users
 </TabsTrigger>
 <TabsTrigger
 value="pending_approval" className="data-[state=active]:bg-transparent data-[state=active]:text-warning data-[state=active]:border-b-2 data-[state=active]:border-warning rounded-none px-0 py-2 text-muted-foreground hover:text-foreground dark:hover:text-muted-foreground transition-colors relative" >
 Pending Approval
 {pendingApprovalCount > 0 && (
 <span className="ml-2 bg-warning/15 text-warning text-[10px] font-bold px-1.5 py-0.5 rounded-full">
 {pendingApprovalCount}
 </span>
 )}
 </TabsTrigger>
 <TabsTrigger
 value="active" className="data-[state=active]:bg-transparent data-[state=active]:text-success data-[state=active]:border-b-2 data-[state=active]:border-success rounded-none px-0 py-2 text-muted-foreground hover:text-foreground dark:hover:text-muted-foreground transition-colors" >
 Active
 </TabsTrigger>
 <TabsTrigger
 value="pending_registration" className="data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:border-b-2 data-[state=active]:border-ring rounded-none px-0 py-2 text-muted-foreground hover:text-foreground dark:hover:text-muted-foreground transition-colors" >
 Pending Registration
 </TabsTrigger>
 <TabsTrigger
 value="inactive" className="data-[state=active]:bg-transparent data-[state=active]:text-foreground-foreground data-[state=active]:border-b-2 data-[state=active]:border-foreground rounded-none px-0 py-2 text-muted-foreground hover:text-foreground dark:hover:text-muted-foreground transition-colors" >
 Inactive
 </TabsTrigger>
 </TabsList>
 </Tabs>

 {/* Search, Role Filter, View Toggle */}
 <div className="flex flex-col lg:flex-row gap-4 justify-between items-start lg:items-center pt-2">
 <div className="flex flex-col sm:flex-row gap-2 flex-1 w-full lg:max-w-3xl">
 <div className="relative flex-1 min-w-[200px]">
 <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4"/>
 <Input
 placeholder="Search users by name or email..." value={searchTerm}
 onChange={(e) => onSearchChange(e.target.value)}
 className="pl-9 h-10 bg-muted/50 border-border focus:bg-background dark:focus:bg-foreground transition-colors" />
 </div>
 <Select value={roleFilter} onValueChange={onRoleFilterChange}>
 <SelectTrigger className="w-full sm:w-[150px] h-10">
 <SelectValue placeholder="All Roles"/>
 </SelectTrigger>
 <SelectContent>
 <SelectItem value="all">All Roles</SelectItem>
 <SelectItem value="admin">Admin</SelectItem>
 <SelectItem value="user">User</SelectItem>
 <SelectItem value="agent">Agent</SelectItem>
 </SelectContent>
 </Select>
 </div>

 {/* View Toggle & Page Size */}
 <div className="flex items-center gap-2">
 <div className=" hidden sm:flex items-center gap-2 text-sm text-muted-foreground mr-2">
 <span className=" hidden sm:inline">Rows:</span>
 <Select value={String(pagination.itemsPerPage)} onValueChange={(value) => onPageSizeChange(parseInt(value))}>
 <SelectTrigger className="w-[70px] h-9">
 <SelectValue />
 </SelectTrigger>
 <SelectContent>
 <SelectItem value="10">10</SelectItem>
 <SelectItem value="25">25</SelectItem>
 <SelectItem value="50">50</SelectItem>
 <SelectItem value="100">100</SelectItem>
 </SelectContent>
 </Select>
 </div>
 <div className="flex items-center border rounded-md p-1 bg-muted/50">
 <Button
 variant={viewMode === 'list' ? 'secondary' : 'ghost'}
 size="sm" className="h-8 px-2" onClick={() => onViewModeChange('list')}
 >
 <ListIcon className="w-4 h-4"/>
 </Button>
 <Button
 variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
 size="sm" className="h-8 px-2" onClick={() => onViewModeChange('grid')}
 >
 <LayoutGrid className="w-4 h-4"/>
 </Button>
 </div>
 </div>
 </div>
 </div>
 );
}
