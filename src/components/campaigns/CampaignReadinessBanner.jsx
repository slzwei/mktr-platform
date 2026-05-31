import { useEffect, useState } from 'react';
import { apiClient } from '@/api/client';
import AlertTriangle from 'lucide-react/icons/alert-triangle';
import CheckCircle from 'lucide-react/icons/check-circle';

/**
 * CampaignReadinessBanner — pre-launch "will this deliver leads?" strip shown in
 * the campaign Designer. Fetches GET /campaigns/:id/readiness and surfaces the
 * critical gaps (empty agent pool → System Agent → lost leads; webhook disabled)
 * plus warnings (phone-less agents, quiz not enabled) before the operator shares
 * the link / spends on ads. Advisory only — never blocks editing.
 *
 * Uses apiClient.get directly (the codebase allows ad-hoc calls) to avoid
 * touching the shared API client.
 */
export default function CampaignReadinessBanner({ campaignId }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!campaignId) return undefined;
    let mounted = true;
    (async () => {
      try {
        const res = await apiClient.get(`/campaigns/${campaignId}/readiness`);
        if (mounted) setData(res?.data?.readiness || null);
      } catch {
        /* advisory banner — stay silent on fetch failure */
      }
    })();
    return () => {
      mounted = false;
    };
  }, [campaignId]);

  // Nothing to show until loaded, or when readiness doesn't apply (e.g. PHV).
  if (!data || data.applicable === false) return null;

  const issues = data.issues || [];
  const criticals = issues.filter((i) => i.level === 'critical');
  const warnings = issues.filter((i) => i.level === 'warning');
  const infos = issues.filter((i) => i.level === 'info');

  // All-clear (no criticals/warnings) → compact green confirmation.
  if (criticals.length === 0 && warnings.length === 0) {
    return (
      <div className="flex items-center gap-2 px-4 py-2 text-sm border-b bg-success/10 text-success border-success/20">
        <CheckCircle className="w-4 h-4 shrink-0" />
        <span>
          Ready to launch — {data.assignableAgents} agent{data.assignableAgents === 1 ? '' : 's'} in the round-robin pool.
          {infos.length > 0 ? ` ${infos[0].message}` : ''}
        </span>
      </div>
    );
  }

  const tone = criticals.length > 0 ? 'critical' : 'warning';
  const toneClass =
    tone === 'critical'
      ? 'bg-destructive/10 text-destructive border-destructive/20'
      : 'bg-warning/10 text-warning border-warning/30';
  const Icon = AlertTriangle;
  const shown = [...criticals, ...warnings, ...infos];

  return (
    <div className={`px-4 py-2 text-sm border-b ${toneClass}`}>
      <div className="flex items-start gap-2">
        <Icon className="w-4 h-4 shrink-0 mt-0.5" />
        <div className="space-y-0.5">
          <p className="font-semibold">
            {criticals.length > 0 ? "Not ready — leads won't be delivered" : 'Launch warnings'}
          </p>
          {shown.map((i, idx) => (
            <p key={i.code || idx} className="opacity-90">
              {i.message}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}
