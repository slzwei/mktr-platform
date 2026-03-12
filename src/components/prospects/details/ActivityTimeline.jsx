import { format } from "date-fns";
import { Clock, User, FileText, CheckCircle2, Edit2 } from "lucide-react";

export default function ActivityTimeline({ details, prospect, campaign }) {
  return (
    <section>
      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Activity History</h3>
      <div className="relative pl-6 space-y-6">
        <div className="absolute left-[11px] top-2 bottom-4 w-px bg-gray-200 dark:bg-gray-600" />

        {(!details?.activities || details.activities.length === 0) ? (
          <div className="relative flex items-center gap-3">
            <div className="h-6 w-6 rounded-full bg-gray-100 dark:bg-gray-700 border-2 border-white dark:border-gray-800 ring-1 ring-gray-200 dark:ring-gray-600 flex items-center justify-center z-10">
              <Clock className="w-3 h-3 text-gray-400 dark:text-gray-500" />
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400">No activity recorded yet.</p>
          </div>
        ) : (
          details.activities.map((a, idx) => {
            const when = a.createdAt ? format(new Date(a.createdAt), 'MMM d, h:mm a') : '';
            let text = a.description || a.type;
            let icon = <FileText className="w-3 h-3 text-gray-500 dark:text-gray-400" />;

            if (a.type === 'assigned') {
              text = "Assigned to agent";
              icon = <User className="w-3 h-3 text-purple-600" />;
            } else if (a.type === 'created') {
              // Use backend description if it's the new rich format, otherwise fallback
              if (a.description && a.description.includes('Prospect signed up')) {
                text = a.description;
              } else {
                text = "Prospect created";
              }
              icon = <CheckCircle2 className="w-3 h-3 text-emerald-600" />;
            } else if (a.type === 'lead_status_updated') {
              text = `Status updated to ${a.description || 'new status'}`;
              icon = <Edit2 className="w-3 h-3 text-blue-600" />;
            }

            return (
              <div key={idx} className="relative group">
                <div className="flex items-start gap-4">
                  <div className="absolute -left-[24px] mt-0.5">
                    <div className="h-6 w-6 rounded-full bg-white dark:bg-gray-800 border-2 border-gray-100 dark:border-gray-700 ring-1 ring-gray-200 dark:ring-gray-600 flex items-center justify-center z-10 shadow-sm">
                      {icon}
                    </div>
                  </div>
                  <div className="flex-1 bg-gray-50/50 dark:bg-gray-800/50 rounded-lg p-3 border border-gray-100 dark:border-gray-700">
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{text}</p>
                    {a.type === 'assigned' && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{a.description || 'System assignment'}</p>}
                    {a.type === 'created' && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">via {prospect.source}, campaign: {campaign?.name}</p>}
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">{when}</p>
                  </div>
                </div>
              </div>
            );
          })
        )}

        {/* Origin Marker */}
        <div className="relative flex items-center gap-4">
          <div className="absolute -left-[24px]">
            <div className="h-6 w-6 rounded-full bg-gray-100 dark:bg-gray-700 border-2 border-white dark:border-gray-800 ring-1 ring-gray-200 dark:ring-gray-600 flex items-center justify-center z-10">
              <div className="w-1.5 h-1.5 rounded-full bg-gray-400 dark:bg-gray-500" />
            </div>
          </div>
          <div>
            <span className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider">Start of History</span>
          </div>
        </div>

      </div>
    </section>
  );
}
