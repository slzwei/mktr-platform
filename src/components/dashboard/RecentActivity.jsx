
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { format } from "date-fns";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { 
  Clock,
  Phone, 
  Mail,
  MapPin,
  ArrowRight,
  User
} from "lucide-react";

const statusColors = {
  new: "bg-blue-100 text-blue-800 border-blue-200",
  contacted: "bg-yellow-100 text-yellow-800 border-yellow-200", 
  meeting: "bg-purple-100 text-purple-800 border-purple-200",
  close_won: "bg-green-100 text-green-800 border-green-200",
  close_lost: "bg-red-100 text-red-800 border-red-200",
  rejected: "bg-gray-100 text-gray-800 border-gray-200"
};

const statusLabels = {
  new: "New",
  contacted: "Contacted", 
  meeting: "Meeting Set",
  close_won: "Closed Won",
  close_lost: "Closed Lost",
  rejected: "Rejected"
};

export default function RecentActivity({ prospects, userRole }) {
  const formatProspectDate = (prospect) => {
    const raw = prospect.created_date || prospect.createdAt || prospect.created_at || prospect.created || prospect.createdDate;
    if (!raw) return '—';
    const date = raw instanceof Date ? raw : new Date(raw);
    return isNaN(date.getTime()) ? '—' : format(date, 'PPp');
  };

  const recentProspects = prospects.slice(0, 10);

  return (
    <Card className="shadow-md">
      <CardHeader className="border-b border-gray-100">
        <div className="flex justify-between items-center">
          <CardTitle className="text-xl font-bold">Recent Activity</CardTitle>
          <Link to={createPageUrl("AdminProspects")}>
            <Button variant="outline" size="sm">
              View All
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </Link>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y divide-gray-100">
          {recentProspects.length > 0 ? (
            recentProspects.map((prospect) => (
              <div key={prospect.id} className="p-6 hover:bg-gray-50 transition-colors">
                <div className="flex items-start gap-4">
                  <Avatar className="w-10 h-10 shrink-0">
                    <AvatarFallback className="bg-blue-100 text-blue-700">
                      {prospect.name?.charAt(0)?.toUpperCase() || 'P'}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-gray-900 truncate">
                          {prospect.name}
                        </h3>
                        <div className="flex items-center gap-4 text-sm text-gray-600 mt-1">
                          <div className="flex items-center gap-1">
                            <Phone className="w-4 h-4" />
                            {prospect.phone}
                          </div>
                          {prospect.email && (
                            <div className="flex items-center gap-1">
                              <Mail className="w-4 h-4" />
                              {prospect.email}
                            </div>
                          )}
                        </div>
                        {prospect.postal_code && (
                          <div className="flex items-center gap-1 text-sm text-gray-500 mt-1">
                            <MapPin className="w-4 h-4" />
                            {prospect.postal_code}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-3 ml-4">
                        <Badge 
                          variant="outline" 
                          className={statusColors[prospect.status]}
                        >
                          {statusLabels[prospect.status]}
                        </Badge>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mt-3 text-xs text-gray-500">
                      <Clock className="w-3 h-3" />
                      {formatProspectDate(prospect)}
                      {prospect.source && (
                        <span className="ml-2 px-2 py-1 bg-gray-100 rounded text-gray-600">
                          {prospect.source.toUpperCase()}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="p-8 text-center text-gray-500">
              <User className="w-12 h-12 mx-auto mb-3 text-gray-400" />
              <p className="font-medium">No recent activity</p>
              <p className="text-sm">New prospects will appear here</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
