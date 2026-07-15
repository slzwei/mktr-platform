/**
 * Switchboard Users — back-office staff (Admin is the only real staff role
 * today; 'ops' tiers are wishlist). Invited state derives from the invitation
 * token + never-logged-in; last active maps from users.lastLogin.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiClient } from '@/api/client';
import { fmtNumber, fmtRelative, fmtDate } from '@/lib/adminV2/format';
import { Chip, PageHeader, Skeleton, ErrorState, EmptyState, StateRow } from '@/components/adminv2/primitives';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';

const fetchStaff = async () => {
  const resp = await apiClient.get('/users?role=admin&limit=100');
  const data = resp?.data ?? {};
  return { rows: data.users || [], total: data.pagination?.totalItems ?? (data.users || []).length };
};

function statusOf(u) {
  if (!u.isActive) return { label: 'Inactive', tone: 'warn' };
  if (!u.lastLogin && (u.invitationPending || u.invitationToken)) return { label: 'Invited', tone: 'accent' };
  return { label: 'Active', tone: 'ok' };
}

function InviteDialog({ onClose }) {
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const queryClient = useQueryClient();
  const invite = useMutation({
    mutationFn: () => apiClient.post('/users/invite', { email: email.trim(), full_name: fullName.trim(), role: 'admin' }),
    onSuccess: () => {
      toast.success(`Invitation sent to ${email.trim()}`);
      queryClient.invalidateQueries({ queryKey: ['adminV2', 'staff'] });
      onClose();
    },
    onError: (e) => toast.error(e?.message || 'Invite failed'),
  });
  const valid = /.+@.+\..+/.test(email.trim()) && fullName.trim().length > 0;

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !invite.isPending) onClose(); }}>
      <DialogContent className="admin-v2" style={{ background: 'var(--surface)', color: 'var(--ink)', border: '1px solid var(--line)', maxWidth: 440 }}>
        <DialogHeader>
          <DialogTitle style={{ color: 'var(--ink)', fontFamily: 'var(--font-ui)', fontSize: 15, fontWeight: 800, textAlign: 'left' }}>Invite an admin</DialogTitle>
          <DialogDescription style={{ color: 'var(--ink-2)', fontSize: 11.5, textAlign: 'left' }}>
            Admin is the only back-office role today — the invite email carries a sign-in link.
          </DialogDescription>
        </DialogHeader>
        <label style={{ display: 'grid', gap: 6, marginBottom: 12 }}>
          <span className="av2-microcaps">Full name</span>
          <input className="av2-input" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="e.g. Serene Koh" />
        </label>
        <label style={{ display: 'grid', gap: 6, marginBottom: 14 }}>
          <span className="av2-microcaps">Email</span>
          <input className="av2-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@mktr.sg" />
        </label>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button type="button" className="av2-btn" disabled={invite.isPending} onClick={onClose}>Cancel</button>
          <button type="button" className="av2-btn av2-btn--primary" disabled={!valid || invite.isPending} onClick={() => invite.mutate()}>
            {invite.isPending ? 'Sending…' : 'Send invite'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function AdminV2Users() {
  const staff = useQuery({ queryKey: ['adminV2', 'staff'], queryFn: fetchStaff, staleTime: 30_000 });
  const [inviting, setInviting] = useState(false);
  const rows = staff.data?.rows || [];

  return (
    <div>
      <PageHeader title="Users" meta={`${fmtNumber(staff.data?.total ?? 0)} BACK-OFFICE ADMINS${(staff.data?.total ?? 0) > (staff.data?.rows || []).length && (staff.data?.rows || []).length > 0 ? ` · SHOWING FIRST ${fmtNumber((staff.data?.rows || []).length)}` : ''}`}>
        <button type="button" className="av2-btn av2-btn--primary" onClick={() => setInviting(true)}>+ Invite admin</button>
      </PageHeader>

      <div className="av2-card" style={{ overflow: 'hidden' }} role="table" aria-label="Staff users">
        <div className="av2-thead" role="row">
          <span className="av2-microcaps" role="columnheader" style={{ flex: 1.4 }}>User</span>
          <span className="av2-microcaps" role="columnheader" style={{ width: 90, flex: 'none' }}>Role</span>
          <span className="av2-microcaps" role="columnheader" style={{ width: 100, flex: 'none' }}>Status</span>
          <span className="av2-microcaps" role="columnheader" style={{ width: 110, flex: 'none', textAlign: 'right' }}>Last active</span>
          <span className="av2-microcaps" role="columnheader" style={{ width: 110, flex: 'none', textAlign: 'right' }}>Joined</span>
        </div>

        {staff.isLoading && [0, 1, 2].map((i) => (
          <div key={i} className="av2-row" role="row" style={{ cursor: 'default' }}><span role="cell" style={{ flex: 1 }}><Skeleton height={30} /></span></div>
        ))}
        {staff.isError && <StateRow><ErrorState error={staff.error} onRetry={staff.refetch} /></StateRow>}
        {!staff.isLoading && !staff.isError && rows.length === 0 && (
          <StateRow><EmptyState title="No staff users" hint="Invite the first admin to share the console." /></StateRow>
        )}

        {rows.map((u) => {
          const st = statusOf(u);
          const name = u.fullName || `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email;
          return (
            <div key={u.id} className="av2-row" style={{ cursor: 'default' }} role="row">
              <span role="cell" style={{ flex: 1.4, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 13, fontWeight: 700 }}>{name}</span>
                <span className="av2-mono" style={{ display: 'block', fontSize: 10, color: 'var(--ink-3)' }}>{u.email}</span>
              </span>
              <span role="cell" style={{ width: 90, flex: 'none' }}><Chip tone="accent">Admin</Chip></span>
              <span role="cell" style={{ width: 100, flex: 'none' }}><Chip tone={st.tone}>{st.label}</Chip></span>
              <span role="cell" className="av2-mono" style={{ width: 110, flex: 'none', fontSize: 10.5, color: 'var(--ink-3)', textAlign: 'right' }}>
                {u.lastLogin ? fmtRelative(u.lastLogin) : st.label === 'Invited' ? 'never' : '—'}
              </span>
              <span role="cell" className="av2-mono" style={{ width: 110, flex: 'none', fontSize: 10.5, color: 'var(--ink-3)', textAlign: 'right' }}>{fmtDate(u.createdAt)}</span>
            </div>
          );
        })}
      </div>

      {inviting && <InviteDialog onClose={() => setInviting(false)} />}
    </div>
  );
}
