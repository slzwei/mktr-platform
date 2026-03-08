import { useEffect, useState } from "react";
import { auth } from "@/api/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

export default function DriverPayslip() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    auth.getCurrentUser().then((me) => {
      setUser(me);
    }).catch((e) => {
      console.error("Failed to load user", e);
    }).finally(() => {
      setLoading(false);
    });
  }, []);

  if (loading) {
    return (
      <div className="p-6 lg:p-8">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-gray-200 rounded w-64"></div>
          <div className="h-32 bg-gray-200 rounded-xl"></div>
        </div>
      </div>
    );
  }

  if (!user || user.role !== 'driver_partner') {
    return (
      <div className="p-6 lg:p-8 flex items-center justify-center min-h-[calc(100vh-64px)]">
        <Card className="max-w-md w-full text-center p-8">
          <CardHeader>
            <AlertTriangle className="w-16 h-16 text-yellow-500 mx-auto mb-4" />
            <CardTitle>Access Denied</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-gray-600 mb-4">You do not have permission to view this page.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 bg-gray-50 min-h-screen">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Payslip</h1>
          <div className="flex items-center gap-4 text-gray-600">
            <Badge variant="outline" className="bg-indigo-50 text-indigo-700 border-indigo-200">Driver Partner</Badge>
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
