import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { redeemOpsApi } from '@/api/redeemOps';
import { useAuthStore } from '@/stores/authStore';
import { hasCapability } from '@/lib/redeemOpsPermissions';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import Phone from 'lucide-react/icons/phone';
import Globe from 'lucide-react/icons/globe';
import Instagram from 'lucide-react/icons/instagram';

function TimelineEntry({ entry }) {
  const at = new Date(entry.at).toLocaleString();
  if (entry.kind === 'activity') {
    const a = entry.data;
    return (
      <div className="border-l-2 border-border pl-3 pb-4">
        <p className="text-sm font-medium">
          {a.type.replaceAll('_', ' ')}
          {a.contact?.name ? ` · with ${a.contact.name}` : ''}
        </p>
        <p className="text-sm text-muted-foreground">{a.summary}</p>
        {a.outcome && <p className="text-xs text-muted-foreground">Outcome: {a.outcome}</p>}
        <p className="text-xs text-muted-foreground mt-0.5">{a.actor?.fullName || 'System'} · {at}</p>
      </div>
    );
  }
  if (entry.kind === 'stage') {
    const e = entry.data;
    return (
      <div className="border-l-2 border-primary/40 pl-3 pb-4">
        <p className="text-sm">
          Stage: <span className="font-medium">{(e.fromStage || '—').replaceAll('_', ' ')}</span>
          {' → '}
          <span className="font-medium">{e.toStage.replaceAll('_', ' ')}</span>
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">{e.actor?.fullName || 'System'} · {at}{e.reason ? ` · ${e.reason}` : ''}</p>
      </div>
    );
  }
  const e = entry.data;
  return (
    <div className="border-l-2 border-border pl-3 pb-4">
      <p className="text-sm">
        Ownership: <span className="font-medium">{e.kind}</span>
        {e.toUser ? ` → ${e.toUser.fullName}` : ''}
      </p>
      <p className="text-xs text-muted-foreground mt-0.5">{e.actor?.fullName || 'System'} · {at}{e.reason ? ` · ${e.reason}` : ''}</p>
    </div>
  );
}

const ONBOARDING_STATUS_BADGE = { done: 'default', in_progress: 'secondary', pending: 'outline', na: 'outline' };

