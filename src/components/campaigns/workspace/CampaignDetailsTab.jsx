import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';

const toDateInput = (v) => {
  if (!v) return '';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
};

/**
 * Details tab — core campaign metadata + the previously-hidden delivery controls
 * (enforceLeadQuota) and per-campaign tracking pixels. Controlled form; the
 * workspace owns create-vs-update. PHV tablet media stays in the classic editor.
 */
export default function CampaignDetailsTab({ initial, type, isEdit, saving, onSubmit }) {
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
  });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    onSubmit({
      name: form.name.trim(),
      type: campaignType,
      min_age: Number(form.min_age) || 18,
      max_age: Number(form.max_age) || 65,
      start_date: form.start_date ? new Date(form.start_date).toISOString() : undefined,
      end_date: form.end_date ? new Date(form.end_date).toISOString() : undefined,
      commission_amount_driver: form.commission_amount_driver === '' ? null : Number(form.commission_amount_driver),
      commission_amount_fleet: form.commission_amount_fleet === '' ? null : Number(form.commission_amount_fleet),
      enforceLeadQuota: form.enforceLeadQuota,
      leadPriceCents: (() => {
        const n = Number(form.leadPriceDollars);
        return form.leadPriceDollars !== '' && Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
      })(),
      metaPixelId: form.metaPixelId.trim() || null,
      tiktokPixelId: form.tiktokPixelId.trim() || null,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-3xl">
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
        <Button type="submit" disabled={saving || !form.name.trim()}>
          {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          {isEdit ? 'Save details' : 'Create draft & continue'}
        </Button>
      </div>
    </form>
  );
}
