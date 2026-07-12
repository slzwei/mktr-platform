import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import Plus from 'lucide-react/icons/plus';
import Pencil from 'lucide-react/icons/pencil';
import { redeemOpsApi } from '@/api/redeemOps';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CADENCES_ENABLED } from '@/components/redeemops/cadence';
import { CHANNEL_LABEL } from '@/components/redeemops/cadenceBuilder';

/**
 * Settings → Cadences: the list. Creating and editing happen on the dedicated
 * full-page editor (/redeem-ops/cadences/new, /redeem-ops/cadences/:id/edit) —
 * a dialog was too cramped for a step editor.
 */
export default function CadenceStudio() {
  const queryClient = useQueryClient();

  const listQuery = useQuery({
    queryKey: ['redeem-ops', 'cadences'],
    queryFn: () => redeemOpsApi.listCadences(),
    enabled: CADENCES_ENABLED,
  });

  const retireMutation = useMutation({
    mutationFn: (id) => redeemOpsApi.retireCadence(id),
    onSuccess: () => {
      toast.success('Cadence retired — no new enrollments; running ones finish normally');
      queryClient.invalidateQueries({ queryKey: ['redeem-ops', 'cadences'] });
    },
    onError: (err) => toast.error('Could not retire', { description: err.message }),
  });

  if (!CADENCES_ENABLED) return null;

  const cadences = listQuery.data || [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0 gap-3">
        <div>
          <CardTitle className="text-base">Cadences</CardTitle>
          <CardDescription>
            The outreach sequences your team can enroll businesses into. Editing creates a new
            version — businesses mid-cadence finish on the version they started.
          </CardDescription>
        </div>
        <Button size="sm" asChild>
          <Link to="/redeem-ops/cadences/new">
            <Plus className="w-4 h-4 mr-1.5" aria-hidden="true" /> New cadence
          </Link>
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {cadences.map((c) => (
          <div key={c.id} className="flex items-center gap-3 rounded-xl border border-border px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold m-0">
                {c.name} <span className="font-normal" style={{ color: 'var(--ro-text-3)' }}>v{c.version}</span>
              </p>
              <p className="text-xs m-0 mt-0.5 truncate" style={{ color: 'var(--ro-text-2)' }}>
                {(c.steps || []).length} steps — {(c.steps || []).map((s) => CHANNEL_LABEL[s.channel] || s.channel).join(' → ')}
              </p>
            </div>
            <Button size="sm" variant="ghost" aria-label={`Edit ${c.name}`} asChild>
              <Link to={`/redeem-ops/cadences/${c.id}/edit`}>
                <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
              </Link>
            </Button>
            <Button
              size="sm" variant="ghost"
              disabled={retireMutation.isPending}
              onClick={() => retireMutation.mutate(c.id)}
            >
              Retire
            </Button>
          </div>
        ))}
        {!listQuery.isLoading && cadences.length === 0 && (
          <p className="text-sm text-center py-6 m-0" style={{ color: 'var(--ro-text-2)' }}>
            No cadences yet — create the first sequence your team will run.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
