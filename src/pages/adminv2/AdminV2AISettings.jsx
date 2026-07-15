/**
 * Switchboard AI Settings — the REAL settings object (design-final contract):
 * default provider, per-provider model + encrypted key (last-4 hint only,
 * set/replace/clear — never revealed), global guardrails and workstyle
 * preferences. Scoring/call-bot/tagging live on the wishlist, not here.
 */
import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiClient } from '@/api/client';
import { PageHeader, Card, Chip, Skeleton, ErrorState } from '@/components/adminv2/primitives';

const fetchSettings = async () => (await apiClient.get('/admin/ai/settings'))?.data?.settings ?? null;

function ProviderCard({ id, label, settings, form, setForm, onTest, testing }) {
  const status = settings.providers?.[id] || {};
  const isDefault = form.defaultProvider === id;
  const modelKey = id === 'openai' ? 'openaiModel' : 'anthropicModel';
  const keyKey = id === 'openai' ? 'openaiApiKey' : 'anthropicApiKey';
  const clearKey = id === 'openai' ? 'clearOpenaiKey' : 'clearAnthropicKey';
  const [editingKey, setEditingKey] = useState(false);

  return (
    <Card span={6}>
      <div style={{ padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <span className="av2-h2">{label}</span>
          {isDefault
            ? <Chip tone="accent">Default</Chip>
            : (
              <button type="button" className="av2-btn av2-btn--ghost av2-btn--sm" onClick={() => setForm((f) => ({ ...f, defaultProvider: id }))}>
                Make default
              </button>
            )}
          <span style={{ flex: 1 }} />
          <Chip tone={status.configured ? 'ok' : 'warn'}>{status.configured ? 'Key configured' : 'No key'}</Chip>
        </div>

        <label style={{ display: 'grid', gap: 6, marginBottom: 12 }}>
          <span className="av2-microcaps">Model</span>
          <input className="av2-input" value={form[modelKey]} onChange={(e) => setForm((f) => ({ ...f, [modelKey]: e.target.value }))} />
        </label>

        <div className="av2-microcaps" style={{ marginBottom: 6 }}>API key</div>
        {!editingKey ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="av2-mono" style={{ fontSize: 12, color: 'var(--ink-2)' }}>
              {status.configured
                ? status.source === 'environment' ? 'from server environment' : `••••${status.hint || ''}`
                : 'not set'}
            </span>
            <span style={{ flex: 1 }} />
            <button type="button" className="av2-btn av2-btn--sm" onClick={() => setEditingKey(true)}>
              {status.configured ? 'Replace key' : 'Set key'}
            </button>
            {status.configured && status.source === 'admin' && (
              <button
                type="button"
                className="av2-btn av2-btn--sm"
                style={form[clearKey] ? { borderColor: 'var(--bad)', color: 'var(--bad)' } : undefined}
                aria-pressed={form[clearKey]}
                onClick={() => setForm((f) => ({ ...f, [clearKey]: !f[clearKey] }))}
              >
                {form[clearKey] ? 'Will clear on save' : 'Clear key'}
              </button>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              className="av2-input"
              type="password"
              autoComplete="off"
              placeholder="Paste the new API key (stored encrypted, shown as last-4 only)"
              value={form[keyKey]}
              onChange={(e) => setForm((f) => ({ ...f, [keyKey]: e.target.value }))}
            />
            <button type="button" className="av2-btn av2-btn--sm" onClick={() => { setEditingKey(false); setForm((f) => ({ ...f, [keyKey]: '' })); }}>✕</button>
          </div>
        )}

        <div style={{ marginTop: 12 }}>
          <button type="button" className="av2-btn av2-btn--sm" disabled={testing || !status.configured} onClick={() => onTest(id)}>
            {testing ? 'Testing…' : 'Test provider'}
          </button>
        </div>
      </div>
    </Card>
  );
}

export default function AdminV2AISettings() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ['adminV2', 'aiSettings'], queryFn: fetchSettings });
  const [form, setForm] = useState(null);
  const [testing, setTesting] = useState('');

  useEffect(() => {
    if (settings.data && !form) {
      setForm({
        defaultProvider: settings.data.defaultProvider,
        openaiModel: settings.data.openaiModel || '',
        anthropicModel: settings.data.anthropicModel || '',
        openaiApiKey: '',
        anthropicApiKey: '',
        clearOpenaiKey: false,
        clearAnthropicKey: false,
        globalGuardrails: settings.data.globalGuardrails || '',
        workstylePreferences: settings.data.workstylePreferences || '',
      });
    }
  }, [settings.data, form]);

  const save = useMutation({
    mutationFn: () => {
      const body = { ...form };
      if (!body.openaiApiKey) delete body.openaiApiKey;
      if (!body.anthropicApiKey) delete body.anthropicApiKey;
      return apiClient.put('/admin/ai/settings', body);
    },
    onSuccess: () => {
      toast.success('AI settings saved');
      setForm(null); // re-seed from the fresh fetch (hints update after key changes)
      queryClient.invalidateQueries({ queryKey: ['adminV2', 'aiSettings'] });
    },
    onError: (e) => toast.error(e?.message || 'Save failed'),
  });

  const testProvider = async (provider) => {
    setTesting(provider);
    try {
      await apiClient.post(`/admin/ai/providers/${provider}/test`, {});
      toast.success(`${provider} responded OK`);
    } catch (e) {
      toast.error(e?.message || `${provider} test failed`);
    } finally {
      setTesting('');
    }
  };

  if (settings.isLoading || !form) {
    return (
      <div>
        <PageHeader title="AI Settings" meta="PROVIDERS · KEYS · GUARDRAILS" />
        <Skeleton height={220} />
      </div>
    );
  }
  if (settings.isError) return <ErrorState error={settings.error} onRetry={settings.refetch} />;

  return (
    <div>
      <PageHeader title="AI Settings" meta="PROVIDERS · KEYS · GUARDRAILS · WORKSTYLE">
        <button type="button" className="av2-btn av2-btn--primary" disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? 'Saving…' : 'Save changes'}
        </button>
      </PageHeader>

      {settings.data.encryptionReady === false && (
        <div className="av2-caption" style={{ color: 'var(--bad)', marginBottom: 12 }}>
          ▲ Credential encryption is not configured on the server — keys cannot be stored until it is.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 16 }}>
        <ProviderCard id="openai" label="OpenAI" settings={settings.data} form={form} setForm={setForm} onTest={testProvider} testing={testing === 'openai'} />
        <ProviderCard id="anthropic" label="Anthropic" settings={settings.data} form={form} setForm={setForm} onTest={testProvider} testing={testing === 'anthropic'} />

        <Card span={6} title="Global guardrails" meta="applies to every AI feature">
          <div style={{ padding: 16 }}>
            <textarea
              className="av2-input"
              style={{ height: 140, padding: 10, resize: 'vertical', fontFamily: 'var(--font-ui)', fontSize: 13, lineHeight: 1.5 }}
              value={form.globalGuardrails}
              onChange={(e) => setForm((f) => ({ ...f, globalGuardrails: e.target.value }))}
              aria-label="Global guardrails"
              placeholder="Rules every AI output must respect (consent, escalation, no advice…)"
            />
          </div>
        </Card>

        <Card span={6} title="Workstyle preferences" meta="tone + formatting defaults">
          <div style={{ padding: 16 }}>
            <textarea
              className="av2-input"
              style={{ height: 140, padding: 10, resize: 'vertical', fontFamily: 'var(--font-ui)', fontSize: 13, lineHeight: 1.5 }}
              value={form.workstylePreferences}
              onChange={(e) => setForm((f) => ({ ...f, workstylePreferences: e.target.value }))}
              aria-label="Workstyle preferences"
              placeholder="How drafts should read (concise bullets, SGT timestamps, SGD amounts…)"
            />
          </div>
        </Card>
      </div>
    </div>
  );
}
