import { AI_TONES } from './useStudioAi';

/**
 * "✦ Write it for me" — the Studio AI panel (PR 4), the mock's 392px right
 * slide-in. Copy mode ships in this checkpoint (brief → loading → per-field
 * review with struck-through old values → apply-all); the full-mode (CO-1
 * looks) views arrive with the next checkpoint — its toggle is present but
 * disabled until then.
 */

const mono = "500 10px ui-monospace, 'SF Mono', Menlo, monospace";

export default function StudioAiPanel({ ai, fullModeReady = false }) {
  if (!ai.open) return null;
  const {
    mode, setMode, phase, brief, setBrief, sugs, scope, error, retryIn, budget,
  } = ai;

  const budgetColor = budget.used >= 8 ? '#B97D10' : '#9BA0AB';
  const genDisabled = !brief.topic.trim();

  return (
    <aside
      aria-label="AI assist"
      style={{
        position: 'fixed',
        top: 56,
        right: 0,
        bottom: 0,
        width: 392,
        background: 'var(--surface, #fff)',
        borderLeft: '1px solid var(--line, #E3E6EB)',
        boxShadow: '-18px 0 44px rgba(0,0,0,.14)',
        zIndex: 60,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '13px 16px', borderBottom: '1px solid var(--line, #E3E6EB)' }}>
        <span style={{ fontWeight: 600, fontSize: 14 }}>✦ Write it for me</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <span style={{ font: mono, color: budgetColor }} title="Client-side estimate — the server enforces the real window">
            {budget.used}/{budget.max} this minute (est.)
          </span>
          <button type="button" onClick={() => ai.setOpen(false)} aria-label="Close AI panel" style={{ cursor: 'pointer', border: 'none', background: 'none', fontSize: 14, color: 'var(--ink-3, #9BA0AB)' }}>
            ✕
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {phase === 'brief' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            <div role="group" aria-label="AI mode" style={{ display: 'flex', background: 'var(--surface-2, #EDEFF3)', borderRadius: 7, padding: 2 }}>
              <button
                type="button"
                onClick={() => setMode('copy')}
                style={{ flex: 1, cursor: 'pointer', border: 'none', borderRadius: 5, padding: '6px 0', fontSize: 11, fontWeight: 600, background: mode === 'copy' ? '#fff' : 'transparent', color: mode === 'copy' ? 'var(--ink)' : 'var(--ink-2)' }}
              >
                Write the copy
              </button>
              <button
                type="button"
                onClick={() => fullModeReady && setMode('full')}
                disabled={!fullModeReady}
                title={fullModeReady ? undefined : 'Lands in the next checkpoint of this PR'}
                style={{ flex: 1, cursor: fullModeReady ? 'pointer' : 'not-allowed', border: 'none', borderRadius: 5, padding: '6px 0', fontSize: 11, fontWeight: 600, background: mode === 'full' ? '#fff' : 'transparent', color: mode === 'full' ? 'var(--ink)' : 'var(--ink-3)', opacity: fullModeReady ? 1 : 0.55 }}
              >
                Design the whole page
              </button>
            </div>
            {mode === 'full' && (
              <div style={{ fontSize: 10.5, lineHeight: 1.5, color: 'var(--ink-2, #7A8090)' }}>
                Proposes template + theme + copy together, as up to 3 complete looks — chosen only from documented
                schema values. Gates, consents, legal text, fields, verification and distribution are never touched.
              </div>
            )}

            <label style={{ fontSize: 12, fontWeight: 600 }}>
              What is this campaign?
              <textarea
                rows={2}
                value={brief.topic}
                onChange={(e) => setBrief({ ...brief, topic: e.target.value })}
                placeholder="e.g. $10 FairPrice voucher giveaway for new rewards members"
                style={{ marginTop: 3, width: '100%', boxSizing: 'border-box', border: '1px solid var(--line, #E3E6EB)', borderRadius: 7, padding: '8px 9px', fontSize: 12.5, resize: 'vertical', fontWeight: 400 }}
              />
            </label>
            <label style={{ fontSize: 12, fontWeight: 600 }}>
              Who is it for?
              <input value={brief.audience} onChange={(e) => setBrief({ ...brief, audience: e.target.value })} placeholder="e.g. young Singaporean families" style={{ marginTop: 3, width: '100%', boxSizing: 'border-box', border: '1px solid var(--line)', borderRadius: 7, padding: '8px 9px', fontSize: 12.5, fontWeight: 400 }} />
            </label>
            <label style={{ fontSize: 12, fontWeight: 600 }}>
              Objective
              <input value={brief.objective} onChange={(e) => setBrief({ ...brief, objective: e.target.value })} placeholder="e.g. maximise verified signups" style={{ marginTop: 3, width: '100%', boxSizing: 'border-box', border: '1px solid var(--line)', borderRadius: 7, padding: '8px 9px', fontSize: 12.5, fontWeight: 400 }} />
            </label>
            <label style={{ fontSize: 12, fontWeight: 600 }}>
              Must include
              <input value={brief.mustInclude} onChange={(e) => setBrief({ ...brief, mustInclude: e.target.value })} placeholder="e.g. while stocks last" style={{ marginTop: 3, width: '100%', boxSizing: 'border-box', border: '1px solid var(--line)', borderRadius: 7, padding: '8px 9px', fontSize: 12.5, fontWeight: 400 }} />
            </label>
            <div role="group" aria-label="Tone" style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
              {AI_TONES.map((tone) => {
                const active = brief.tone === tone;
                return (
                  <button key={tone} type="button" onClick={() => setBrief({ ...brief, tone })} style={{ cursor: 'pointer', border: `1.5px solid ${active ? 'var(--accent, #4059C8)' : 'var(--line, #E3E6EB)'}`, background: active ? 'var(--accent-soft, #ECEFFA)' : '#fff', color: active ? 'var(--accent, #2E3F94)' : 'var(--ink-2)', borderRadius: 999, padding: '5px 11px', fontSize: 11, fontWeight: 600 }}>
                    {tone}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={ai.generate}
              disabled={genDisabled}
              className="av2-btn av2-btn--primary"
              style={{ justifyContent: 'center', opacity: genDisabled ? 0.5 : 1 }}
            >
              {mode === 'full' ? 'Generate looks' : 'Generate suggestions'}
            </button>
            <div style={{ fontSize: 10, color: 'var(--ink-3, #9BA0AB)', textAlign: 'center' }}>
              Singapore English · respects every field limit · never applies without your review
            </div>
          </div>
        )}

        {(phase === 'loading' || phase === 'looksLoading') && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }} data-testid="ai-loading">
            <div style={{ fontSize: 12, color: 'var(--ink-2, #7A8090)' }}>
              {phase === 'looksLoading'
                ? 'Drafting up to 3 complete looks — template + theme + copy, one budget call…'
                : scope
                  ? `Drafting a suggestion for ${scope.label}…`
                  : 'Drafting against your current template…'}
            </div>
            {[1, 2, 3, 4, 5].map((k) => (
              <div key={k} className="av2-skeleton" style={{ height: 52, borderRadius: 8 }} />
            ))}
          </div>
        )}

        {phase === 'error' && (
          <div style={{ background: '#FBE9E7', color: '#8F2F28', borderRadius: 9, padding: '12px 13px', fontSize: 12.5, lineHeight: 1.5 }}>
            {error}
            <div style={{ marginTop: 9 }}>
              <button type="button" onClick={ai.generate} className="av2-btn av2-btn--danger av2-btn--sm">
                Try again
              </button>
            </div>
          </div>
        )}

        {phase === 'rate' && (
          <div style={{ background: '#F8EED8', color: '#7A5A0B', borderRadius: 9, padding: '12px 13px', fontSize: 12.5, lineHeight: 1.5 }}>
            Rate limit reached — the AI endpoint allows ~10 requests a minute. Try again in <strong>{retryIn}s</strong>.
          </div>
        )}

        {phase === 'ready' && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'var(--ink-2, #7A8090)' }}>
                {scope ? `Scoped suggestion — ${scope.label}` : `${sugs.length} fields drafted — nothing applied yet`}
              </span>
              <button type="button" onClick={ai.backToBrief} style={{ cursor: 'pointer', border: 'none', background: 'none', color: 'var(--accent, #4059C8)', fontSize: 11 }}>
                Edit brief
              </button>
            </div>
            {sugs.map((row, i) => {
              const blocked = !!row.disabledReason;
              const stateLabel = row.state === 'applied' ? '✓ APPLIED' : row.state === 'kept' ? 'KEPT YOURS' : blocked ? 'UNAVAILABLE' : '';
              return (
                <div key={row.path} data-testid={`ai-sug-${row.path}`} style={{ background: 'var(--surface-2, #F7F8FA)', border: `1px solid ${row.state === 'applied' ? '#BFD9C6' : 'var(--line, #E3E6EB)'}`, borderRadius: 9, padding: '10px 11px', opacity: blocked && row.state === 'open' ? 0.75 : 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                    <span style={{ font: mono, color: 'var(--ink-3, #9BA0AB)' }}>
                      {row.section.toUpperCase()} · {row.label}
                    </span>
                    <span style={{ fontSize: 9.5, fontWeight: 600, color: row.state === 'applied' ? '#1F7A46' : 'var(--ink-3)' }}>{stateLabel}</span>
                  </div>
                  {row.old ? (
                    <div style={{ fontSize: 11, color: 'var(--ink-3, #9BA0AB)', textDecoration: 'line-through', marginBottom: 3, whiteSpace: 'pre-line' }}>{row.old}</div>
                  ) : null}
                  <div style={{ fontSize: 12.5, lineHeight: 1.5, whiteSpace: 'pre-line', marginBottom: 8 }}>{row.value}</div>
                  {blocked ? (
                    <div style={{ fontSize: 10.5, color: '#8A5B07', marginBottom: 8 }}>{row.disabledReason}</div>
                  ) : null}
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button type="button" className="av2-btn av2-btn--primary av2-btn--sm" disabled={row.state !== 'open' || blocked} onClick={() => ai.acceptRow(i)}>
                      Accept
                    </button>
                    <button type="button" className="av2-btn av2-btn--ghost av2-btn--sm" disabled={row.state === 'kept'} onClick={() => ai.keepRow(i)}>
                      Keep mine
                    </button>
                    <button type="button" className="av2-btn av2-btn--ghost av2-btn--sm" title="Regenerate this field" onClick={() => ai.regenRow(i)} style={{ marginLeft: 'auto' }}>
                      ↻
                    </button>
                  </div>
                </div>
              );
            })}
            <div style={{ display: 'flex', gap: 8, position: 'sticky', bottom: 0, background: 'var(--surface, #fff)', padding: '8px 0' }}>
              <button type="button" className="av2-btn av2-btn--primary" style={{ flex: 1, justifyContent: 'center' }} onClick={ai.applyAll}>
                Apply all remaining
              </button>
              <button type="button" className="av2-btn av2-btn--ghost" onClick={ai.discard}>
                Discard
              </button>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
