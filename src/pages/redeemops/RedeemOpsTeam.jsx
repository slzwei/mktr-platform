import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { redeemOpsApi } from '@/api/redeemOps';
import { useAuthStore } from '@/stores/authStore';
import { hasCapability } from '@/lib/redeemOpsPermissions';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import UserPlus from 'lucide-react/icons/user-plus';
import Pencil from 'lucide-react/icons/pencil';
import { RoMobileCard, RoTag, RoAvatar } from '@/components/redeemops/ui';

const TEAM_KEY = ['redeem-ops', 'team'];

export default function RedeemOpsTeam() {
  const currentUser = useAuthStore((s) => s.user);
  const canManage = hasCapability(currentUser, 'team.manage_access');
  const queryClient = useQueryClient();

  const [inviteOpen, setInviteOpen] = useState(false);
  const [invite, setInvite] = useState({ email: '', fullName: '', redeemOpsRole: '' });

  const teamQuery = useQuery({ queryKey: TEAM_KEY, queryFn: redeemOpsApi.getTeam });
  const constantsQuery = useQuery({
    queryKey: ['redeem-ops', 'constants'],
    queryFn: redeemOpsApi.getConstants,
    staleTime: Infinity,
  });

  const subRoles = constantsQuery.data?.subRoles || [];
  const subRoleLabels = constantsQuery.data?.subRoleLabels || {};

  const inviteMutation = useMutation({
    mutationFn: redeemOpsApi.inviteTeamMember,
    onSuccess: () => {
      toast.success('Invitation sent', { description: 'They will receive an email with an accept link.' });
      setInviteOpen(false);
      setInvite({ email: '', fullName: '', redeemOpsRole: '' });
      queryClient.invalidateQueries({ queryKey: TEAM_KEY });
    },
    onError: (err) => toast.error('Invite failed', { description: err.message }),
  });

  const roleMutation = useMutation({
    mutationFn: ({ userId, redeemOpsRole }) => redeemOpsApi.setTeamRole(userId, redeemOpsRole),
    onSuccess: () => {
      toast.success('Role updated');
      queryClient.invalidateQueries({ queryKey: TEAM_KEY });
    },
    onError: (err) => toast.error('Role change failed', { description: err.message }),
  });

  const [editTarget, setEditTarget] = useState(null); // { id, fullName, phone }
  const memberMutation = useMutation({
    mutationFn: ({ userId, body }) => redeemOpsApi.updateTeamMember(userId, body),
    onSuccess: (_data, vars) => {
      toast.success(
        vars.body.isActive === false
          ? 'Account deactivated — they can no longer sign in'
          : vars.body.isActive === true
            ? 'Account reactivated'
            : 'Member updated'
      );
      setEditTarget(null);
      queryClient.invalidateQueries({ queryKey: TEAM_KEY });
    },
    onError: (err) => toast.error('Update failed', { description: err.message }),
  });

  const team = teamQuery.data || [];

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="ro-title">Team &amp; access</h1>
          <p className="ro-sub">
            Redeem Ops staff and their sub-roles. Admins are implicit super admins.
          </p>
        </div>
        {canManage && (
          <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
            <DialogTrigger asChild>
              <Button>
                <UserPlus className="w-4 h-4 mr-1.5" aria-hidden="true" />
                Invite staff
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Invite Redeem Ops staff</DialogTitle>
                <DialogDescription>
                  They will receive an email invitation and set their password via the accept link.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="space-y-1.5">
                  <Label htmlFor="ro-invite-name">Full name</Label>
                  <Input
                    id="ro-invite-name"
                    value={invite.fullName}
                    onChange={(e) => setInvite((v) => ({ ...v, fullName: e.target.value }))}
                    placeholder="Sarah Tan"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ro-invite-email">Email</Label>
                  <Input
                    id="ro-invite-email"
                    type="email"
                    value={invite.email}
                    onChange={(e) => setInvite((v) => ({ ...v, email: e.target.value }))}
                    placeholder="sarah@mktr.sg"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Sub-role</Label>
                  <Select
                    value={invite.redeemOpsRole}
                    onValueChange={(redeemOpsRole) => setInvite((v) => ({ ...v, redeemOpsRole }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select a sub-role" />
                    </SelectTrigger>
                    <SelectContent>
                      {subRoles.map((r) => (
                        <SelectItem key={r} value={r}>{subRoleLabels[r] || r}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button
                  onClick={() => inviteMutation.mutate(invite)}
                  disabled={
                    inviteMutation.isPending ||
                    !invite.email || !invite.fullName || !invite.redeemOpsRole
                  }
                >
                  {inviteMutation.isPending ? 'Sending…' : 'Send invite'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Members</CardTitle>
          <CardDescription>
            {teamQuery.isLoading ? 'Loading…' : `${team.length} member${team.length === 1 ? '' : 's'}`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="md:hidden -mx-6">
            {team.map((member) => (
              <RoMobileCard key={member.id} className="px-6">
                <span className="flex items-center gap-2.5 min-w-0">
                  <RoAvatar name={member.fullName || member.email} size={34} />
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-[14px] truncate">
                      {member.fullName || [member.firstName, member.lastName].filter(Boolean).join(' ') || '—'}
                    </span>
                    <span className="block text-xs truncate" style={{ color: 'var(--ro-text-2)' }}>{member.email}</span>
                  </span>
                  <RoTag tone={member.isActive ? 'active' : 'inactive'} size="sm">
                    {member.isActive ? 'Active' : 'Deactivated'}
                  </RoTag>
                </span>
                {canManage && member.id !== currentUser?.id ? (
                  <span className="flex items-center gap-2 mt-2.5">
                    <Select
                      value={member.redeemOpsRole || ''}
                      onValueChange={(redeemOpsRole) => roleMutation.mutate({ userId: member.id, redeemOpsRole })}
                    >
                      <SelectTrigger className="flex-1 h-9"><SelectValue placeholder="No sub-role" /></SelectTrigger>
                      <SelectContent>
                        {subRoles.map((r) => (
                          <SelectItem key={r} value={r}>{subRoleLabels[r] || r}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm" variant="ghost" aria-label="Edit member"
                      onClick={() => setEditTarget({
                        id: member.id,
                        fullName: member.fullName || [member.firstName, member.lastName].filter(Boolean).join(' '),
                        phone: member.phone || '',
                      })}
                    >
                      <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                    </Button>
                    <Button
                      size="sm" variant="ghost"
                      className={member.isActive ? 'text-destructive hover:text-destructive' : undefined}
                      disabled={memberMutation.isPending}
                      onClick={() => {
                        const name = member.fullName || member.email;
                        const ok = member.isActive
                          ? window.confirm(`Deactivate ${name}? They will be signed out and unable to log in until reactivated.`)
                          : true;
                        if (ok) memberMutation.mutate({ userId: member.id, body: { isActive: !member.isActive } });
                      }}
                    >
                      {member.isActive ? 'Deactivate' : 'Reactivate'}
                    </Button>
                  </span>
                ) : (
                  <span className="block mt-2">
                    <RoTag tone="primary" size="sm">
                      {subRoleLabels[member.redeemOpsRole] || member.redeemOpsRole || '—'}
                    </RoTag>
                  </span>
                )}
              </RoMobileCard>
            ))}
            {!teamQuery.isLoading && team.length === 0 && (
              <p className="text-sm text-center py-8 m-0" style={{ color: 'var(--ro-text-2)' }}>
                No Redeem Ops staff yet{canManage ? ' — send the first invite.' : '.'}
              </p>
            )}
          </div>
          <div className="hidden md:block overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Sub-role</TableHead>
                  <TableHead>Status</TableHead>
                  {canManage && <TableHead className="text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {team.map((member) => (
                  <TableRow key={member.id}>
                    <TableCell className="font-medium">
                      <span className="flex items-center gap-2.5">
                        <RoAvatar name={member.fullName || member.email} size={30} />
                        {member.fullName || [member.firstName, member.lastName].filter(Boolean).join(' ') || '—'}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{member.email}</TableCell>
                    <TableCell>
                      {canManage && member.id !== currentUser?.id ? (
                        <Select
                          value={member.redeemOpsRole || ''}
                          onValueChange={(redeemOpsRole) =>
                            roleMutation.mutate({ userId: member.id, redeemOpsRole })
                          }
                        >
                          <SelectTrigger className="w-56">
                            <SelectValue placeholder="No sub-role" />
                          </SelectTrigger>
                          <SelectContent>
                            {subRoles.map((r) => (
                              <SelectItem key={r} value={r}>{subRoleLabels[r] || r}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <RoTag tone="primary" size="sm">
                          {subRoleLabels[member.redeemOpsRole] || member.redeemOpsRole || '—'}
                        </RoTag>
                      )}
                    </TableCell>
                    <TableCell>
                      <RoTag tone={member.isActive ? 'active' : 'inactive'} size="sm">
                        {member.isActive ? 'Active' : 'Deactivated'}
                      </RoTag>
                    </TableCell>
                    {canManage && (
                      <TableCell className="text-right whitespace-nowrap">
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label="Edit member"
                          onClick={() => setEditTarget({
                            id: member.id,
                            fullName: member.fullName || [member.firstName, member.lastName].filter(Boolean).join(' '),
                            phone: member.phone || '',
                          })}
                        >
                          <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                        </Button>
                        {member.id !== currentUser?.id && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className={member.isActive ? 'text-destructive hover:text-destructive' : undefined}
                            disabled={memberMutation.isPending}
                            onClick={() => {
                              const name = member.fullName || member.email;
                              const ok = member.isActive
                                ? window.confirm(`Deactivate ${name}? They will be signed out and unable to log in until reactivated.`)
                                : true;
                              if (ok) memberMutation.mutate({ userId: member.id, body: { isActive: !member.isActive } });
                            }}
                          >
                            {member.isActive ? 'Deactivate' : 'Reactivate'}
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
                {!teamQuery.isLoading && team.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={canManage ? 5 : 4} className="text-center text-muted-foreground py-8">
                      No Redeem Ops staff yet{canManage ? ' — send the first invite.' : '.'}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!editTarget} onOpenChange={(open) => { if (!open) setEditTarget(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit member</DialogTitle>
            <DialogDescription>
              Name and phone. Members can also edit these themselves via Edit profile.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>Full name</Label>
              <Input
                value={editTarget?.fullName || ''}
                onChange={(e) => setEditTarget((t) => ({ ...t, fullName: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Phone</Label>
              <Input
                value={editTarget?.phone || ''}
                onChange={(e) => setEditTarget((t) => ({ ...t, phone: e.target.value }))}
                placeholder="+65 9123 4567"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              disabled={!editTarget?.fullName?.trim() || memberMutation.isPending}
              onClick={() => memberMutation.mutate({
                userId: editTarget.id,
                body: {
                  fullName: editTarget.fullName.trim(),
                  phone: editTarget.phone?.trim() || null,
                },
              })}
            >
              {memberMutation.isPending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
