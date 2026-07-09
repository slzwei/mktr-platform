import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { redeemOpsApi } from '@/api/redeemOps';
import { useAuthStore } from '@/stores/authStore';
import { hasCapability } from '@/lib/redeemOpsPermissions';
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
import { Textarea } from '@/components/ui/textarea';
import Phone from 'lucide-react/icons/phone';
import Globe from 'lucide-react/icons/globe';
import Instagram from 'lucide-react/icons/instagram';
import MessageCircle from 'lucide-react/icons/message-circle';
import Mail from 'lucide-react/icons/mail';
import Calendar from 'lucide-react/icons/calendar';
import FileText from 'lucide-react/icons/file-text';
import ArrowRight from 'lucide-react/icons/arrow-right';
import Star from 'lucide-react/icons/star';
import MapPin from 'lucide-react/icons/map-pin';
import Plus from 'lucide-react/icons/plus';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import { RoStageTag, RoAvatar, RoTag, prettyEnum } from '@/components/redeemops/ui';

/* Activity type → pastel icon circle (timeline card in the design system). */
function timelineIcon(entry) {
  if (entry.kind === 'stage') {
    return { Icon: ArrowRight, bg: 'var(--ro-tag-purple-bg)', fg: 'var(--ro-tag-purple-fg)' };
  }
  if (entry.kind !== 'activity') {
    return { Icon: Plus, bg: 'var(--ro-tag-gray-bg)', fg: 'var(--ro-tag-gray-fg)' };
  }
  const t = String(entry.data.type || '');
  if (t.includes('call')) return { Icon: Phone, bg: 'var(--ro-tag-blue-bg)', fg: 'var(--ro-tag-blue-fg)' };
  if (t.includes('whatsapp') || t.includes('sms') || t.includes('dm')) {
    return { Icon: MessageCircle, bg: 'var(--ro-tag-green-bg)', fg: 'var(--ro-tag-green-fg)' };
  }
  if (t.includes('email')) return { Icon: Mail, bg: 'var(--ro-tag-yellow-bg)', fg: 'var(--ro-tag-yellow-fg)' };
  if (t.includes('meeting') || t.includes('visit')) {
    return { Icon: Calendar, bg: 'var(--ro-tag-blue-bg)', fg: 'var(--ro-tag-blue-fg)' };
  }
  return { Icon: FileText, bg: 'var(--ro-tag-gray-bg)', fg: 'var(--ro-tag-gray-fg)' };
}

