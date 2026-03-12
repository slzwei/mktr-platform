import { Badge } from "@/components/ui/badge";
import { Tag } from "lucide-react";

export default function CampaignInfoCard({ campaign, prospect }) {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 uppercase tracking-wider flex items-center gap-2">
        <Tag className="w-4 h-4 text-gray-500 dark:text-gray-400" />
        Campaign
      </h3>
      <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-600 shadow-sm p-4 space-y-3">
        <div>
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Campaign Name</p>
          <Badge variant="outline" className="font-normal text-gray-900 dark:text-gray-100 border-gray-300 dark:border-gray-600">
            {campaign?.name || 'Unknown Campaign'}
          </Badge>
        </div>
        <div>
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Lead Source</p>
          <div className="inline-flex items-center px-2 py-1 rounded bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs font-medium uppercase tracking-wide">
            {prospect.source || 'Unknown'}
          </div>
        </div>
        {prospect.campaigns_subscribed && prospect.campaigns_subscribed.length > 1 && (
          <div>
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Subscriptions</p>
            <div className="flex flex-wrap gap-1">
              {prospect.campaigns_subscribed.map((cid) => (
                <span key={cid} className="text-[10px] px-1.5 py-0.5 bg-gray-50 dark:bg-gray-800/50 border dark:border-gray-600 rounded text-gray-600 dark:text-gray-400">{cid}</span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
