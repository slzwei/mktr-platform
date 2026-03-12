import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle, RefreshCw } from "lucide-react";

export default function DashboardShell({ loading, error, onRetry, children }) {
  if (loading) {
    return (
      <div className="p-6 lg:p-8 min-h-screen bg-background">
        <div className="max-w-7xl mx-auto animate-pulse space-y-6">
          <div className="h-8 bg-muted rounded w-64" />
          <div className="h-4 bg-muted rounded w-48" />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-32 bg-muted rounded-xl" />
            ))}
          </div>
          <div className="grid lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 h-80 bg-muted rounded-xl" />
            <div className="h-80 bg-muted rounded-xl" />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 lg:p-8 min-h-screen bg-background">
        <div className="max-w-7xl mx-auto">
          <Card className="p-12 text-center border-none shadow-sm">
            <AlertCircle className="w-12 h-12 mx-auto mb-4 text-destructive/60" />
            <h3 className="text-lg font-semibold mb-2 text-foreground">Failed to load dashboard</h3>
            <p className="text-muted-foreground text-sm mb-4">{error}</p>
            {onRetry && (
              <Button onClick={onRetry} variant="outline">
                <RefreshCw className="w-4 h-4 mr-2" />
                Try Again
              </Button>
            )}
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 min-h-screen bg-background">
      <div className="max-w-7xl mx-auto space-y-8">
        {children}
      </div>
    </div>
  );
}
