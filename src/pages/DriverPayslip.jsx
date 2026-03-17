import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useCurrentUser } from "@/hooks/queries/useUsersQuery";

export default function DriverPayslip() {
  const { data: user, isLoading: loading } = useCurrentUser();

  if (loading) {
    return (
      <div className="p-6 lg:p-8">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-64"></div>
          <div className="h-32 bg-gray-200 dark:bg-gray-700 rounded-xl"></div>
        </div>
      </div>
    );
  }

  // Role gating handled by ProtectedRoute; avoid double-deny here

  return (
    <div className="p-6 lg:p-8 bg-gray-50 dark:bg-gray-900 min-h-screen">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-2">Payslip</h1>
          <div className="flex items-center gap-4 text-gray-600 dark:text-gray-400">
            <Badge variant="outline" className="bg-indigo-50 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800">Driver Partner</Badge>
            <span className="text-sm">{user?.full_name || user?.fullName || 'Driver'}</span>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Payslip</CardTitle>
          </CardHeader>
          <CardContent>
            <Button variant="outline">Download Latest Payslip (Coming Soon)</Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
