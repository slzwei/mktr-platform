import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Filter } from "lucide-react";

export default function CarFilterBar({ filters, onFiltersChange, fleetOwners }) {
  return (
    <div className="flex flex-col lg:flex-row gap-4 items-start lg:items-center">
      <div className="relative flex-1 max-w-md">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 dark:text-gray-500 w-4 h-4" />
        <Input
          placeholder="Search by plate number..."
          value={filters.search}
          onChange={(e) => onFiltersChange({...filters, search: e.target.value})}
          className="pl-10"
        />
      </div>
      <div className="flex items-center gap-2">
        <Filter className="w-4 h-4 text-gray-500 dark:text-gray-400" />
        <Select
          value={filters.fleetOwner}
          onValueChange={(value) => onFiltersChange({...filters, fleetOwner: value})}
        >
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Fleets</SelectItem>
            {fleetOwners.map((owner) => (
              <SelectItem key={owner.id} value={owner.id}>
                {owner.full_name || owner.company_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
