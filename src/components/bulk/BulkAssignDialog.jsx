import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { User as UserEntity } from '@/api/entities';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Search, UserPlus, Loader2, Check } from 'lucide-react';
import { isFencedHold, isReleasableHold, holdReasonLabel } from '@/constants/holdReasons';

/**
 * Bulk "Assign to agent…" dialog: searchable agent picker + a pre-commit
 * eligibility preview computed from the selected row snapshots, so the admin
 * sees what the server will actually do (fenced holds are skipped, rows already
 * with the chosen agent are no-ops, releasable holds deliver + deduct) BEFORE
 * confirming. The server's response is still the source of truth — the caller
 * toasts the real counts.
 */
export default function BulkAssignDialog({ open, onOpenChange, selectedRows, busy, onConfirm }) {
  const [search, setSearch] = useState('');
  const [agentId, setAgentId] = useState(null);

  const { data: agents = [], isLoading: agentsLoading } = useQuery({
    queryKey: ['users', 'agents'],
    queryFn: () => UserEntity.getAgents(),
    enabled: open,
    staleTime: 60_000,
  });

  const filteredAgents = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return agents;
    return agents.filter((a) => {
      const name = [a.firstName, a.lastName, a.fullName, a.full_name].filter(Boolean).join(' ').toLowerCase();
      return name.includes(needle) || (a.email || '').toLowerCase().includes(needle);
    });
  }, [agents, search]);

  const preview = useMemo(() => {
    const fenced = selectedRows.filter(isFencedHold);
    const releasable = selectedRows.filter(isReleasableHold);
    const alreadyWithTarget = agentId
      ? selectedRows.filter((r) => !r.quarantinedAt && (r.assigned_agent_id || r.assignedAgentId) === agentId)
      : [];
    const willAssign = selectedRows.length - fenced.length - alreadyWithTarget.length;
    return { fenced, releasable, alreadyWithTarget, willAssign };
  }, [selectedRows, agentId]);

  const agentName = (a) =>
    [a.firstName, a.lastName].filter(Boolean).join(' ') || a.fullName || a.full_name || a.email || 'Agent';

  const handleConfirm = () => {
    if (!agentId || preview.willAssign <= 0) return;
    onConfirm(agentId);
  };

  const handleOpenChange = (next) => {
    if (!next) {
      setSearch('');
      setAgentId(null);
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Assign {selectedRows.length} lead{selectedRows.length === 1 ? '' : 's'}</DialogTitle>
          <DialogDescription>
            The agent is notified once and each lead is delivered to their app. Held leads in the
            selection are released as part of the assignment.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search agents by name or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            autoFocus
          />
        </div>

        <div className="max-h-56 overflow-y-auto rounded-md border border-border divide-y divide-border">
          {agentsLoading ? (
            <div className="flex items-center justify-center gap-2 p-4 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading agents…
            </div>
          ) : filteredAgents.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground text-center">No agents match.</div>
          ) : (
            filteredAgents.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => setAgentId(a.id)}
                className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-muted/50 ${
                  agentId === a.id ? 'bg-primary/5' : ''
                }`}
              >
                <div className="w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold uppercase shrink-0">
                  {agentName(a).charAt(0)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-foreground truncate">{agentName(a)}</div>
                  {a.email && <div className="text-xs text-muted-foreground truncate">{a.email}</div>}
                </div>
                {agentId === a.id && <Check className="w-4 h-4 text-primary shrink-0" />}
              </button>
            ))
          )}
        </div>

        {/* Eligibility preview — what the server will do with this selection. */}
        <div className="text-sm text-muted-foreground space-y-1">
          <div>
            <span className="font-medium text-foreground">{Math.max(preview.willAssign, 0)}</span> will be
            assigned
            {preview.releasable.length > 0 && (
              <> ({preview.releasable.length} released from held — delivery + credit deduction)</>
            )}
            .
          </div>
          {preview.alreadyWithTarget.length > 0 && (
            <div>{preview.alreadyWithTarget.length} already with this agent — skipped, no double charge.</div>
          )}
          {preview.fenced.length > 0 && (
            <div>
              {preview.fenced.length} held lead{preview.fenced.length === 1 ? '' : 's'} will be skipped:{' '}
              {[...new Set(preview.fenced.map((r) => holdReasonLabel(r.quarantineReason)))].join('; ')}.
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!agentId || preview.willAssign <= 0 || busy}>
            {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <UserPlus className="w-4 h-4 mr-2" />}
            Assign {Math.max(preview.willAssign, 0)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
