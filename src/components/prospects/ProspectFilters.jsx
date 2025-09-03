import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Filter } from "lucide-react";

export default function ProspectFilters({ filters, onFilterChange, campaigns }) {
  const handleFilterChange = (key, value) => {
    onFilterChange({ ...filters, [key]: value });
  };

  return (
    <div className="flex flex-wrap gap-3">
      <div className="flex items-center gap-2">
        <Filter className="w-4 h-4 text-gray-500" />
        <Select 
          value={filters.status} 
          onValueChange={(value) => handleFilterChange('status', value)}
        >
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="new">New</SelectItem>
            <SelectItem value="contacted">Contacted</SelectItem>
            <SelectItem value="meeting">Meeting</SelectItem>
            <SelectItem value="close_won">Won</SelectItem>
            <SelectItem value="close_lost">Lost</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Select 
        value={filters.campaign} 
        onValueChange={(value) => handleFilterChange('campaign', value)}
      >
        <SelectTrigger className="w-40">
          <SelectValue placeholder="Campaign" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Campaigns</SelectItem>
          {campaigns.map((campaign) => (
            <SelectItem key={campaign.id} value={campaign.id}>
              {campaign.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select 
        value={filters.source} 
        onValueChange={(value) => handleFilterChange('source', value)}
      >
        <SelectTrigger className="w-32">
          <SelectValue placeholder="Source" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Sources</SelectItem>
          <SelectItem value="qr">QR</SelectItem>
          <SelectItem value="form">Form</SelectItem>
          <SelectItem value="other">Other</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}