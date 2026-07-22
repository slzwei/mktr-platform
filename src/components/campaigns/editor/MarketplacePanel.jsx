import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { AlertCircle, CheckCircle2, Loader2, Store } from 'lucide-react';
import { apiClient } from '@/api/client';
import { marketplaceInheritEnabled, deriveListingPreview } from '@/lib/listingDerivation';

/**
 * Marketplace panel — authors the design_config marketplace keys
 * (docs/plans/redeem-marketplace-v2.md Phase 2). Values are clamped
 * server-side (utils/marketplaceContent.js); marketplaceListed is admin-only
 * on the server (non-admin saves preserve the stored value).
 *
 * The slug is a TOP-LEVEL campaign column (not design_config) with its own
 * save path here — it locks permanently once the campaign is first activated.
 */

const CATEGORY_OPTIONS = [
  ['art_creativity', 'Art & Creativity'], ['coding_robotics', 'Coding & Robotics'],
  ['speech_performance', 'Speech & Performance'], ['sports_movement', 'Sports & Movement'],
  ['music_dance', 'Music & Dance'], ['academic', 'Academic'],
  ['family_lifestyle', 'Family & Lifestyle'], ['wellness', 'Wellness'],
  ['dining', 'Dining'], ['financial_education', 'Financial Education'],
];
const OFFER_TYPES = ['trial', 'assessment', 'workshop', 'reward', 'consultation'];
const MODES = ['physical', 'online', 'hybrid'];
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function Section({ title, hint, children }) {
  return (
    <div className="space-y-3 border-t border-border pt-4 first:border-t-0 first:pt-0">
      <Label className="text-sm font-semibold text-foreground">{title}</Label>
      {hint && <p className="text-xs text-muted-foreground -mt-1">{hint}</p>}
      {children}
    </div>
  );
}

