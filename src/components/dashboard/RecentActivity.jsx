
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { format } from "date-fns";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import {
  Clock,
  ArrowRight,
  MoreHorizontal
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const statusStyles = {
  new: "bg-blue-50 text-blue-700 border-blue-200",
  contacted: "bg-amber-50 text-amber-700 border-amber-200",
  meeting: "bg-violet-50 text-violet-700 border-violet-200",
  close_won: "bg-emerald-50 text-emerald-700 border-emerald-200",
  close_lost: "bg-rose-50 text-rose-700 border-rose-200",
  rejected: "bg-slate-50 text-slate-700 border-slate-200"
};

const statusLabels = {
  new: "New",
  contacted: "Contacted",
  meeting: "Meeting Set",
  close_won: "Won",
  close_lost: "Lost",
  rejected: "Rejected"
};

export default function RecentActivity({ prospects }) {
  const formatProspectDate = (prospect) => {
    const raw = prospect.created_date || prospect.createdAt || prospect.created_at || prospect.created || prospect.createdDate;
    if (!raw) return '—';
    const date = raw instanceof Date ? raw : new Date(raw);
    return isNaN(date.getTime()) ? '—' : format(date, 'MMM d, h:mm a');
  };

  const recentProspects = prospects.slice(0, 8);

  return (
    <Card className="border-none shadow-sm h-full">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
        <div>
          <CardTitle className="text-lg font-bold">Recent Activity</CardTitle>
          <p className="text-sm text-gray-500 mt-1">Latest prospect interactions</p>
        </div>
        <Link to={createPageUrl("AdminProspects")}>
          <Button variant="ghost" size="sm" className="text-blue-600 hover:text-blue-700 hover:bg-blue-50">
            View All
            <ArrowRight className="w-4 h-4 ml-1" />
          </Button>
        </Link>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-gray-50/50 text-gray-500 font-medium border-b border-gray-100">
              <tr>
                <th className="px-6 py-3">Prospect</th>
                <th className="px-6 py-3">Status</th>
                <th className="px-6 py-3">Date</th>
                <th className="px-6 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {recentProspects.length > 0 ? (
                recentProspects.map((prospect) => (
                  <tr key={prospect.id} className="hover:bg-gray-50/50 transition-colors group">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <Avatar className="w-8 h-8 shrink-0 border border-gray-100">
                          <AvatarFallback className="bg-white text-gray-700 text-xs font-medium">
                            {prospect.name?.charAt(0)?.toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="font-medium text-gray-900 group-hover:text-blue-600 transition-colors">
                          {prospect.name}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <Badge
                        variant="outline"
                        className={`font-normal ${statusStyles[prospect.status] || "bg-gray-50 text-gray-600"}`}
                      >
                        {statusLabels[prospect.status] || prospect.status}
                      </Badge>
                    </td>
                    <td className="px-6 py-4 text-gray-500 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-gray-400" />
                        {formatProspectDate(prospect)}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100 transition-opacity">
                            <span className="sr-only">Open menu</span>
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem>View Details</DropdownMenuItem>
                          <DropdownMenuItem>Previous Chats</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center text-gray-500">
                    No recent activity found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
