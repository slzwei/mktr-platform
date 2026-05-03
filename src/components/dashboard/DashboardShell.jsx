import { Button } from '@/components/ui/button';
import { AlertCircle, RefreshCw } from 'lucide-react';

// Wraps dashboard-style pages with consistent loading + error chrome.
// Loading is a generic 4-card skeleton — specific layouts should live in
// the page itself once data has loaded.
export default function DashboardShell({ loading, error, onRetry, children }) {
    if (loading) {
        return (
            <div className="p-6 lg:p-8 min-h-screen bg-background animate-fade-in">
                <div className="max-w-7xl mx-auto space-y-6">
                    <div className="space-y-2">
                        <div className="h-7 w-52 bg-muted/60 rounded-md animate-pulse" />
                        <div className="h-4 w-36 bg-muted/60 rounded-md animate-pulse" />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
                        {[0, 1, 2, 3].map((i) => (
                            <div
                                key={i}
                                className="h-32 bg-card rounded-lg border border-border animate-pulse"
                                style={{ animationDelay: `${i * 80}ms` }}
                            />
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div
                className="p-6 lg:p-8 min-h-screen bg-background"
                role="alert"
                aria-live="polite"
            >
                <div className="max-w-7xl mx-auto flex items-center justify-center min-h-[60vh]">
                    <div className="text-center max-w-sm animate-fade-in-up">
                        <div className="w-14 h-14 bg-destructive/10 rounded-xl flex items-center justify-center mx-auto mb-5">
                            <AlertCircle
                                className="w-7 h-7 text-destructive"
                                aria-hidden="true"
                            />
                        </div>
                        <h3 className="text-lg font-semibold mb-2 text-foreground tracking-tight">
                            Failed to load dashboard
                        </h3>
                        <p className="text-muted-foreground text-sm mb-5 leading-relaxed">
                            {error}
                        </p>
                        {onRetry && (
                            <Button
                                onClick={onRetry}
                                variant="outline"
                                size="sm"
                                className="gap-2"
                            >
                                <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                                Try Again
                            </Button>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="p-6 lg:p-8 min-h-screen bg-background">
            <div className="max-w-7xl mx-auto space-y-6">{children}</div>
        </div>
    );
}
