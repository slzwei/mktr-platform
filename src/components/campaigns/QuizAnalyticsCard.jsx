import { useEffect, useState } from 'react';
import { apiClient } from '@/api/client';
import BarChart3 from 'lucide-react/icons/bar-chart-3';

/**
 * QuizAnalyticsCard — compact campaign quiz-results strip (Designer).
 * Fetches GET /campaigns/:id/quiz-analytics and shows the profile mix +
 * Hot/Warm/Cool lead-score mix over submitted leads. Renders nothing until there
 * is at least one quiz submission (keeps the pre-launch designer uncluttered).
 *
 * This is the submitted-leads view; upper-funnel drop-off (starts/abandonment)
 * is a deferred follow-up that needs a funnel-event log.
 */

const BAND_BADGE = { Hot: '🔥', Warm: '🌤️', Cool: '❄️' };

export default function QuizAnalyticsCard({ campaignId, profiles }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!campaignId) return undefined;
    let mounted = true;
    (async () => {
      try {
        const res = await apiClient.get(`/campaigns/${campaignId}/quiz-analytics`);
        if (mounted) setData(res?.data?.analytics || null);
      } catch {
        /* advisory strip — stay silent on failure */
      }
    })();
    return () => {
      mounted = false;
    };
  }, [campaignId]);

  if (!data || !data.total) return null;

  const titleFor = (id) => {
    const p = (profiles || []).find((x) => x.id === id);
    return (p && p.title) || id;
  };
  const profileEntries = Object.entries(data.byProfile || {}).sort((a, b) => b[1] - a[1]);
  const bandEntries = ['Hot', 'Warm', 'Cool'].filter((b) => data.byBand && data.byBand[b]);

  return (
    <div className="flex items-center gap-3 px-4 py-2 text-xs border-b border-border bg-muted/40 text-muted-foreground overflow-x-auto">
      <span className="flex items-center gap-1.5 font-semibold text-foreground shrink-0">
        <BarChart3 className="w-3.5 h-3.5" />
        {data.total} quiz lead{data.total === 1 ? '' : 's'}
      </span>
      {profileEntries.map(([id, n]) => (
        <span key={id} className="shrink-0">
          {titleFor(id)} <b className="text-foreground">{n}</b>
        </span>
      ))}
      {bandEntries.length > 0 && <span className="shrink-0 opacity-60">·</span>}
      {bandEntries.map((b) => (
        <span key={b} className="shrink-0">
          {BAND_BADGE[b] || ''}
          {b} <b className="text-foreground">{data.byBand[b]}</b>
        </span>
      ))}
    </div>
  );
}
