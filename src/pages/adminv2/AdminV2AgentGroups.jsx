/**
 * Switchboard Agent Groups — named, phone-keyed member collections (the REAL
 * model: name/description/members; no round-robin state, no campaign linkage —
 * those are wishlist proposals). Funded count is computed against the wallet
 * roster so the operator sees which groups can actually take committed leads.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAgentGroups, useAgentOptions, useWallets } from '@/hooks/queries/useAdminV2';
import { createAgentGroup, updateAgentGroup, deleteAgentGroup } from '@/api/adminV2';
import { fmtNumber } from '@/lib/adminV2/format';
import { Chip, PageHeader, Skeleton, ErrorState, EmptyState, StateRow } from '@/components/adminv2/primitives';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from '@/components/ui/alert-dialog';

function GroupEditor({ group, onClose }) {
  const isNew = !group?.id;
  const [name, setName] = useState(group?.name || '');
  const [description, setDescription] = useState(group?.description || '');
  const [selected, setSelected] = useState(() => new Set((group?.members || []).map((m) => m.phone).filter(Boolean)));
  const agents = useAgentOptions(true);
  const queryClient = useQueryClient();

  // The service REPLACES the member list on update, so the payload must be
  // built from the EXISTING member snapshots first (name/email/lyfeId survive
  // the round-trip even when the member is outside the active-roster picker),
  // falling back to roster rows only for new additions.
  const existingByPhone = useMemo(
    () => new Map((group?.members || []).filter((m) => m.phone).map((m) => [m.phone, m])),
    [group]
  );

  const save = useMutation({
    mutationFn: () => {
      const rosterByPhone = new Map((agents.data || []).map((a) => [a.phone, a]));
      const members = [...selected].map((phone) => {
        const prev = existingByPhone.get(phone);
        if (prev) return { phone, name: prev.name || null, email: prev.email || null, lyfeId: prev.lyfeId || null };
        const a = rosterByPhone.get(phone);
        return { phone, name: a?.name || '', email: a?.email || null };
      });
      const payload = { name: name.trim(), description: description.trim() || null, agents: members };
      return isNew ? createAgentGroup(payload) : updateAgentGroup(group.id, payload);
    },
    onSuccess: () => {
      toast.success(isNew ? 'Group created' : 'Group updated');
      queryClient.invalidateQueries({ queryKey: ['adminV2', 'agentGroups'] });
      onClose();
    },
    onError: (e) => toast.error(e?.message || 'Save failed'),
  });

  const togglePhone = (phone) => {
    const next = new Set(selected);
    if (next.has(phone)) next.delete(phone);
    else next.add(phone);
    setSelected(next);
  };

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" className="admin-v2" style={{ width: 432, maxWidth: '90vw', padding: 0, background: 'var(--surface)', color: 'var(--ink)', borderLeft: '1px solid var(--line)', display: 'flex', flexDirection: 'column' }}>
        <SheetHeader style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)' }}>
          <SheetTitle style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink)', fontFamily: 'var(--font-ui)', textAlign: 'left' }}>
            {isNew ? 'New agent group' : `Edit ${group.name}`}
          </SheetTitle>
        </SheetHeader>
        <div style={{ padding: 16, display: 'grid', gap: 14, overflowY: 'auto', flex: 1 }}>
          <label style={{ display: 'grid', gap: 6 }}>
            <span className="av2-microcaps">Name</span>
            <input className="av2-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Draw Campaigns Pool" />
          </label>
          <label style={{ display: 'grid', gap: 6 }}>
            <span className="av2-microcaps">Description</span>
            <input className="av2-input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this group is for" />
          </label>
          <div>
            <div className="av2-microcaps" style={{ marginBottom: 6 }}>Members · {selected.size}</div>
            <div className="av2-card" style={{ boxShadow: 'none', maxHeight: 320, overflowY: 'auto' }}>
              {agents.isLoading && <div style={{ padding: 12 }}><Skeleton height={80} /></div>}
              {agents.isError && <div className="av2-caption" style={{ padding: 12, color: 'var(--bad)' }}>Agent roster failed to load — saving is disabled so members can’t be silently dropped.</div>}
              {/* Existing members outside the active roster (inactive/legacy) — kept unless removed. */}
              {[...existingByPhone.values()].filter((m) => !(agents.data || []).some((a) => a.phone === m.phone)).map((m) => {
                const on = selected.has(m.phone);
                return (
                  <button
                    key={`kept-${m.phone}`}
                    type="button"
                    onClick={() => togglePhone(m.phone)}
                    aria-pressed={on}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
                      padding: '8px 12px', border: 'none', borderBottom: '1px solid var(--line)',
                      background: on ? 'var(--accent-soft)' : 'transparent', cursor: 'pointer',
                      fontFamily: 'var(--font-ui)', color: 'var(--ink)',
                    }}
                  >
                    <span style={{ fontSize: 12.5, fontWeight: 600, flex: 1 }}>{m.name || m.phone}</span>
                    <Chip tone="warn">not in roster</Chip>
                    <span className="av2-mono" style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>{m.phone}</span>
                    {on && <span aria-hidden="true" style={{ color: 'var(--accent-text)', fontWeight: 800 }}>✓</span>}
                  </button>
                );
              })}
              {(agents.data || []).filter((a) => a.phone).map((a) => {
                const on = selected.has(a.phone);
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => togglePhone(a.phone)}
                    aria-pressed={on}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
                      padding: '8px 12px', border: 'none', borderBottom: '1px solid var(--line)',
                      background: on ? 'var(--accent-soft)' : 'transparent', cursor: 'pointer',
                      fontFamily: 'var(--font-ui)', color: 'var(--ink)',
                    }}
                  >
                    <span style={{ fontSize: 12.5, fontWeight: 600, flex: 1 }}>{a.name}</span>
                    <span className="av2-mono" style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>{a.phone}</span>
                    {on && <span aria-hidden="true" style={{ color: 'var(--accent-text)', fontWeight: 800 }}>✓</span>}
                  </button>
                );
              })}
            </div>
            <div className="av2-caption" style={{ marginTop: 6 }}>Members are stored by phone; agents without a phone can’t join a group.</div>
          </div>
        </div>
        <div style={{ padding: 16, borderTop: '1px solid var(--line)', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button type="button" className="av2-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="av2-btn av2-btn--primary" disabled={!name.trim() || save.isPending || agents.isError || agents.isLoading} onClick={() => save.mutate()}>
            {save.isPending ? 'Saving…' : isNew ? 'Create group' : 'Save changes'}
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default function AdminV2AgentGroups() {
  const groups = useAgentGroups();
  const wallets = useWallets();
  const [editor, setEditor] = useState(null); // null | {} (new) | group
  const [confirmDelete, setConfirmDelete] = useState(null);
  const queryClient = useQueryClient();

  const fundedIds = useMemo(
    () => new Set((wallets.data || []).filter((w) => w.walletBalanceCents > 0).map((w) => w.id)),
    [wallets.data]
  );

  const remove = useMutation({
    mutationFn: (id) => deleteAgentGroup(id),
    onSuccess: () => {
      toast.success('Group deleted');
      queryClient.invalidateQueries({ queryKey: ['adminV2', 'agentGroups'] });
      setConfirmDelete(null);
    },
    onError: (e) => { toast.error(e?.message || 'Delete failed'); setConfirmDelete(null); },
  });

  const rows = groups.data || [];

  return (
    <div>
      <PageHeader title="Agent Groups" meta={`${fmtNumber(rows.length)} GROUPS · NAMED MEMBER COLLECTIONS`}>
        <button type="button" className="av2-btn av2-btn--primary" onClick={() => setEditor({})}>+ New group</button>
      </PageHeader>

      <div className="av2-card" style={{ overflow: 'hidden' }} role="table" aria-label="Agent groups">
        <div className="av2-thead" role="row">
          <span className="av2-microcaps" role="columnheader" style={{ flex: 1.2 }}>Group</span>
          <span className="av2-microcaps" role="columnheader" style={{ flex: 1.6 }}>Description</span>
          <span className="av2-microcaps" role="columnheader" style={{ width: 90, flex: 'none', textAlign: 'right' }}>Members</span>
          <span className="av2-microcaps" role="columnheader" style={{ width: 110, flex: 'none', textAlign: 'right' }}>Funded</span>
          <span className="av2-microcaps" role="columnheader" style={{ width: 130, flex: 'none', textAlign: 'right' }}>Actions</span>
        </div>

        {groups.isLoading && [0, 1, 2].map((i) => (
          <div key={i} className="av2-row" role="row" style={{ cursor: 'default' }}><span role="cell" style={{ flex: 1 }}><Skeleton height={32} /></span></div>
        ))}
        {groups.isError && <StateRow><ErrorState error={groups.error} onRetry={groups.refetch} /></StateRow>}
        {!groups.isLoading && !groups.isError && rows.length === 0 && (
          <StateRow><EmptyState title="No groups yet" hint="Groups are reusable agent pickers — create one to speed up assignment." action={<button type="button" className="av2-btn av2-btn--sm" onClick={() => setEditor({})}>New group</button>} /></StateRow>
        )}

        {rows.map((g) => {
          const members = g.members || [];
          const funded = members.filter((m) => m.userId && fundedIds.has(m.userId)).length;
          return (
            <div key={g.id} className="av2-row" role="row" style={{ cursor: 'default' }}>
              <span role="cell" style={{ flex: 1.2, fontSize: 13, fontWeight: 700 }}>{g.name}</span>
              <span role="cell" style={{ flex: 1.6, fontSize: 12, color: 'var(--ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.description || '—'}</span>
              <span role="cell" className="av2-mono" style={{ width: 90, flex: 'none', fontSize: 12, fontWeight: 600, textAlign: 'right' }}>{members.length}</span>
              <span role="cell" style={{ width: 110, flex: 'none', textAlign: 'right' }}>
                {wallets.isLoading
                  ? <span className="av2-mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>…</span>
                  : wallets.isError
                    ? <span className="av2-mono" title="Wallet data failed to load" style={{ fontSize: 11, color: 'var(--ink-3)' }}>—</span>
                    : <Chip tone={funded < members.length && members.length > 0 ? 'warn' : 'ok'}>{funded}/{members.length} funded</Chip>}
              </span>
              <span role="cell" style={{ width: 130, flex: 'none', display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                <button type="button" className="av2-btn av2-btn--sm" onClick={() => setEditor(g)}>Edit</button>
                <button type="button" className="av2-btn av2-btn--sm" style={{ borderColor: 'var(--bad)', color: 'var(--bad)' }} onClick={() => setConfirmDelete(g)}>Delete</button>
              </span>
            </div>
          );
        })}
      </div>

      <div className="av2-caption" style={{ marginTop: 10 }}>
        “Funded” counts members holding wallet credits — external agents only in v1. Round-robin routing itself is driven by commitments, not group membership.
      </div>

      {editor !== null && <GroupEditor group={editor.id ? editor : null} onClose={() => setEditor(null)} />}

      <AlertDialog open={!!confirmDelete} onOpenChange={(open) => { if (!open) setConfirmDelete(null); }}>
        <AlertDialogContent className="admin-v2" style={{ background: 'var(--surface)', color: 'var(--ink)', border: '1px solid var(--line)' }}>
          <AlertDialogHeader>
            <AlertDialogTitle style={{ color: 'var(--ink)' }}>Delete “{confirmDelete?.name}”?</AlertDialogTitle>
            <AlertDialogDescription style={{ color: 'var(--ink-2)' }}>
              The group and its member list are removed. Agents themselves are untouched.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); remove.mutate(confirmDelete.id); }}
              disabled={remove.isPending}
              style={{ background: 'var(--bad)', color: '#fff' }}
            >
              {remove.isPending ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
