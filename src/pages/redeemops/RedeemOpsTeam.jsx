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
import { Badge } from '@/components/ui/badge';
import UserPlus from 'lucide-react/icons/user-plus';

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

  const team = teamQuery.data || [];

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Team &amp; access</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Redeem Ops staff and their sub-roles. Admins are implicit super admins.
          </p>
        </div>
        {canManage && (
          <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <UserPlus className="w-4 h-4 mr-2" aria-hidden="true" />
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
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Sub-role</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {team.map((member) => (
                  <TableRow key={member.id}>
                    <TableCell className="font-medium">
                      {member.fullName || [member.firstName, member.lastName].filter(Boolean).join(' ') || '—'}
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
                        <Badge variant="secondary">
                          {subRoleLabels[member.redeemOpsRole] || member.redeemOpsRole || '—'}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={member.isActive ? 'default' : 'outline'}>
                        {member.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
                {!teamQuery.isLoading && team.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                      No Redeem Ops staff yet{canManage ? ' — send the first invite.' : '.'}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
