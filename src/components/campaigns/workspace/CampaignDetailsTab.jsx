import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Gift, Plus, X, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { apiClient } from '@/api/client';
import { buildDrawTermsHtml, formatLongDate } from './drawTermsTemplate';

const toDateInput = (v) => {
  if (!v) return '';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
};

const MAX_PRIZE_ROWS = 8; // mirrors backend utils/luckyDraw.js

const clampQty = (v) => {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return 1;
  return Math.min(99, Math.max(1, n));
};

/** Rows worth submitting: named, qty coerced to 1..99. Empty extra rows drop. */
const cleanPrizeRows = (rows) =>
  rows
    .filter((r) => r.name.trim())
    .map((r) => ({ qty: clampQty(r.qty), name: r.name.trim() }));

const prizeSummary = (rows) =>
  rows.map((p) => (p.qty === 1 ? p.name : `${p.qty}× ${p.name}`)).join(' + ');

/**
 * Details tab — core campaign metadata + the previously-hidden delivery controls
 * (enforceLeadQuota) and per-campaign tracking pixels. Controlled form; the
 * workspace owns create-vs-update. PHV tablet media stays in the classic editor.
 */
export default function CampaignDetailsTab({ initial, type, draw = false, isEdit, saving, designing = false, onSubmit }) {
  const campaignType = initial?.type || type || 'lead_generation';
  const [form, setForm] = useState({
    name: initial?.name || '',
    min_age: initial?.min_age ?? 18,
    max_age: initial?.max_age ?? 65,
    start_date: toDateInput(initial?.start_date) || toDateInput(new Date()),
    end_date: toDateInput(initial?.end_date),
    commission_amount_driver: initial?.commission_amount_driver ?? '',
    commission_amount_fleet: initial?.commission_amount_fleet ?? '',
    enforceLeadQuota: initial?.enforceLeadQuota === true,
    leadPriceDollars: initial?.leadPriceCents != null ? String(initial.leadPriceCents / 100) : '',
    metaPixelId: initial?.metaPixelId || '',
    tiktokPixelId: initial?.tiktokPixelId || '',
    // Lucky-draw create flow only (draw prop) — never shown on edit.
    drawPrizes: [{ qty: '1', name: '' }],
    drawClosesAt: '',
    drawBoostClosesAt: '',
    drawMultiplier: 10,
  });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  // "Fill it for me" — one brief drafts every field below (create mode only).
  // The server clamps the model output (dates/ages/prize rows); this merge
  // only touches fields the draft returned, so partial answers never blank
  // out what the operator already typed.
  const [aiBrief, setAiBrief] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const handleAiFill = async () => {
    if (aiBusy || aiBrief.trim().length < 5) return;
    setAiBusy(true);
    // Snapshot at request start: the provider can take a while, and a field
    // the operator edits DURING generation must win over the AI's value —
    // each draft value applies only where the field is unchanged since click.
    const snap = form;
    try {
      const resp = await apiClient.post('/admin/ai/details-draft', {
        type: draw ? 'lucky_draw' : campaignType,
        brief: aiBrief.trim(),
      });
      const f = resp?.data?.fields || {};
      setForm((prev) => {
        const put = (key, value) => (prev[key] === snap[key] ? { [key]: value } : {});
        return {
          ...prev,
          ...(f.name ? put('name', f.name) : {}),
          ...(f.startDate ? put('start_date', f.startDate) : {}),
          // endDate arrives by PRESENCE — '' is an intentional "no end date"
          // and clears the field (server returns it only deliberately).
          ...(Object.prototype.hasOwnProperty.call(f, 'endDate') ? put('end_date', f.endDate) : {}),
          ...(f.minAge !== undefined ? put('min_age', f.minAge) : {}),
          ...(f.maxAge !== undefined ? put('max_age', f.maxAge) : {}),
          ...(draw && Array.isArray(f.prizes) && f.prizes.length
            ? put('drawPrizes', f.prizes.map((row) => ({ qty: String(row.qty), name: row.name })))
            : {}),
          ...(draw && f.closesAt ? put('drawClosesAt', f.closesAt) : {}),
          ...(draw && f.closesAt
            ? put('drawBoostClosesAt', f.boostClosesAt && f.boostClosesAt !== f.closesAt ? f.boostClosesAt : '')
            : {}),
          ...(draw && f.multiplier ? put('drawMultiplier', f.multiplier) : {}),
        };
      });
      toast.success('Drafted — review every field, then create.');
    } catch (e) {
      toast.error(e?.response?.data?.message || e.message || 'AI draft failed — try again.');
    } finally {
      setAiBusy(false);
    }
  };
  const setPrizeRow = (i, key, value) =>
    setForm((f) => ({
      ...f,
      drawPrizes: f.drawPrizes.map((row, idx) => (idx === i ? { ...row, [key]: value } : row)),
    }));
  const addPrizeRow = () =>
    setForm((f) =>
      f.drawPrizes.length >= MAX_PRIZE_ROWS ? f : { ...f, drawPrizes: [...f.drawPrizes, { qty: '1', name: '' }] }
    );
  const removePrizeRow = (i) =>
    setForm((f) => ({ ...f, drawPrizes: f.drawPrizes.filter((_, idx) => idx !== i) }));

  const prizeRows = cleanPrizeRows(form.drawPrizes);
  const totalPrizeQty = prizeRows.reduce((sum, p) => sum + p.qty, 0);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    if (draw && (prizeRows.length === 0 || !form.drawClosesAt)) return; // row 1 + close date are required; belt for non-native submits
    const drawConfig = draw
      ? {
          design_config: {
            luckyDraw: {
              enabled: true,
              // prizes[] is canonical (award order); the summary `prize` and
              // winners count are re-derived server-side (utils/luckyDraw.js),
              // this copy just keeps the payload self-consistent.
              prizes: prizeRows,
              prize: prizeSummary(prizeRows),
              closesAt: form.drawClosesAt,
              boostClosesAt: form.drawBoostClosesAt || form.drawClosesAt,
              multiplier: Number(form.drawMultiplier) || 10,
            },
            // Starter T&C generated from these details; the server pins it as
            // draw_terms_versions v1. Edit in the designer before launch —
            // edits mint a new version, entrants keep what they accepted.
            termsContent: buildDrawTermsHtml({
              campaignName: form.name.trim(),
              prizes: prizeRows,
              closesAt: form.drawClosesAt,
              boostClosesAt: form.drawBoostClosesAt || form.drawClosesAt,
              multiplier: Number(form.drawMultiplier) || 10,
              // The eligibility clause must state THIS campaign's floor, not
              // the template default: seeding an 18+ clause onto a 21-65 draw
              // published terms that contradicted both the page copy and the
              // age gate the server enforces.
              minAge: Number(form.min_age) || 18,
            }),
          },
        }
      : {};
    // Second arg = the brief the operator typed (create only; edit never shows
    // the box). The workspace uses a non-empty brief to auto-design the whole
    // page after create — it is transient input, never persisted as a field.
    onSubmit({
      ...drawConfig,
      name: form.name.trim(),
      type: campaignType,
      min_age: Number(form.min_age) || 18,
      max_age: Number(form.max_age) || 65,
      start_date: form.start_date ? new Date(form.start_date).toISOString() : undefined,
      end_date: form.end_date
        ? new Date(form.end_date).toISOString()
        : (draw && form.drawClosesAt ? new Date(form.drawClosesAt).toISOString() : undefined),
      commission_amount_driver: form.commission_amount_driver === '' ? null : Number(form.commission_amount_driver),
      commission_amount_fleet: form.commission_amount_fleet === '' ? null : Number(form.commission_amount_fleet),
      enforceLeadQuota: form.enforceLeadQuota,
      leadPriceCents: (() => {
        const n = Number(form.leadPriceDollars);
        return form.leadPriceDollars !== '' && Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
      })(),
      metaPixelId: form.metaPixelId.trim() || null,
      tiktokPixelId: form.tiktokPixelId.trim() || null,
    }, aiBrief.trim());
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-3xl">
      {!isEdit && (
        <Card data-testid="ai-details-card">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><Sparkles className="w-4 h-4" /> Fill it for me</CardTitle>
            <CardDescription>
              Describe the campaign — the offer{draw ? ' or prizes' : ''}, who it&apos;s for, and when it runs.
              AI drafts every field below; you review and adjust before creating.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              rows={3}
              value={aiBrief}
              onChange={(e) => setAiBrief(e.target.value)}
              placeholder={draw
                ? 'e.g. iPhone 17 Pro lucky draw for young adults — 1 grand prize + 3 AirPods, entries until end of August'
                : 'e.g. $20 NTUC voucher for verified sign-ups, running through September, ages 21 to 55'}
              aria-label="Campaign brief for AI draft"
            />
            <Button type="button" onClick={handleAiFill} disabled={aiBusy || aiBrief.trim().length < 5}>
              {aiBusy ? (<><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Drafting…</>) : 'Fill it for me'}
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Campaign details</CardTitle>
          <CardDescription>The basics. New campaigns start as a draft until you launch them.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Campaign name</Label>
            <Input id="name" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. CareShield CPF — June" required />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2"><Label htmlFor="start_date">Start date</Label><Input id="start_date" type="date" value={form.start_date} onChange={(e) => set('start_date', e.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="end_date">End date</Label><Input id="end_date" type="date" value={form.end_date} onChange={(e) => set('end_date', e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2"><Label htmlFor="min_age">Min age</Label><Input id="min_age" type="number" value={form.min_age} onChange={(e) => set('min_age', e.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="max_age">Max age</Label><Input id="max_age" type="number" value={form.max_age} onChange={(e) => set('max_age', e.target.value)} /></div>
          </div>
        </CardContent>
      </Card>

      {draw && (
        <Card data-testid="draw-setup-card">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><Gift className="w-4 h-4" /> Lucky draw</CardTitle>
            <CardDescription>
              Entries are server-enforced: SMS-verified number, accepted T&Cs, one entry per phone,
              hard close at 23:59 SGT. A starter T&C is generated from these details and pinned as
              version 1 — review it in the designer before launch.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="draw_prize_name_0">Prizes</Label>
              {form.drawPrizes.map((row, i) => (
                <div key={i} className="flex items-center gap-2" data-testid="draw-prize-row">
                  <Input
                    id={`draw_prize_qty_${i}`}
                    aria-label={`Prize ${i + 1} quantity`}
                    type="number"
                    min={1}
                    max={99}
                    className="w-20 shrink-0"
                    value={row.qty}
                    onChange={(e) => setPrizeRow(i, 'qty', e.target.value)}
                    onBlur={(e) => setPrizeRow(i, 'qty', String(clampQty(e.target.value)))}
                  />
                  <span className="text-muted-foreground text-sm shrink-0">×</span>
                  <Input
                    id={`draw_prize_name_${i}`}
                    aria-label={`Prize ${i + 1} name`}
                    value={row.name}
                    onChange={(e) => setPrizeRow(i, 'name', e.target.value)}
                    placeholder={i === 0 ? 'e.g. iPhone 17 Pro 256GB' : 'e.g. $100 FairPrice Voucher'}
                    required={i === 0}
                    maxLength={80}
                  />
                  {form.drawPrizes.length > 1 && (
                    <Button type="button" variant="ghost" size="icon" aria-label={`Remove prize ${i + 1}`} onClick={() => removePrizeRow(i)}>
                      <X className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              ))}
              <div className="flex items-center justify-between gap-2">
                {form.drawPrizes.length < MAX_PRIZE_ROWS ? (
                  <Button type="button" variant="outline" size="sm" onClick={addPrizeRow} data-testid="add-prize-row">
                    <Plus className="w-4 h-4 mr-1" /> Add prize
                  </Button>
                ) : <span />}
                <p className="text-xs text-muted-foreground">Row order is award order — top prize first.</p>
              </div>
              {totalPrizeQty > 1 && (
                <p className="text-xs text-amber-600 dark:text-amber-500" data-testid="multi-prize-note">
                  Multi-prize draws save as drafts — going live needs the multi-winner draw engine (Phase 3). A single-prize draw launches as usual.
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="draw_closes">Entries close</Label>
                <Input id="draw_closes" type="date" value={form.drawClosesAt} onChange={(e) => set('drawClosesAt', e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="draw_boost">Session boost deadline</Label>
                <Input id="draw_boost" type="date" value={form.drawBoostClosesAt} onChange={(e) => set('drawBoostClosesAt', e.target.value)} />
                <p className="text-xs text-muted-foreground">Empty = same as close date.</p>
              </div>
            </div>
            <div className="space-y-2 max-w-[160px]">
              <Label htmlFor="draw_multiplier">Session multiplier</Label>
              <Input id="draw_multiplier" type="number" min={2} max={100} value={form.drawMultiplier} onChange={(e) => set('drawMultiplier', e.target.value)} />
              <p className="text-xs text-muted-foreground">A completed, consultant-scanned review session multiplies the entry.</p>
            </div>
            {form.drawClosesAt ? (
              <p className="text-xs text-muted-foreground">
                Closes {formatLongDate(form.drawClosesAt)}, 23:59 SGT · boost until {formatLongDate(form.drawBoostClosesAt || form.drawClosesAt)} · ×{Number(form.drawMultiplier) || 10} after a scanned session.{totalPrizeQty > 1 ? ` · ${totalPrizeQty} winners` : ''}
              </p>
            ) : null}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">Lead delivery</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Label htmlFor="quota" className="cursor-pointer">Enforce paid lead quota</Label>
              <p className="text-xs text-muted-foreground mt-1">
                When on, a lead is only delivered if a funded agent credit can be charged; otherwise it is held (never delivered free). Leave off for soft delivery.
              </p>
            </div>
            <Switch id="quota" checked={form.enforceLeadQuota} onCheckedChange={(c) => set('enforceLeadQuota', c)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="leadPrice">Lead price (SGD per lead)</Label>
            <Input id="leadPrice" type="number" step="0.01" min="0" value={form.leadPriceDollars} onChange={(e) => set('leadPriceDollars', e.target.value)} placeholder="e.g. 8.00" />
            <p className="text-xs text-muted-foreground">
              What external agents pay per lead when committing wallet credits to this campaign. Leave blank to keep it closed to commitments.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2"><Label htmlFor="cad">Driver commission (SGD)</Label><Input id="cad" type="number" step="0.01" min="0" value={form.commission_amount_driver} onChange={(e) => set('commission_amount_driver', e.target.value)} placeholder="0.00" /></div>
            <div className="space-y-2"><Label htmlFor="caf">Fleet commission (SGD)</Label><Input id="caf" type="number" step="0.01" min="0" value={form.commission_amount_fleet} onChange={(e) => set('commission_amount_fleet', e.target.value)} placeholder="0.00" /></div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tracking pixels</CardTitle>
          <CardDescription>Optional per-campaign overrides for Meta / TikTok. Leave blank to use the site default.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2"><Label htmlFor="meta">Meta Pixel ID</Label><Input id="meta" value={form.metaPixelId} onChange={(e) => set('metaPixelId', e.target.value)} placeholder="e.g. 1402034528611431" /></div>
          <div className="space-y-2"><Label htmlFor="tt">TikTok Pixel ID</Label><Input id="tt" value={form.tiktokPixelId} onChange={(e) => set('tiktokPixelId', e.target.value)} placeholder="e.g. D8GJ6T3C77UDLID6746G" /></div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        {/* `designing` = the post-create AI page-design pass (create flow, when
            a brief was used). It reuses this button so the operator sees the
            work continue, not a frozen "Create" button. */}
        <Button type="submit" disabled={saving || designing || !form.name.trim()}>
          {(saving || designing) && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          {designing ? 'Designing your page…' : isEdit ? 'Save details' : 'Create draft & continue'}
        </Button>
      </div>
    </form>
  );
}
