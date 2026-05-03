import { Skeleton } from"@/components/ui/skeleton";

export function TableSkeleton({ rows = 5, columns = 4 }) {
 return (
 <div className="space-y-3">
 <div className="flex gap-4">
 {Array.from({ length: columns }).map((_, i) => (
 <Skeleton key={i} className="h-8 flex-1"/>
 ))}
 </div>
 {Array.from({ length: rows }).map((_, i) => (
 <div key={i} className="flex gap-4">
 {Array.from({ length: columns }).map((_, j) => (
 <Skeleton key={j} className="h-6 flex-1"/>
 ))}
 </div>
 ))}
 </div>
 );
}
