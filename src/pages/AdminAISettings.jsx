import { useEffect, useState } from 'react';
import { CheckCircle2, KeyRound, Loader2, ShieldCheck, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { apiClient } from '@/api/client';
import PageHeader from '@/components/common/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const EMPTY = {
  defaultProvider: 'openai', openaiModel: 'gpt-5.6-terra', anthropicModel: 'claude-sonnet-4-6',
  globalGuardrails: '', workstylePreferences: '', providers: { openai: {}, anthropic: {} }, encryptionReady: false,
};

function ProviderCard({ provider, title, model, setModel, apiKey, setApiKey, status, testing, onTest, onClear, clearPending, encryptionReady }) {
  return (
    <Card>
      <CardHeader><div className="flex items-start justify-between gap-4"><div><CardTitle className="text-base">{title}</CardTitle><CardDescription>Used only by the MKTR backend.</CardDescription></div><span className={`rounded-full px-2.5 py-1 text-xs ${status?.configured ? 'bg-emerald-100 text-emerald-800' : 'bg-muted text-muted-foreground'}`}>{status?.configured ? `Configured · ${status.hint || status.source}` : 'Not configured'}</span></div></CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2"><Label htmlFor={`${provider}-model`}>Model ID</Label><Input id={`${provider}-model`} value={model} onChange={(event) => setModel(event.target.value)} /></div>
        <div className="space-y-2"><Label htmlFor={`${provider}-key`}>API key</Label><Input id={`${provider}-key`} type="password" autoComplete="new-password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={status?.configured ? 'Leave blank to keep the current key' : 'Paste a provider API key'} /><p className="text-xs text-muted-foreground">The existing key is never sent back to the browser. Saving a blank field keeps it unchanged.</p></div>
        <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" onClick={() => onTest(provider)} disabled={!status?.configured || testing === provider}>{testing === provider ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}Test connection</Button>{status?.source === 'admin' && <Button type="button" variant="ghost" className="text-destructive" onClick={() => onClear(provider)} disabled={clearPending}><Trash2 className="mr-2 h-4 w-4" />{clearPending ? 'Removal pending save' : 'Remove stored key'}</Button>}</div>
        {!encryptionReady && <p className="rounded-md bg-amber-50 p-3 text-xs text-amber-900">Admin-entered keys cannot be saved until the server has an AI credential encryption key. Environment-based provider keys continue to work.</p>}
      </CardContent>
    </Card>
  );
}