export default function MarketplacePanel({ currentDesign, onDesignChange, campaign }) {
  const dc = currentDesign || {};
  // The classic editor deliberately strips luckyDraw from currentDesign — the
  // CAMPAIGN row is the truth for draw detection (Phase B finding 2), and the
  // preview doc recombines it so the inherited rows derive correctly.
  const storedLucky = campaign?.design_config?.luckyDraw;
  const isDrawCampaign = storedLucky?.enabled === true;
  const inheritPreviewDoc = marketplaceInheritEnabled() ? { ...dc, luckyDraw: storedLucky } : null;
  const activation = dc.activation || {};
  const sponsor = dc.sponsor || null;
  const blocks = dc.content_blocks || {};
  const availability = dc.availability || { days: [], slots: [] };

  const setActivation = (patch) => onDesignChange('activation', { ...activation, required: activation.required === true, ...patch });
  const setBlocks = (patch) => onDesignChange('content_blocks', { ...blocks, ...patch });

  /* ---------- slug (top-level column, own save path) ---------- */
  const [slug, setSlug] = useState(campaign?.slug || '');
  const [slugState, setSlugState] = useState('idle'); // idle|checking|available|taken|invalid|saving
  const slugLocked = !!campaign?.firstActivatedAt;

  useEffect(() => {
    setSlug(campaign?.slug || '');
  }, [campaign?.slug]);

  const checkSlug = useCallback(async (value) => {
    if (!value) return setSlugState('idle');
    if (!/^[a-z0-9-]{3,80}$/.test(value)) return setSlugState('invalid');
    if (value === campaign?.slug) return setSlugState('available');
    setSlugState('checking');
    try {
      const resp = await apiClient.get(`/campaigns/slug-availability?slug=${encodeURIComponent(value)}&excludeCampaignId=${campaign?.id || ''}`);
      setSlugState(resp?.data?.available ? 'available' : 'taken');
    } catch {
      setSlugState('idle');
    }
  }, [campaign?.id, campaign?.slug]);

  useEffect(() => {
    const t = setTimeout(() => checkSlug(slug), 400);
    return () => clearTimeout(t);
  }, [slug, checkSlug]);

  const saveSlug = async () => {
    setSlugState('saving');
    try {
      await apiClient.put(`/campaigns/${campaign.id}`, { slug: slug || null });
      toast.success(slug ? `Slug saved — /offers/${slug}` : 'Slug cleared');
      setSlugState(slug ? 'available' : 'idle');
    } catch (err) {
      toast.error(err?.message || 'Could not save the slug.');
      setSlugState('idle');
    }
  };

  /* ---------- ops preview (composed DTO + gate checklist) ---------- */
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const loadPreview = useCallback(async () => {
    if (!campaign?.id) return;
    setPreviewLoading(true);
    try {
      const resp = await apiClient.get(`/campaigns/${campaign.id}/marketplace-preview`);
      setPreview(resp?.data?.campaign || null);
    } catch {
      setPreview(null);
    } finally {
      setPreviewLoading(false);
    }
  }, [campaign?.id]);

  useEffect(() => {
    loadPreview();
  }, [loadPreview]);

  const drawMismatch = useMemo(() => {
    const opsDraw = preview?.ops?.draw;
    const ldCloses = dc.luckyDraw?.closesAt;
    if (!opsDraw?.closesAt || !ldCloses) return false;
    return String(opsDraw.closesAt).slice(0, 10) !== String(ldCloses).slice(0, 10);
  }, [preview, dc.luckyDraw?.closesAt]);

  const gate = preview?.gate;

  return (
    <div className="space-y-6">
      <Section
        title="Marketplace URL (slug)"
        hint={slugLocked
          ? 'Locked — the slug can no longer change because this campaign has been activated.'
          : 'Lowercase letters, digits and hyphens. Powers /offers/:slug and /flow/:slug on redeem.sg. Locks permanently on first activation.'}
      >
        <div className="flex gap-2">
          <Input
            value={slug}
            disabled={slugLocked}
            placeholder="visual-arts-discovery"
            onChange={(e) => setSlug(e.target.value.toLowerCase().trim())}
          />
          <Button size="sm" disabled={slugLocked || slugState === 'taken' || slugState === 'invalid' || slugState === 'saving' || slug === (campaign?.slug || '')} onClick={saveSlug}>
            {slugState === 'saving' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Save'}
          </Button>
        </div>
        {slugState === 'taken' && <p className="text-xs text-destructive">That slug is taken by another campaign.</p>}
        {slugState === 'invalid' && <p className="text-xs text-destructive">3–80 chars: lowercase letters, digits, hyphens.</p>}
        {slugState === 'available' && slug && <p className="text-xs text-emerald-600">redeem.sg/offers/{slug}</p>}
      </Section>

      <Section
        title="List on the marketplace"
        hint="The ONLY switch that exposes this campaign on redeem.sg browse + detail pages. Admin-only — saves from other roles keep the previous setting. Also requires: slug, campaign active, redeem.sg customer domain, and a live Redeem Ops activation."
      >
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">design_config.marketplaceListed</span>
          <Switch
            checked={dc.marketplaceListed === true}
            onCheckedChange={(v) => onDesignChange('marketplaceListed', v === true)}
          />
        </div>
      </Section>

      {inheritPreviewDoc && (
        <Section title="Inherited from the campaign page" hint="One door: edit these in the designer; they reflect on redeem.sg after saving.">
          <div data-testid="classic-inherited-preview" className="space-y-1">
            {deriveListingPreview(inheritPreviewDoc, campaign?.name).map((row) => (
              <div key={row.label} className="flex gap-2 text-xs">
                <span className="w-24 shrink-0 text-muted-foreground">{row.label}</span>
                <span className="flex-1 min-w-0 truncate">{row.value}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section title="Consumer listing" hint={marketplaceInheritEnabled()
        ? 'Single door: title, value line, image alt and (for draws) the prize list inherit the campaign page — edit them in the designer/Studio.'
        : 'What browsers see on cards and the offer page. The title falls back to the campaign name.'}>
        {!marketplaceInheritEnabled() && (
          <Input value={dc.name || ''} placeholder="Consumer-facing title (optional override)" onChange={(e) => onDesignChange('name', e.target.value)} />
        )}
        <div className="grid grid-cols-2 gap-2">
          <Select value={dc.category || ''} onValueChange={(v) => onDesignChange('category', v)}>
            <SelectTrigger><SelectValue placeholder="Category" /></SelectTrigger>
            <SelectContent>
              {CATEGORY_OPTIONS.map(([id, label]) => <SelectItem key={id} value={id}>{label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={dc.offer_type || ''} onValueChange={(v) => onDesignChange('offer_type', v)}>
            <SelectTrigger><SelectValue placeholder="Offer type" /></SelectTrigger>
            <SelectContent>
              {OFFER_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Select value={dc.mode || ''} onValueChange={(v) => onDesignChange('mode', v)}>
            <SelectTrigger><SelectValue placeholder="Mode" /></SelectTrigger>
            <SelectContent>
              {MODES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
            </SelectContent>
          </Select>
          {!marketplaceInheritEnabled() ? (
            <Input value={dc.image_label || ''} placeholder="Image alt label" onChange={(e) => onDesignChange('image_label', e.target.value)} />
          ) : <div />}
        </div>
        {!marketplaceInheritEnabled() && (
          <Input value={dc.value_line || ''} placeholder='Value line override (blank = "Worth S$<retail> · free…")' onChange={(e) => onDesignChange('value_line', e.target.value)} />
        )}
        {!(marketplaceInheritEnabled() && isDrawCampaign) && (
          <Textarea
            rows={3}
            value={(dc.inclusions || []).join('\n')}
            placeholder={'What’s included — one item per line'}
            onChange={(e) => onDesignChange('inclusions', e.target.value.split('\n').map((s) => s.trim()).filter(Boolean))}
          />
        )}
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Show remaining capacity to consumers</span>
          <Switch checked={dc.showCapacity === true} onCheckedChange={(v) => onDesignChange('showCapacity', v === true)} />
        </div>
      </Section>

      <Section title="Audience (display & filters)" hint="Browse targeting — who the offer is FOR (e.g. the child). Distinct from the submitter age gate (campaign min/max age on the Details tab), which validates the ADULT filling the form.">
        <div className="grid grid-cols-2 gap-2">
          <Input
            type="number"
            value={dc.age_range?.min ?? ''}
            placeholder="Age min"
            onChange={(e) => onDesignChange('age_range', { min: e.target.value === '' ? undefined : Number(e.target.value), max: dc.age_range?.max })}
          />
          <Input
            type="number"
            value={dc.age_range?.max ?? ''}
            placeholder="Age max"
            onChange={(e) => onDesignChange('age_range', { min: dc.age_range?.min, max: e.target.value === '' ? undefined : Number(e.target.value) })}
          />
        </div>
        <Input
          value={(dc.school_levels || []).join(', ')}
          placeholder="School levels (comma-separated, e.g. P3, P4, P5)"
          onChange={(e) => onDesignChange('school_levels', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
        />
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">DSA-related (appears on /dsa)</span>
          <Switch checked={dc.dsa_related === true} onCheckedChange={(v) => onDesignChange('dsa_related', v === true)} />
        </div>
      </Section>

      <Section title="Availability (indicative)" hint="Shown on the offer page and as preference chips in the flow — the partner confirms the final slot.">
        <div className="flex gap-1 flex-wrap">
          {DAYS.map((d) => {
            const active = (availability.days || []).includes(d);
            return (
              <button
                key={d}
                type="button"
                className={`px-2 py-1 text-xs rounded-md border ${active ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground'}`}
                onClick={() => onDesignChange('availability', {
                  ...availability,
                  days: active ? (availability.days || []).filter((x) => x !== d) : [...(availability.days || []), d],
                })}
              >
                {d}
              </button>
            );
          })}
        </div>
        <Input
          value={(availability.slots || []).join(', ')}
          placeholder="Slots (HH:MM, comma-separated, e.g. 10:00, 14:00)"
          onChange={(e) => onDesignChange('availability', { ...availability, slots: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
        />
      </Section>

      <Section title="Activation requirement" hint="The requirement COPY shown before submission — the claim window itself comes from the Redeem Ops offer.">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">This campaign has a requirement</span>
          <Switch checked={activation.required === true} onCheckedChange={(v) => setActivation({ required: v === true })} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Input value={activation.type || ''} placeholder="Type (e.g. financial_consult)" onChange={(e) => setActivation({ type: e.target.value })} />
          <Input type="number" value={activation.duration_mins ?? ''} placeholder="Duration (mins)" onChange={(e) => setActivation({ duration_mins: e.target.value === '' ? undefined : Number(e.target.value) })} />
        </div>
        <Input value={activation.summary || ''} placeholder="One-line summary (cards, reminders)" onChange={(e) => setActivation({ summary: e.target.value })} />
        <Textarea rows={3} value={activation.detail || ''} placeholder="Full detail (offer page + consent step)" onChange={(e) => setActivation({ detail: e.target.value })} />
      </Section>

      <Section title="Sponsor disclosure" hint="Shown on the offer page and consent step when the campaign is sponsored.">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Sponsored campaign</span>
          <Switch
            checked={!!sponsor}
            onCheckedChange={(v) => onDesignChange('sponsor', v ? { kind: sponsor?.kind || 'financial_consultant', disclosure: sponsor?.disclosure || '' } : null)}
          />
        </div>
        {sponsor && (
          <>
            <Input value={sponsor.kind || ''} placeholder="Kind (e.g. financial_consultant)" onChange={(e) => onDesignChange('sponsor', { ...sponsor, kind: e.target.value })} />
            <Textarea rows={2} value={sponsor.disclosure || ''} placeholder="Disclosure copy" onChange={(e) => onDesignChange('sponsor', { ...sponsor, disclosure: e.target.value })} />
          </>
        )}
      </Section>

      <Section title="Disclosures & FAQ">
        <Textarea rows={2} value={blocks.data_use || ''} placeholder="Data use (shown on the offer page)" onChange={(e) => setBlocks({ data_use: e.target.value })} />
        <Textarea rows={2} value={blocks.cancellation || ''} placeholder="Cancellation policy" onChange={(e) => setBlocks({ cancellation: e.target.value })} />
        <Textarea
          rows={4}
          value={(blocks.faq || []).map((f) => `${f.q} | ${f.a}`).join('\n')}
          placeholder={'FAQ — one per line as: Question | Answer'}
          onChange={(e) => setBlocks({
            faq: e.target.value
              .split('\n')
              .map((line) => {
                const [q, ...a] = line.split('|');
                return { q: (q || '').trim(), a: a.join('|').trim() };
              })
              .filter((f) => f.q && f.a),
          })}
        />
      </Section>

      <Section
        title="QR scan landing"
        hint="Where a /t/:slug QR scan lands for this campaign. Direct (default) preserves today's straight-to-form behaviour; Detail sends scanners to the offer page first (requires the marketplace + QR-redirect flags)."
      >
        <div className="bg-muted p-1 rounded-lg flex gap-1">
          {[
            { id: 'direct', label: 'Direct to form' },
            { id: 'detail', label: 'Offer detail first' },
          ].map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => onDesignChange('qr_entry', opt.id)}
              className={`flex-1 py-1.5 px-2 text-xs font-medium rounded-md transition-colors ${
                (dc.qr_entry || 'direct') === opt.id
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Consumer preview (composed)" hint="What the public marketplace API would serve for this campaign — including the read-only ops layer from Redeem Ops.">
        <Button variant="outline" size="sm" onClick={loadPreview} disabled={previewLoading}>
          {previewLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Store className="w-3.5 h-3.5" />}
          <span className="ml-1.5">Refresh preview</span>
        </Button>
        {gate && (
          <div className="space-y-1 text-xs">
            {[
              ['Slug set', gate.slug],
              ['Campaign active', gate.active],
              ['Listed (admin toggle)', gate.marketplaceListed],
              ['redeem.sg customer domain', gate.redeemHost],
              ['Supported campaign type', gate.supportedType],
              ['Redeem Ops activation resolvable', gate.opsResolvable],
            ].map(([label, ok]) => (
              <div key={label} className="flex items-center gap-1.5">
                {ok ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> : <AlertCircle className="w-3.5 h-3.5 text-amber-600" />}
                <span className={ok ? 'text-muted-foreground' : 'text-amber-700 dark:text-amber-500'}>{label}</span>
              </div>
            ))}
            <p className={`pt-1 font-medium ${gate.listed ? 'text-emerald-600' : 'text-muted-foreground'}`}>
              {gate.listed ? 'This campaign is publicly listed.' : 'Not publicly visible until every check passes.'}
            </p>
          </div>
        )}
        {preview?.ops && (
          <div className="text-xs text-muted-foreground space-y-0.5 border border-border rounded-md p-2">
            <div>Partner: {preview.ops.partner?.name || '—'}{preview.ops.partner?.verified ? ' · verified' : ''}</div>
            <div>Capacity: {preview.ops.capacity?.remaining}/{preview.ops.capacity?.total} · expires {preview.ops.expiry ? String(preview.ops.expiry).slice(0, 10) : '—'}</div>
            <div>Retail value: {preview.ops.retail_value != null ? `S$${preview.ops.retail_value}` : '—'}</div>
            {preview.ops.draw && <div>Draw: closes {String(preview.ops.draw.closesAt).slice(0, 10)} · boost ×{preview.ops.draw.multiplier}</div>}
          </div>
        )}
        {drawMismatch && (
          <div className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-500">
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>
              The draw close date here (luckyDraw.closesAt) differs from the live Draw row's snapshot — entries accepted after the
              snapshot are excluded from the frozen pool. Align them before launch.
            </span>
          </div>
        )}
      </Section>
    </div>
  );
}
