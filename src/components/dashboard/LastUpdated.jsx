import { useState, useEffect } from"react";
import { RefreshCw } from"lucide-react";
import { Button } from"@/components/ui/button";
import { formatDistanceToNow } from"date-fns";

export default function LastUpdated({ lastUpdated, onRefresh, loading }) {
 const [, setTick] = useState(0);

 // Re-render every 30s to update the relative time
 useEffect(() => {
 const interval = setInterval(() => setTick(t => t + 1), 30000);
 return () => clearInterval(interval);
 }, []);

 if (!lastUpdated) return null;

 return (
 <div className="flex items-center gap-2 text-xs text-muted-foreground">
 <span>Updated {formatDistanceToNow(lastUpdated, { addSuffix: true })}</span>
 <Button
 variant="ghost" size="sm" onClick={onRefresh}
 disabled={loading}
 className="h-6 w-6 p-0 text-muted-foreground hover:text-muted-foreground" >
 <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
 </Button>
 </div>
 );
}
