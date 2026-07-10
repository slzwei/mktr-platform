import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { redeemOpsApi } from '@/api/redeemOps';
import { useAuthStore } from '@/stores/authStore';
import { hasCapability } from '@/lib/redeemOpsPermissions';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
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
import ListChecks from 'lucide-react/icons/list-checks';
import X from 'lucide-react/icons/x';
import Plus from 'lucide-react/icons/plus';
import Pencil from 'lucide-react/icons/pencil';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import { RoStageTag, RoAvatar, RoTag, prettyEnum } from '@/components/redeemops/ui';

function useDebounced(value, ms = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

/* Activity type → pastel icon circle (timeline card in the design system). */
function timelineIcon(entry) {
  if (entry.kind === 'stage') {
    return { Icon: ArrowRight, bg: 'var(--ro-tag-purple-bg)', fg: 'var(--ro-tag-purple-fg)' };
  }
  if (entry.kind === 'audit') {
    return entry.data.action === 'partner.created'
      ? { Icon: Plus, bg: 'var(--ro-tag-green-bg)', fg: 'var(--ro-tag-green-fg)' }
      : { Icon: Pencil, bg: 'var(--ro-tag-yellow-bg)', fg: 'var(--ro-tag-yellow-fg)' };
  }
  if (entry.kind === 'task') {
    return entry.data.event === 'completed'
      ? { Icon: ListChecks, bg: 'var(--ro-tag-green-bg)', fg: 'var(--ro-tag-green-fg)' }
      : { Icon: ListChecks, bg: 'var(--ro-tag-gray-bg)', fg: 'var(--ro-tag-gray-fg)' };
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

/* Human labels for field-history diffs; derived/internal keys are hidden. */
const FIELD_LABELS = {
  tradingName: 'Business name',
  legalName: 'Legal name',
  brandName: 'Brand name',
  category: 'Category',
  subcategory: 'Subcategory',
  primaryPhone: 'Phone',
  primaryEmail: 'Email',
  instagramHandle: 'Instagram',
  tiktokHandle: 'TikTok',
  website: 'Website',
  uen: 'UEN',
  facebookUrl: 'Facebook',
  linkedinUrl: 'LinkedIn',
  source: 'Source',
  notes: 'Notes',
};

function fieldDiffs(before = {}, after = {}) {
  const diffs = [];
  for (const [key, label] of Object.entries(FIELD_LABELS)) {
    if (!(key in (after || {}))) continue;
    const prev = before?.[key] ?? null;
    const next = after?.[key] ?? null;
    if (String(prev ?? '') === String(next ?? '')) continue;
    diffs.push({ key, label, prev, next });
  }
  return diffs;
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
  } else if (entry.kind === 'task') {
    const { event, task } = entry.data;
    const completerName = task.completedBy === task.assigneeUserId
      ? task.assignee?.fullName
      : task.completedBy === task.createdBy ? task.creator?.fullName : null;
    if (event === 'completed') {
      title = `Task completed — ${task.title}`;
      meta = `${completerName || task.assignee?.fullName || 'Team member'} · ${at}`;
    } else if (event === 'cancelled') {
      title = `Task cancelled — ${task.title}`;
      meta = `${task.assignee?.fullName || task.creator?.fullName || 'Team member'} · ${at}`;
    } else {
      title = `Task created — ${task.title}`;
      meta = `${task.creator?.fullName || 'Team member'} · ${at} · due ${new Date(task.dueAt).toLocaleDateString()}${task.assignee && task.assignee.id !== task.createdBy ? ` · for ${task.assignee.fullName}` : ''}`;
    }
  } else if (entry.kind === 'audit') {
    const e = entry.data;
    if (e.action === 'partner.snoozed') {
      title = 'Snoozed';
      body = e.after?.snoozedUntil ? (
        <p className="text-[13.5px] m-0 mt-0.5" style={{ color: 'var(--ro-text-2)' }}>
          Until {new Date(e.after.snoozedUntil).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })}
        </p>
      ) : null;
      meta = `${e.actor?.fullName || 'System'} · ${at}`;
    } else if (e.action === 'partner.unsnoozed') {
      title = 'Woken from snooze';
      meta = `${e.actor?.fullName || 'System'} · ${at}`;
    } else if (e.action === 'partner.created') {
      title = 'Business added';
      body = e.after?.name ? (
        <p className="text-[13.5px] m-0 mt-0.5" style={{ color: 'var(--ro-text-2)' }}>
          {e.after.name}{e.after.category ? ` · ${e.after.category}` : ''}
        </p>
      ) : null;
    } else {
      const diffs = fieldDiffs(e.before, e.after);
      title = 'Details edited';
      body = diffs.length > 0 ? (
        <div className="mt-1 space-y-0.5">
          {diffs.map((dff) => (
            <p key={dff.key} className="text-[13px] m-0 leading-relaxed" style={{ color: 'var(--ro-text-2)' }}>
              <span className="font-semibold">{dff.label}:</span>{' '}
              <span className="line-through" style={{ color: 'var(--ro-text-3)' }}>{String(dff.prev ?? '') || '—'}</span>
              {' → '}
              <span>{String(dff.next ?? '') || '—'}</span>
            </p>
          ))}
        </div>
      ) : (
        <p className="text-[13px] m-0 mt-0.5" style={{ color: 'var(--ro-text-3)' }}>Internal fields updated</p>
      );
    }
    meta = `${e.actor?.fullName || 'System'} · ${at}`;
  } else {
    const e = entry.data;
    const K = String(e.kind || '');
    if (K === 'claim') title = `Claimed by ${e.toUser?.fullName || e.actor?.fullName || 'someone'}`;
    else if (K === 'release') title = `Released back to the pool${e.fromUser?.fullName ? ` by ${e.fromUser.fullName}` : ''}`;
    else if (K === 'assign') title = `Assigned to ${e.toUser?.fullName || '—'}${e.fromUser?.fullName ? ` (from ${e.fromUser.fullName})` : ''}`;
    else if (K === 'merge') title = 'Duplicate record merged in';
    else title = `Ownership: ${prettyEnum(K)}${e.toUser ? ` → ${e.toUser.fullName}` : ''}`;
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
  const navigate = useNavigate();
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
    // Edits, tasks, contacts and stage moves all create timeline entries now —
    // keep the open timeline honest (review finding: stale after edit).
    queryClient.invalidateQueries({ queryKey: ['redeem-ops', 'partner', id, 'timeline'] });
  };

  const useSimpleMutation = (fn, okMsg) => useMutation({
    mutationFn: fn,
    onSuccess: () => { toast.success(okMsg); invalidate(); },
    onError: (err) => toast.error(err.message, { description: err.data?.claimedBy ? `Claimed by ${err.data.claimedBy.fullName}` : undefined }),
  });

  const claimMutation = useSimpleMutation(() => redeemOpsApi.claimPartner(id), 'Business claimed — it’s yours');
  const releaseMutation = useSimpleMutation(() => redeemOpsApi.releasePartner(id), 'Released back to the pool');
  const stageMutation = useMutation({
    mutationFn: ({ toStage, reason, lostReason }) => redeemOpsApi.changeStage(id, toStage, reason, lostReason),
    onSuccess: () => { toast.success('Stage updated'); setLostOpen(false); invalidate(); },
    onError: (err) => toast.error('Stage change rejected', { description: err.message }),
  });
  const [lostOpen, setLostOpen] = useState(false);
  const [lostReason, setLostReason] = useState(null);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [snoozeDays, setSnoozeDays] = useState(30);
  const snoozeMutation = useMutation({
    mutationFn: () => redeemOpsApi.snoozePartner(id, new Date(Date.now() + snoozeDays * 24 * 3600 * 1000).toISOString()),
    onSuccess: () => { toast.success(`Snoozed for ${snoozeDays} days`); setSnoozeOpen(false); invalidate(); },
    onError: (err) => toast.error('Could not snooze', { description: err.message }),
  });
  const unsnoozeMutation = useSimpleMutation(() => redeemOpsApi.unsnoozePartner(id), 'Back on the active list');
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

  const [taskOpen, setTaskOpen] = useState(false);
  const [task, setTask] = useState({ title: '', dueDate: '', priority: 'medium' });
  const taskMutation = useMutation({
    mutationFn: () => redeemOpsApi.createTask({
      partnerOrganisationId: id,
      title: task.title.trim(),
      dueAt: new Date(`${task.dueDate}T09:00:00`).toISOString(),
      priority: task.priority,
    }),
    onSuccess: () => {
      toast.success('Task created');
      setTaskOpen(false);
      setTask({ title: '', dueDate: '', priority: 'medium' });
      queryClient.invalidateQueries({ queryKey: ['redeem-ops', 'tasks'] });
      queryClient.invalidateQueries({ queryKey: ['redeem-ops', 'queue'] });
      queryClient.invalidateQueries({ queryKey: ['redeem-ops', 'partner', id, 'timeline'] });
    },
    onError: (err) => toast.error('Could not create task', { description: err.message }),
  });

  const [editForm, setEditForm] = useState(null); // null = closed; object = open
  const editMutation = useMutation({
    mutationFn: () => redeemOpsApi.updatePartner(id, {
      tradingName: editForm.tradingName.trim(),
      category: editForm.category,
      primaryPhone: editForm.primaryPhone,
      instagramHandle: editForm.instagramHandle,
      website: editForm.website,
      uen: editForm.uen,
      primaryEmail: editForm.primaryEmail,
      notes: editForm.notes,
    }),
    onSuccess: () => {
      toast.success('Details updated');
      setEditForm(null);
      invalidate();
    },
    onError: (err) => toast.error('Could not update details', { description: err.message }),
  });
  const openEdit = (p) => setEditForm({
    tradingName: p.tradingName || p.brandName || p.legalName || '',
    category: p.category || '',
    primaryPhone: p.primaryPhone || '',
    instagramHandle: p.instagramHandle ? `@${p.instagramHandle}` : '',
    website: p.website || p.websiteDomain || '',
    uen: p.uen || '',
    primaryEmail: p.primaryEmail || '',
    notes: p.notes || '',
  });
  const setEdit = (k) => (e) => setEditForm((f) => ({ ...f, [k]: e.target.value }));

  const deleteMutation = useMutation({
    mutationFn: () => redeemOpsApi.deletePartner(id),
    onSuccess: () => {
      toast.success('Business deleted');
      queryClient.invalidateQueries({ queryKey: ['redeem-ops', 'partners'] });
      navigate('/redeem-ops/partners');
    },
    onError: (err) => toast.error('Could not delete', { description: err.message }),
  });

  const [contactForm, setContactForm] = useState(EMPTY_CONTACT);
  const contactMutation = useMutation({
    mutationFn: () => redeemOpsApi.addContact(id, contactForm),
    onSuccess: () => { toast.success('Contact added'); setContactForm(EMPTY_CONTACT); invalidate(); },
    onError: (err) => toast.error('Could not add contact', { description: err.message }),
  });

  const [contactEdit, setContactEdit] = useState(null); // { id, name, roleTitle, mobile, email }
  const contactUpdateMutation = useMutation({
    mutationFn: () => redeemOpsApi.updateContact(contactEdit.id, {
      name: contactEdit.name.trim(),
      roleTitle: contactEdit.roleTitle || null,
      mobile: contactEdit.mobile || null,
      email: contactEdit.email || null,
    }),
    onSuccess: () => { toast.success('Contact updated'); setContactEdit(null); invalidate(); },
    onError: (err) => toast.error('Could not update contact', { description: err.message }),
  });
  const contactArchiveMutation = useMutation({
    mutationFn: (contactId) => redeemOpsApi.archiveContact(contactId),
    onSuccess: () => { toast.success('Contact removed'); invalidate(); },
    onError: (err) => toast.error('Could not remove contact', { description: err.message }),
  });

  // ── Merge a duplicate record into this one ──
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeSearch, setMergeSearch] = useState('');
  const [mergeTarget, setMergeTarget] = useState(null);
  const debouncedMergeSearch = useDebounced(mergeSearch);
  const mergeCandidates = useQuery({
    queryKey: ['redeem-ops', 'merge-search', id, debouncedMergeSearch],
    queryFn: () => redeemOpsApi.listPartners({ limit: 6, ...(debouncedMergeSearch ? { search: debouncedMergeSearch } : {}) }),
    enabled: mergeOpen,
  });
  const mergeMutation = useMutation({
    mutationFn: () => redeemOpsApi.mergePartners(id, mergeTarget.id),
    onSuccess: () => {
      toast.success('Merged — the duplicate’s history now lives here');
      setMergeOpen(false); setMergeTarget(null); setMergeSearch('');
      invalidate();
      queryClient.invalidateQueries({ queryKey: ['redeem-ops', 'partner', id, 'timeline'] });
    },
    onError: (err) => toast.error('Merge failed', { description: err.message }),
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
            <h1 className="ro-title text-[26px] inline-flex items-center gap-2">
              {name}
              {hasCapability(user, 'partners.edit') && (isOwner || canReassign) && (
                <button
                  type="button"
                  className="ro-icon-circle shrink-0"
                  style={{ width: 30, height: 30, background: 'var(--ro-subtle)', color: 'var(--ro-text-2)', border: 'none', cursor: 'pointer' }}
                  aria-label="Edit business details"
                  title="Edit business details"
                  onClick={() => openEdit(partner)}
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              )}
            </h1>
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
              {partner.pipelineStage === 'LOST' && partner.lostReason && (
                <span style={{ color: 'var(--ro-tag-red-fg)' }} className="font-semibold">
                  {prettyEnum(partner.lostReason)}
                </span>
              )}
              {partner.availability === 'follow_up_later' && partner.snoozedUntil && (
                <span className="font-semibold">
                  Snoozed until {new Date(partner.snoozedUntil).toLocaleDateString('en-SG', { day: 'numeric', month: 'short' })}
                </span>
              )}
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
            <Select
              value=""
              onValueChange={(toStage) => {
                if (toStage === 'LOST') { setLostReason(null); setLostOpen(true); return; }
                stageMutation.mutate({ toStage });
              }}
            >
              <SelectTrigger className="w-44 h-10"><SelectValue placeholder="Move stage…" /></SelectTrigger>
              <SelectContent>
                {allowedNext.map((s) => (
                  <SelectItem key={s} value={s}>{prettyEnum(s)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {(isOwner || canReassign) && !['PARTNERED', 'LOST'].includes(partner.pipelineStage) && (
            partner.availability === 'follow_up_later' ? (
              <Button variant="outline" onClick={() => unsnoozeMutation.mutate()}>Wake up</Button>
            ) : (
              <Button variant="outline" onClick={() => { setSnoozeDays(30); setSnoozeOpen(true); }}>Snooze</Button>
            )
          )}
          {isOwner && (
            <Button variant="outline" onClick={() => releaseMutation.mutate()}>Release</Button>
          )}
          {hasCapability(user, 'tasks.manage') && (
            <Button variant="outline" onClick={() => setTaskOpen(true)}>Add task</Button>
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
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold m-0 flex items-center gap-1.5">
                      {c.name}
                      {c.isPrimary && <Star className="w-3.5 h-3.5" style={{ color: 'var(--ro-tag-yellow-fg)' }} aria-label="Primary contact" />}
                    </p>
                    <p className="text-xs m-0" style={{ color: 'var(--ro-text-2)' }}>
                      {[c.roleTitle, c.mobile, c.email].filter(Boolean).join(' · ') || '—'}
                    </p>
                  </div>
                  {(isOwner || canReassign) && (
                    <span className="flex gap-1 shrink-0">
                      <Button
                        size="sm" variant="ghost" aria-label={`Edit ${c.name}`}
                        onClick={() => setContactEdit({
                          id: c.id, name: c.name, roleTitle: c.roleTitle || '', mobile: c.mobile || '', email: c.email || '',
                        })}
                      >
                        <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                      </Button>
                      <Button
                        size="sm" variant="ghost" aria-label={`Remove ${c.name}`}
                        disabled={contactArchiveMutation.isPending}
                        onClick={() => {
                          if (window.confirm(`Remove ${c.name} from this business? Past activities keep their record.`)) {
                            contactArchiveMutation.mutate(c.id);
                          }
                        }}
                      >
                        <X className="w-3.5 h-3.5" aria-hidden="true" />
                      </Button>
                    </span>
                  )}
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

          {hasCapability(user, 'partners.merge') && (
            <div className="pt-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { setMergeOpen(true); setMergeTarget(null); setMergeSearch(''); }}
              >
                Merge duplicate into this…
              </Button>
            </div>
          )}
          {hasCapability(user, 'partners.delete') && partner.pipelineStage !== 'PARTNERED' && (
            <div className="pt-1">
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                disabled={deleteMutation.isPending}
                onClick={() => {
                  if (window.confirm(`Permanently delete "${name}"? Only for businesses created by mistake — its contacts, tasks and activity go with it. Real duplicates should be merged instead.`)) {
                    deleteMutation.mutate();
                  }
                }}
              >
                {deleteMutation.isPending ? 'Deleting…' : 'Delete business'}
              </Button>
            </div>
          )}
        </div>
      </div>

      <Dialog open={taskOpen} onOpenChange={setTaskOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add task</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>What needs doing? *</Label>
              <Input
                value={task.title}
                onChange={(e) => setTask((t) => ({ ...t, title: e.target.value }))}
                placeholder="Follow up on proposal"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Due date *</Label>
                <Input
                  type="date"
                  value={task.dueDate}
                  onChange={(e) => setTask((t) => ({ ...t, dueDate: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Priority</Label>
                <Select value={task.priority} onValueChange={(priority) => setTask((t) => ({ ...t, priority }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={() => taskMutation.mutate()}
              disabled={!task.title.trim() || !task.dueDate || taskMutation.isPending}
            >
              {taskMutation.isPending ? 'Saving…' : 'Create task'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!contactEdit} onOpenChange={(open) => { if (!open) setContactEdit(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit contact</DialogTitle>
          </DialogHeader>
          {contactEdit && (
            <div className="space-y-3 py-1">
              <div className="space-y-1.5">
                <Label>Name *</Label>
                <Input value={contactEdit.name} onChange={(e) => setContactEdit((c) => ({ ...c, name: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Role</Label>
                <Input value={contactEdit.roleTitle} onChange={(e) => setContactEdit((c) => ({ ...c, roleTitle: e.target.value }))} placeholder="Owner" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Mobile</Label>
                  <Input value={contactEdit.mobile} onChange={(e) => setContactEdit((c) => ({ ...c, mobile: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>Email</Label>
                  <Input value={contactEdit.email} onChange={(e) => setContactEdit((c) => ({ ...c, email: e.target.value }))} />
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              disabled={!contactEdit?.name?.trim() || contactUpdateMutation.isPending}
              onClick={() => contactUpdateMutation.mutate()}
            >
              {contactUpdateMutation.isPending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={mergeOpen} onOpenChange={(open) => { if (!open) { setMergeOpen(false); setMergeTarget(null); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Merge a duplicate into “{name}”</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-1">
            <p className="text-[13px] m-0" style={{ color: 'var(--ro-text-2)' }}>
              The duplicate's contacts, activities and history move onto this record, and the duplicate is archived. This keeps every touchpoint — use Delete only for records created by mistake.
            </p>
            <input
              className="ro-search w-full"
              placeholder="Search the duplicate by name, phone or UEN"
              value={mergeSearch}
              onChange={(e) => { setMergeSearch(e.target.value); setMergeTarget(null); }}
            />
            <div className="max-h-48 overflow-y-auto rounded-xl border border-border">
              {(mergeCandidates.data?.partners || []).filter((p2) => p2.id !== id).map((p2) => {
                const n2 = p2.tradingName || p2.brandName || p2.legalName;
                const selected = mergeTarget?.id === p2.id;
                return (
                  <button
                    key={p2.id}
                    type="button"
                    onClick={() => setMergeTarget(p2)}
                    className="w-full flex items-center gap-2.5 px-3 py-2 border-t border-border first:border-t-0 cursor-pointer text-left"
                    style={{ background: selected ? 'var(--ro-tag-blue-bg)' : '#fff' }}
                  >
                    <RoAvatar name={n2} size={26} />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold truncate">{n2}</span>
                      <span className="block text-xs truncate" style={{ color: 'var(--ro-text-2)' }}>
                        {[p2.category, p2.primaryPhone].filter(Boolean).join(' · ') || '—'}
                      </span>
                    </span>
                    <RoStageTag stage={p2.pipelineStage} size="sm" className="ml-auto shrink-0" />
                  </button>
                );
              })}
              {mergeOpen && !mergeCandidates.isLoading && (mergeCandidates.data?.partners || []).filter((p2) => p2.id !== id).length === 0 && (
                <p className="text-sm text-center py-4 m-0" style={{ color: 'var(--ro-text-2)' }}>No businesses match.</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button
              disabled={!mergeTarget || mergeMutation.isPending}
              onClick={() => {
                const n2 = mergeTarget.tradingName || mergeTarget.brandName || mergeTarget.legalName;
                if (window.confirm(`Merge "${n2}" into "${name}"? "${n2}" will be archived.`)) {
                  mergeMutation.mutate();
                }
              }}
            >
              {mergeMutation.isPending ? 'Merging…' : 'Merge'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editForm} onOpenChange={(open) => { if (!open) setEditForm(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit business details</DialogTitle>
          </DialogHeader>
          {editForm && (
            <div className="grid grid-cols-2 gap-3 py-2">
              <div className="col-span-2 space-y-1.5">
                <Label>Business name *</Label>
                <Input value={editForm.tradingName} onChange={setEdit('tradingName')} />
              </div>
              <div className="space-y-1.5">
                <Label>Category</Label>
                <Input value={editForm.category} onChange={setEdit('category')} placeholder="Nail Salon" />
              </div>
              <div className="space-y-1.5">
                <Label>Phone (+65…)</Label>
                <Input value={editForm.primaryPhone} onChange={setEdit('primaryPhone')} placeholder="+6591234567" />
              </div>
              <div className="space-y-1.5">
                <Label>Instagram</Label>
                <Input value={editForm.instagramHandle} onChange={setEdit('instagramHandle')} placeholder="@nailbliss.sg" />
              </div>
              <div className="space-y-1.5">
                <Label>Website</Label>
                <Input value={editForm.website} onChange={setEdit('website')} placeholder="nailbliss.sg" />
              </div>
              <div className="space-y-1.5">
                <Label>UEN</Label>
                <Input value={editForm.uen} onChange={setEdit('uen')} placeholder="202507548M" />
              </div>
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input value={editForm.primaryEmail} onChange={setEdit('primaryEmail')} placeholder="hello@nailbliss.sg" />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label>Notes</Label>
                <Textarea rows={3} value={editForm.notes} onChange={setEdit('notes')} placeholder="Anything the team should know about this business" />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              disabled={!editForm?.tradingName?.trim() || editMutation.isPending}
              onClick={() => editMutation.mutate()}
            >
              {editMutation.isPending ? 'Saving…' : 'Save changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

      <Dialog open={lostOpen} onOpenChange={setLostOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Mark {name} as Lost</DialogTitle>
            <DialogDescription>Why didn’t this one work out? Kept on record — you can re-engage later.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            {(constants.data?.lostReasons || []).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setLostReason(r)}
                className="h-[42px] px-4 rounded-xl text-[13px] font-semibold border text-left cursor-pointer"
                style={r === lostReason
                  ? { background: 'var(--ro-bunker)', borderColor: 'var(--ro-bunker)', color: '#fff' }
                  : { background: '#fff', borderColor: 'var(--ro-border-strong)', color: 'var(--ro-bunker)' }}
              >
                {prettyEnum(r)}
              </button>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLostOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={!lostReason || stageMutation.isPending}
              onClick={() => stageMutation.mutate({ toStage: 'LOST', lostReason })}
            >
              {stageMutation.isPending ? 'Saving…' : 'Mark as Lost'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={snoozeOpen} onOpenChange={setSnoozeOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Snooze {name}</DialogTitle>
            <DialogDescription>
              Hides it from your queue until the wake date — it keeps its pipeline stage
              and comes back automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            {[7, 14, 30, 90].map((days) => (
              <button
                key={days}
                type="button"
                onClick={() => setSnoozeDays(days)}
                className="h-[42px] px-4 rounded-xl text-[13px] font-semibold border text-left cursor-pointer"
                style={days === snoozeDays
                  ? { background: 'var(--ro-bunker)', borderColor: 'var(--ro-bunker)', color: '#fff' }
                  : { background: '#fff', borderColor: 'var(--ro-border-strong)', color: 'var(--ro-bunker)' }}
              >
                {days === 7 ? '1 week' : days === 14 ? '2 weeks' : days === 30 ? '1 month' : '3 months'}
                <span className="font-normal" style={{ color: days === snoozeDays ? 'rgba(255,255,255,0.7)' : 'var(--ro-text-3)' }}>
                  {' '}— wakes {new Date(Date.now() + days * 24 * 3600 * 1000).toLocaleDateString('en-SG', { day: 'numeric', month: 'short' })}
                </span>
              </button>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSnoozeOpen(false)}>Cancel</Button>
            <Button disabled={snoozeMutation.isPending} onClick={() => snoozeMutation.mutate()}>
              {snoozeMutation.isPending ? 'Saving…' : 'Snooze'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