function OnboardingChecklist({ partnerId }) {
  const queryClient = useQueryClient();
  const itemsQuery = useQuery({
    queryKey: ['redeem-ops', 'partner', partnerId, 'onboarding'],
    queryFn: () => redeemOpsApi.getOnboarding(partnerId),
  });
  const updateMutation = useMutation({
    mutationFn: ({ itemId, status }) => redeemOpsApi.updateOnboardingItem(itemId, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['redeem-ops', 'partner', partnerId, 'onboarding'] }),
    onError: (err) => toast.error('Could not update item', { description: err.message }),
  });

  const items = itemsQuery.data || [];
  const doneCount = items.filter((i) => i.status === 'done' || i.status === 'na').length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Onboarding checklist</CardTitle>
        <p className="text-sm text-muted-foreground">{doneCount} of {items.length} complete</p>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.map((item) => (
          <div key={item.id} className="flex items-center justify-between gap-2 border-b border-border pb-2 last:border-0">
            <span className="text-sm">{item.label}</span>
            <Select
              value={item.status}
              onValueChange={(status) => updateMutation.mutate({ itemId: item.id, status })}
            >
              <SelectTrigger className="w-36 h-8">
                <Badge variant={ONBOARDING_STATUS_BADGE[item.status] || 'outline'}>
                  {item.status.replaceAll('_', ' ')}
                </Badge>
              </SelectTrigger>
              <SelectContent>
                {['pending', 'in_progress', 'done', 'na'].map((s) => (
                  <SelectItem key={s} value={s}>{s.replaceAll('_', ' ')}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

const EMPTY_ACTIVITY = { type: 'call_attempt', summary: '', details: '', outcome: '', contactId: '' };
const EMPTY_CONTACT = { name: '', roleTitle: '', mobile: '', email: '', preferredChannel: '' };
const EMPTY_LOCATION = { name: '', addressLine: '', postalCode: '', phone: '' };

export default function PartnerDetail() {
  const { id } = useParams();
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();

  const partnerQuery = useQuery({
    queryKey: ['redeem-ops', 'partner', id],
    queryFn: () => redeemOpsApi.getPartner(id),
  });
  const timelineQuery = useQuery({
    queryKey: ['redeem-ops', 'partner', id, 'timeline'],
    queryFn: () => redeemOpsApi.getTimeline(id),
  });
  const constants = useQuery({
    queryKey: ['redeem-ops', 'constants'],
    queryFn: redeemOpsApi.getConstants,
    staleTime: Infinity,
  });
  const teamQuery = useQuery({
    queryKey: ['redeem-ops', 'team'],
    queryFn: redeemOpsApi.getTeam,
    enabled: hasCapability(user, 'partners.reassign'),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['redeem-ops', 'partner', id] });
    queryClient.invalidateQueries({ queryKey: ['redeem-ops', 'partners'] });
  };

  const useSimpleMutation = (fn, okMsg) => useMutation({
    mutationFn: fn,
    onSuccess: () => { toast.success(okMsg); invalidate(); },
    onError: (err) => toast.error(err.message, { description: err.data?.claimedBy ? `Claimed by ${err.data.claimedBy.fullName}` : undefined }),
  });

  const claimMutation = useSimpleMutation(() => redeemOpsApi.claimPartner(id), 'Business claimed — it’s yours');
  const releaseMutation = useSimpleMutation(() => redeemOpsApi.releasePartner(id), 'Released back to the pool');
  const stageMutation = useMutation({
    mutationFn: ({ toStage, reason }) => redeemOpsApi.changeStage(id, toStage, reason),
    onSuccess: () => { toast.success('Stage updated'); invalidate(); },
    onError: (err) => toast.error('Stage change rejected', { description: err.message }),
  });
  const assignMutation = useMutation({
    mutationFn: ({ toUserId }) => redeemOpsApi.assignPartner(id, toUserId),
    onSuccess: () => { toast.success('Reassigned'); invalidate(); },
    onError: (err) => toast.error('Reassign failed', { description: err.message }),
  });

  const [activityOpen, setActivityOpen] = useState(false);
  const [activity, setActivity] = useState(EMPTY_ACTIVITY);
  const activityMutation = useMutation({
    mutationFn: () => redeemOpsApi.logActivity(id, {
      ...activity,
      contactId: activity.contactId || null,
      details: activity.details || null,
      outcome: activity.outcome || null,
    }),
    onSuccess: () => {
      toast.success('Activity logged');
      setActivityOpen(false); setActivity(EMPTY_ACTIVITY);
      invalidate();
      queryClient.invalidateQueries({ queryKey: ['redeem-ops', 'partner', id, 'timeline'] });
    },
    onError: (err) => toast.error('Could not log activity', { description: err.message }),
  });

  const [contactForm, setContactForm] = useState(EMPTY_CONTACT);
  const contactMutation = useMutation({
    mutationFn: () => redeemOpsApi.addContact(id, contactForm),
    onSuccess: () => { toast.success('Contact added'); setContactForm(EMPTY_CONTACT); invalidate(); },
    onError: (err) => toast.error('Could not add contact', { description: err.message }),
  });

  const [locationForm, setLocationForm] = useState(EMPTY_LOCATION);
  const locationMutation = useMutation({
    mutationFn: () => redeemOpsApi.addLocation(id, locationForm),
    onSuccess: () => { toast.success('Location added'); setLocationForm(EMPTY_LOCATION); invalidate(); },
    onError: (err) => toast.error('Could not add location', { description: err.message }),
  });

  const partner = partnerQuery.data;
  if (partnerQuery.isLoading) {
    return <div className="p-6 text-muted-foreground">Loading…</div>;
  }
  if (!partner) {
    return <div className="p-6 text-muted-foreground">Business not found.</div>;
  }

  const name = partner.tradingName || partner.brandName || partner.legalName;
  const isOwner = partner.ownerUserId === user?.id;
  const isUnowned = !partner.ownerUserId;
  const canReassign = hasCapability(user, 'partners.reassign');
  const canOnboard = hasCapability(user, 'onboarding.manage');
  const allowedNext = constants.data?.stageTransitions?.[partner.pipelineStage] || [];
  const activityTypes = constants.data?.activityTypes || [];

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      <Card>
        <CardContent className="pt-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1 min-w-0">
              <h1 className="text-xl font-semibold tracking-tight">{name}</h1>
              <p className="text-sm text-muted-foreground">
                {partner.category || 'Uncategorised'}
                {partner.legalName && partner.legalName !== name ? ` · ${partner.legalName}` : ''}
                {partner.uen ? ` · UEN ${partner.uen}` : ''}
              </p>
              <div className="flex flex-wrap gap-3 text-sm text-muted-foreground pt-1">
                {partner.primaryPhone && <span className="flex items-center gap-1"><Phone className="w-3.5 h-3.5" aria-hidden="true" />{partner.primaryPhone}</span>}
                {partner.websiteDomain && <span className="flex items-center gap-1"><Globe className="w-3.5 h-3.5" aria-hidden="true" />{partner.websiteDomain}</span>}
                {partner.instagramHandle && <span className="flex items-center gap-1"><Instagram className="w-3.5 h-3.5" aria-hidden="true" />@{partner.instagramHandle}</span>}
              </div>
            </div>

            <div className="flex flex-col items-end gap-2">
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{partner.pipelineStage.replaceAll('_', ' ')}</Badge>
                {partner.owner
                  ? <Badge variant="outline">Owner: {partner.owner.fullName}</Badge>
                  : <Badge variant="outline">Unowned</Badge>}
              </div>
              <div className="flex items-center gap-2">
                {isUnowned && hasCapability(user, 'partners.claim') && (
                  <Button size="sm" onClick={() => claimMutation.mutate()} disabled={claimMutation.isPending}>
                    {claimMutation.isPending ? 'Claiming…' : 'Claim business'}
                  </Button>
                )}
                {isOwner && (
                  <Button size="sm" variant="outline" onClick={() => releaseMutation.mutate()}>
                    Release
                  </Button>
                )}
                {canReassign && (
                  <Select onValueChange={(toUserId) => assignMutation.mutate({ toUserId })}>
                    <SelectTrigger className="w-44 h-9"><SelectValue placeholder="Assign to…" /></SelectTrigger>
                    <SelectContent>
                      {(teamQuery.data || []).filter((m) => m.isActive).map((m) => (
                        <SelectItem key={m.id} value={m.id}>{m.fullName || m.email}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {(isOwner || canReassign) && allowedNext.length > 0 && (
                  <Select onValueChange={(toStage) => stageMutation.mutate({ toStage })}>
                    <SelectTrigger className="w-48 h-9"><SelectValue placeholder="Move stage…" /></SelectTrigger>
                    <SelectContent>
                      {allowedNext.map((s) => (
                        <SelectItem key={s} value={s}>{s.replaceAll('_', ' ')}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="timeline">
        <TabsList>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="contacts">Contacts ({partner.contacts?.length || 0})</TabsTrigger>
          <TabsTrigger value="locations">Locations ({partner.locations?.length || 0})</TabsTrigger>
          {partner.pipelineStage === 'PARTNERED' && canOnboard && (
            <TabsTrigger value="onboarding">Onboarding</TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="timeline">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Activity timeline</CardTitle>
              {(isOwner || canReassign) && (
                <Button size="sm" onClick={() => setActivityOpen(true)}>Log activity</Button>
              )}
            </CardHeader>
            <CardContent>
              {(timelineQuery.data || []).length === 0 && (
                <p className="text-sm text-muted-foreground">No activity yet — claim it and make the first touch.</p>
              )}
              {(timelineQuery.data || []).map((entry, i) => (
                <TimelineEntry key={`${entry.kind}-${entry.data.id || i}`} entry={entry} />
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="contacts">
          <Card>
            <CardContent className="pt-5 space-y-4">
              {(partner.contacts || []).map((c) => (
                <div key={c.id} className="flex items-start justify-between border-b border-border pb-3 last:border-0">
                  <div>
                    <p className="text-sm font-medium">
                      {c.name} {c.isPrimary && <Badge variant="secondary" className="ml-1">Primary</Badge>}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {[c.roleTitle, c.mobile, c.email].filter(Boolean).join(' · ') || '—'}
                    </p>
                  </div>
                </div>
              ))}
              {(isOwner || canReassign) && (
                <div className="grid grid-cols-2 gap-2 pt-2">
                  <Input placeholder="Name *" value={contactForm.name} onChange={(e) => setContactForm((f) => ({ ...f, name: e.target.value }))} />
                  <Input placeholder="Role (e.g. Owner)" value={contactForm.roleTitle} onChange={(e) => setContactForm((f) => ({ ...f, roleTitle: e.target.value }))} />
                  <Input placeholder="Mobile" value={contactForm.mobile} onChange={(e) => setContactForm((f) => ({ ...f, mobile: e.target.value }))} />
                  <Input placeholder="Email" value={contactForm.email} onChange={(e) => setContactForm((f) => ({ ...f, email: e.target.value }))} />
                  <Button
                    size="sm"
                    className="col-span-2 justify-self-start"
                    disabled={!contactForm.name.trim() || contactMutation.isPending}
                    onClick={() => contactMutation.mutate()}
                  >
                    Add contact
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="locations">
          <Card>
            <CardContent className="pt-5 space-y-4">
              {(partner.locations || []).map((l) => (
                <div key={l.id} className="border-b border-border pb-3 last:border-0">
                  <p className="text-sm font-medium">{l.name || 'Outlet'}</p>
                  <p className="text-xs text-muted-foreground">
                    {[l.addressLine, l.postalCode && `S${l.postalCode}`, l.phone].filter(Boolean).join(' · ') || '—'}
                  </p>
                </div>
              ))}
              {(isOwner || canReassign) && (
                <div className="grid grid-cols-2 gap-2 pt-2">
                  <Input placeholder="Outlet name" value={locationForm.name} onChange={(e) => setLocationForm((f) => ({ ...f, name: e.target.value }))} />
                  <Input placeholder="Postal code" value={locationForm.postalCode} onChange={(e) => setLocationForm((f) => ({ ...f, postalCode: e.target.value }))} />
                  <Input placeholder="Address" className="col-span-2" value={locationForm.addressLine} onChange={(e) => setLocationForm((f) => ({ ...f, addressLine: e.target.value }))} />
                  <Button
                    size="sm"
                    className="col-span-2 justify-self-start"
                    disabled={locationMutation.isPending}
                    onClick={() => locationMutation.mutate()}
                  >
                    Add location
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {partner.pipelineStage === 'PARTNERED' && canOnboard && (
          <TabsContent value="onboarding">
            <OnboardingChecklist partnerId={id} />
          </TabsContent>
        )}
      </Tabs>

      <Dialog open={activityOpen} onOpenChange={setActivityOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Log activity</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={activity.type} onValueChange={(type) => setActivity((a) => ({ ...a, type }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {activityTypes.map((t) => (
                    <SelectItem key={t} value={t}>{t.replaceAll('_', ' ')}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Summary *</Label>
              <Input value={activity.summary} onChange={(e) => setActivity((a) => ({ ...a, summary: e.target.value }))} placeholder="Spoke to owner, interested in Oct slot" />
            </div>
            {(partner.contacts || []).length > 0 && (
              <div className="space-y-1.5">
                <Label>Contact</Label>
                <Select value={activity.contactId} onValueChange={(contactId) => setActivity((a) => ({ ...a, contactId }))}>
                  <SelectTrigger><SelectValue placeholder="(optional)" /></SelectTrigger>
                  <SelectContent>
                    {partner.contacts.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Details</Label>
              <Textarea rows={3} value={activity.details} onChange={(e) => setActivity((a) => ({ ...a, details: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={() => activityMutation.mutate()}
              disabled={!activity.summary.trim() || activityMutation.isPending}
            >
              {activityMutation.isPending ? 'Saving…' : 'Log it'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