export default function AdminAISettings() {
  const [form, setForm] = useState(EMPTY);
  const [openaiApiKey, setOpenaiApiKey] = useState('');
  const [anthropicApiKey, setAnthropicApiKey] = useState('');
  const [clearOpenaiKey, setClearOpenaiKey] = useState(false);
  const [clearAnthropicKey, setClearAnthropicKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(null);

  useEffect(() => {
    apiClient.get('/admin/ai/settings')
      .then((response) => setForm({ ...EMPTY, ...(response?.data?.settings || {}) }))
      .catch((error) => toast.error(error.message || 'Could not load AI settings'))
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const response = await apiClient.put('/admin/ai/settings', {
        defaultProvider: form.defaultProvider, openaiModel: form.openaiModel, anthropicModel: form.anthropicModel,
        openaiApiKey, anthropicApiKey, clearOpenaiKey, clearAnthropicKey,
        globalGuardrails: form.globalGuardrails, workstylePreferences: form.workstylePreferences,
      });
      setForm({ ...EMPTY, ...(response?.data?.settings || {}) });
      setOpenaiApiKey(''); setAnthropicApiKey(''); setClearOpenaiKey(false); setClearAnthropicKey(false);
      toast.success('AI settings saved');
    } catch (error) { toast.error(error.message || 'Could not save AI settings'); } finally { setSaving(false); }
  };

  const testProvider = async (provider) => {
    setTesting(provider);
    try { await apiClient.post(`/admin/ai/providers/${provider}/test`); toast.success(`${provider === 'openai' ? 'OpenAI' : 'Claude'} connection works`); }
    catch (error) { toast.error(error.message || 'Connection test failed'); }
    finally { setTesting(null); }
  };

  if (loading) return <div className="flex h-[60vh] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <PageHeader title="AI Settings" description="Secure provider access and organisation-wide campaign drafting guidance." />
      <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950"><div className="flex gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" /><div><strong>Keys stay server-side.</strong><p className="mt-1 text-blue-900">Credentials are encrypted before database storage, never returned after saving, never placed in campaign content and never called from the customer’s browser.</p></div></div></div>
      <Card><CardHeader><CardTitle className="text-base">Default provider</CardTitle><CardDescription>Guided Review uses this provider unless the operator chooses another one in the drafting panel.</CardDescription></CardHeader><CardContent><Select value={form.defaultProvider} onValueChange={(value) => setForm((current) => ({ ...current, defaultProvider: value }))}><SelectTrigger className="max-w-sm"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="openai">OpenAI</SelectItem><SelectItem value="anthropic">Claude by Anthropic</SelectItem></SelectContent></Select></CardContent></Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <ProviderCard provider="openai" title="OpenAI" model={form.openaiModel} setModel={(value) => setForm((current) => ({ ...current, openaiModel: value }))} apiKey={openaiApiKey} setApiKey={(value) => { setOpenaiApiKey(value); setClearOpenaiKey(false); }} status={form.providers?.openai} testing={testing} onTest={testProvider} onClear={() => setClearOpenaiKey(true)} clearPending={clearOpenaiKey} encryptionReady={form.encryptionReady} />
        <ProviderCard provider="anthropic" title="Claude" model={form.anthropicModel} setModel={(value) => setForm((current) => ({ ...current, anthropicModel: value }))} apiKey={anthropicApiKey} setApiKey={(value) => { setAnthropicApiKey(value); setClearAnthropicKey(false); }} status={form.providers?.anthropic} testing={testing} onTest={testProvider} onClear={() => setClearAnthropicKey(true)} clearPending={clearAnthropicKey} encryptionReady={form.encryptionReady} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card><CardHeader><CardTitle className="text-base">Global guardrails</CardTitle><CardDescription>Non-negotiable organisation rules added after MKTR’s built-in safety and compliance rules.</CardDescription></CardHeader><CardContent><Textarea rows={10} value={form.globalGuardrails} onChange={(event) => setForm((current) => ({ ...current, globalGuardrails: event.target.value }))} placeholder={'Examples:\n- Never mention a partner until Legal approves the name.\n- Do not use “free”; use “complimentary”.\n- Avoid unsupported CPF or healthcare claims.'} /></CardContent></Card>
        <Card><CardHeader><CardTitle className="text-base">Workstyle and writing preferences</CardTitle><CardDescription>Reusable voice, structure and editing preferences for every generated draft.</CardDescription></CardHeader><CardContent><Textarea rows={10} value={form.workstylePreferences} onChange={(event) => setForm((current) => ({ ...current, workstylePreferences: event.target.value }))} placeholder={'Examples:\n- Warm, concise Singapore English.\n- Short headlines and practical explanations.\n- Prefer calm confidence over urgency.\n- Write for a mobile-first reader.'} /></CardContent></Card>
      </div>
      <p className="text-xs leading-5 text-muted-foreground">Campaign briefs and this organisation guidance are sent to the selected provider when an admin generates a draft. Do not enter customer personal data or confidential material; provider processing and retention follow your provider account terms.</p>
      <div className="sticky bottom-4 flex justify-end"><Button size="lg" onClick={save} disabled={saving || ((!form.encryptionReady) && Boolean(openaiApiKey || anthropicApiKey))}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <KeyRound className="mr-2 h-4 w-4" />}Save AI settings</Button></div>
    </div>
  );
}