function TimelineEntry({ entry }) {
  const at = new Date(entry.at).toLocaleString();
  const { Icon, bg, fg } = timelineIcon(entry);

  let title;
  let body = null;
  let meta;
  if (entry.kind === 'activity') {
    const a = entry.data;
    title = `${prettyEnum(a.type)}${a.contact?.name ? ` · with ${a.contact.name}` : ''}`;
    body = (
      <>
        {a.summary && <p className="text-[13.5px] leading-relaxed m-0 mt-0.5" style={{ color: 'var(--ro-text-2)' }}>{a.summary}</p>}
        {a.outcome && <p className="text-xs m-0 mt-0.5" style={{ color: 'var(--ro-text-3)' }}>Outcome: {a.outcome}</p>}
      </>
    );
    meta = `${a.actor?.fullName || 'System'} · ${at}`;
  } else if (entry.kind === 'stage') {
    const e = entry.data;
    title = `Stage moved: ${prettyEnum(e.fromStage || '—')} → ${prettyEnum(e.toStage)}`;
    meta = `${e.actor?.fullName || 'System'} · ${at}${e.reason ? ` · ${e.reason}` : ''}`;
  } else {
    const e = entry.data;
    title = `Ownership: ${prettyEnum(e.kind)}${e.toUser ? ` → ${e.toUser.fullName}` : ''}`;
    meta = `${e.actor?.fullName || 'System'} · ${at}${e.reason ? ` · ${e.reason}` : ''}`;
  }

  return (
    <div className="grid grid-cols-[40px_1fr] gap-3.5 py-3.5 border-t border-border first:border-t-0 first:pt-0">
      <span className="ro-icon-circle" style={{ background: bg, color: fg }} aria-hidden="true">
        <Icon className="w-4 h-4" />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-bold m-0">{title}</p>
        {body}
        <p className="text-xs m-0 mt-1" style={{ color: 'var(--ro-text-3)' }}>{meta}</p>
      </div>
    </div>
  );
}

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
  const pct = items.length ? Math.round((doneCount / items.length) * 100) : 0;

  return (
    <div className="rounded-2xl border border-border bg-white p-5">
      <div className="flex items-baseline justify-between">
        <p className="text-[15px] font-bold m-0">Onboarding · {doneCount} of {items.length}</p>
        <span className="text-xs tabular-nums" style={{ color: 'var(--ro-text-3)' }}>{pct}%</span>
      </div>
      <div className="ro-progress my-3"><i style={{ width: `${pct}%` }} /></div>
      <div>
        {items.map((item) => (
          <div key={item.id} className="flex items-center justify-between gap-2 py-2 border-t border-border first:border-t-0">
            <span className={`text-sm ${item.status === 'done' || item.status === 'na' ? 'line-through' : ''}`}
              style={item.status === 'done' || item.status === 'na' ? { color: 'var(--ro-text-3)' } : undefined}
            >
              {item.label}
            </span>
            <Select
              value={item.status}
              onValueChange={(status) => updateMutation.mutate({ itemId: item.id, status })}
            >
              <SelectTrigger className="w-36 h-8 border-none shadow-none justify-end gap-1 px-1">
                <RoTag tone={item.status} size="sm">{prettyEnum(item.status)}</RoTag>
              </SelectTrigger>
              <SelectContent>
                {['pending', 'in_progress', 'done', 'na'].map((s) => (
                  <SelectItem key={s} value={s}>{prettyEnum(s)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}
      </div>
    </div>
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
    return <div className="p-8" style={{ color: 'var(--ro-text-2)' }}>Loading…</div>;
  }
  if (!partner) {
    return <div className="p-8" style={{ color: 'var(--ro-text-2)' }}>Business not found.</div>;
  }

  const name = partner.tradingName || partner.brandName || partner.legalName;
  const isOwner = partner.ownerUserId === user?.id;
  const isUnowned = !partner.ownerUserId;
  const canReassign = hasCapability(user, 'partners.reassign');
  const canOnboard = hasCapability(user, 'onboarding.manage');
  const allowedNext = constants.data?.stageTransitions?.[partner.pipelineStage] || [];
  const activityTypes = constants.data?.activityTypes || [];

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto space-y-5">
      <Link to="/redeem-ops/partners" className="ro-link inline-flex items-center gap-1 text-[13.5px]">
        <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" /> Partners
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4 min-w-0">
          <RoAvatar name={name} size={56} />
          <div className="min-w-0">
            <h1 className="ro-title text-[26px]">{name}</h1>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-[13.5px]" style={{ color: 'var(--ro-text-2)' }}>
              <span>{partner.category || 'Uncategorised'}</span>
              {partner.uen && <span>UEN {partner.uen}</span>}
              {partner.primaryPhone && (
                <span className="inline-flex items-center gap-1"><Phone className="w-3.5 h-3.5" aria-hidden="true" />{partner.primaryPhone}</span>
              )}
              {partner.websiteDomain && (
                <span className="inline-flex items-center gap-1"><Globe className="w-3.5 h-3.5" aria-hidden="true" />{partner.websiteDomain}</span>
              )}
              {partner.instagramHandle && (
                <span className="inline-flex items-center gap-1"><Instagram className="w-3.5 h-3.5" aria-hidden="true" />@{partner.instagramHandle}</span>
              )}
              <RoStageTag stage={partner.pipelineStage} />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canReassign && (
            <Select onValueChange={(toUserId) => assignMutation.mutate({ toUserId })}>
              <SelectTrigger className="w-40 h-10"><SelectValue placeholder="Assign to…" /></SelectTrigger>
              <SelectContent>
                {(teamQuery.data || []).filter((m) => m.isActive).map((m) => (
                  <SelectItem key={m.id} value={m.id}>{m.fullName || m.email}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {(isOwner || canReassign) && allowedNext.length > 0 && (
            <Select onValueChange={(toStage) => stageMutation.mutate({ toStage })}>
              <SelectTrigger className="w-44 h-10"><SelectValue placeholder="Move stage…" /></SelectTrigger>
              <SelectContent>
                {allowedNext.map((s) => (
                  <SelectItem key={s} value={s}>{prettyEnum(s)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {isOwner && (
            <Button variant="outline" onClick={() => releaseMutation.mutate()}>Release</Button>
          )}
          {(isOwner || canReassign) && (
            <Button variant="outline" onClick={() => setActivityOpen(true)}>Log activity</Button>
          )}
          {isUnowned && hasCapability(user, 'partners.claim') && (
            <Button onClick={() => claimMutation.mutate()} disabled={claimMutation.isPending}>
              {claimMutation.isPending ? 'Claiming…' : 'Claim business'}
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_320px] items-start">
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
            <div className="rounded-2xl border border-border bg-white p-5">
              {(timelineQuery.data || []).length === 0 && (
                <p className="text-sm m-0" style={{ color: 'var(--ro-text-2)' }}>
                  No activity yet — claim it and make the first touch.
                </p>
              )}
              {(timelineQuery.data || []).map((entry, i) => (
                <TimelineEntry key={`${entry.kind}-${entry.data.id || i}`} entry={entry} />
              ))}
            </div>
          </TabsContent>

          <TabsContent value="contacts">
            <div className="rounded-2xl border border-border bg-white p-5 space-y-4">
              {(partner.contacts || []).map((c) => (
                <div key={c.id} className="flex items-center gap-3 border-b border-border pb-3 last:border-0 last:pb-0">
                  <RoAvatar name={c.name} size={32} />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold m-0 flex items-center gap-1.5">
                      {c.name}
                      {c.isPrimary && <Star className="w-3.5 h-3.5" style={{ color: 'var(--ro-tag-yellow-fg)' }} aria-label="Primary contact" />}
                    </p>
                    <p className="text-xs m-0" style={{ color: 'var(--ro-text-2)' }}>
                      {[c.roleTitle, c.mobile, c.email].filter(Boolean).join(' · ') || '—'}
                    </p>
                  </div>
                </div>
              ))}
              {(isOwner || canReassign) && (
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <Input placeholder="Name *" value={contactForm.name} onChange={(e) => setContactForm((f) => ({ ...f, name: e.target.value }))} />
                  <Input placeholder="Role (e.g. Owner)" value={contactForm.roleTitle} onChange={(e) => setContactForm((f) => ({ ...f, roleTitle: e.target.value }))} />
                  <Input placeholder="Mobile" value={contactForm.mobile} onChange={(e) => setContactForm((f) => ({ ...f, mobile: e.target.value }))} />
                  <Input placeholder="Email" value={contactForm.email} onChange={(e) => setContactForm((f) => ({ ...f, email: e.target.value }))} />
                  <Button
                    variant="outline"
                    className="col-span-2 justify-self-start"
                    disabled={!contactForm.name.trim() || contactMutation.isPending}
                    onClick={() => contactMutation.mutate()}
                  >
                    <Plus className="w-4 h-4 mr-1.5" aria-hidden="true" /> Add contact
                  </Button>
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="locations">
            <div className="rounded-2xl border border-border bg-white p-5 space-y-4">
              {(partner.locations || []).map((l) => (
                <div key={l.id} className="flex items-center gap-3 border-b border-border pb-3 last:border-0 last:pb-0">
                  <span className="ro-icon-circle" style={{ width: 32, height: 32, background: 'var(--ro-tag-gray-bg)', color: 'var(--ro-tag-gray-fg)' }} aria-hidden="true">
                    <MapPin className="w-3.5 h-3.5" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold m-0">{l.name || 'Outlet'}</p>
                    <p className="text-xs m-0" style={{ color: 'var(--ro-text-2)' }}>
                      {[l.addressLine, l.postalCode && `S${l.postalCode}`, l.phone].filter(Boolean).join(' · ') || '—'}
                    </p>
                  </div>
                </div>
              ))}
              {(isOwner || canReassign) && (
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <Input placeholder="Outlet name" value={locationForm.name} onChange={(e) => setLocationForm((f) => ({ ...f, name: e.target.value }))} />
                  <Input placeholder="Postal code" value={locationForm.postalCode} onChange={(e) => setLocationForm((f) => ({ ...f, postalCode: e.target.value }))} />
                  <Input placeholder="Address" className="col-span-2" value={locationForm.addressLine} onChange={(e) => setLocationForm((f) => ({ ...f, addressLine: e.target.value }))} />
                  <Button
                    variant="outline"
                    className="col-span-2 justify-self-start"
                    disabled={locationMutation.isPending}
                    onClick={() => locationMutation.mutate()}
                  >
                    <Plus className="w-4 h-4 mr-1.5" aria-hidden="true" /> Add location
                  </Button>
                </div>
              )}
            </div>
          </TabsContent>

          {partner.pipelineStage === 'PARTNERED' && canOnboard && (
            <TabsContent value="onboarding">
              <OnboardingChecklist partnerId={id} />
            </TabsContent>
          )}
        </Tabs>

        <div className="space-y-4">
          <div className="rounded-2xl border border-border bg-white p-5">
            <p className="text-[15px] font-bold m-0 mb-3">Owner</p>
            {partner.owner ? (
              <div className="flex items-center gap-3">
                <RoAvatar name={partner.owner.fullName} size={32} />
                <div>
                  <p className="text-sm font-semibold m-0">{partner.owner.fullName}</p>
                  {partner.claimedAt && (
                    <p className="text-xs m-0" style={{ color: 'var(--ro-text-2)' }}>
                      Claimed {new Date(partner.claimedAt).toLocaleDateString()}
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-sm m-0" style={{ color: 'var(--ro-text-2)' }}>
                Unowned — claim it to start outreach.
              </p>
            )}
          </div>

          {partner.notes && (
            <div className="rounded-2xl border border-border bg-white p-5">
              <p className="text-[15px] font-bold m-0 mb-2">Notes</p>
              <p className="text-[13.5px] leading-relaxed m-0 whitespace-pre-wrap" style={{ color: 'var(--ro-text-2)' }}>{partner.notes}</p>
            </div>
          )}
        </div>
      </div>

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
                    <SelectItem key={t} value={t}>{prettyEnum(t)}</SelectItem>
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
