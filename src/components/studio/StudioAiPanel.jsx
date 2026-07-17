import { useMemo } from 'react';
import { AI_TONES } from './useStudioAi';
import { buildLookDoc, lookBlockedReason } from './studioLooks';
import DeviceFrame from './DeviceFrame';
import CanvasPageSubject from './CanvasPageSubject';

/**
 * "✦ Write it for me" — the Studio AI panel (PR 4), the mock's 392px right
 * slide-in. Views: brief (mode toggle + tone chips), loading skeletons,
 * copy review (struck-through old values, accept / keep-mine / ↻, sticky
 * apply-all), looks gallery (LIVE mini-previews — the real renderer inside a
 * DeviceFrame, fed each look's composed doc), proposal (keep-my-template/
 * theme/copy + Adopt/Discard), error retry, 429 countdown.
 */

const mono = "500 10px ui-monospace, 'SF Mono', Menlo, monospace";

const TEMPLATE_NAMES = {
  editorial: 'Editorial',
  poster: 'Poster',
  split: 'Split',
  spotlight: 'Spotlight',
  express: 'Express',
  journey: 'Journey',
};

/** Mini device preview — true 390-wide viewport scaled down, inert. */
function LookPreview({ campaign, lookDoc }) {
  return (
    <div style={{ pointerEvents: 'none', flexShrink: 0 }} aria-hidden="true">
      <DeviceFrame width={390} height={620} scale={0.34} ariaLabel="Look preview">
        <CanvasPageSubject campaign={campaign} doc={lookDoc} jump={null} />
      </DeviceFrame>
    </div>
  );
}

export default function StudioAiPanel({ ai, campaign, doc }) {
  const { mode, setMode, phase, brief, setBrief, sugs, scope, looks, proposal, error, retryIn, budget } = ai;

  // Looks always compose against the PRE-proposal doc mid-proposal (the
  // mock's rule: regenerating looks starts from the previous design).
  const lookBase = proposal ? proposal.prev.doc : doc;
  const lookDocs = useMemo(
    () => (looks || []).map((look) => (lookBase ? buildLookDoc(lookBase, look, {}) : null)),
    [looks, lookBase]
  );

  if (!ai.open) return null;

  const budgetColor = budget.used >= 8 ? '#B97D10' : '#9BA0AB';
  const genDisabled = !brief.topic.trim();
  const spotlightExcluded = doc ? lookBlockedReason(doc, { template: { id: 'spotlight' } }) : null;
  const retry = mode === 'full' ? ai.generateLooks : ai.generate;

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
                onClick={() => setMode('full')}
                style={{ flex: 1, cursor: 'pointer', border: 'none', borderRadius: 5, padding: '6px 0', fontSize: 11, fontWeight: 600, background: mode === 'full' ? '#fff' : 'transparent', color: mode === 'full' ? 'var(--ink)' : 'var(--ink-2)' }}
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
              onClick={retry}
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
            {(phase === 'looksLoading' ? [1, 2, 3] : [1, 2, 3, 4, 5]).map((k) => (
              <div key={k} className="av2-skeleton" style={{ height: phase === 'looksLoading' ? 120 : 52, borderRadius: 8 }} />
            ))}
          </div>
        )}

        {phase === 'error' && (
          <div style={{ background: '#FBE9E7', color: '#8F2F28', borderRadius: 9, padding: '12px 13px', fontSize: 12.5, lineHeight: 1.5 }}>
            {error}
            <div style={{ marginTop: 9 }}>
              <button type="button" onClick={retry} className="av2-btn av2-btn--danger av2-btn--sm">
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
                {proposal?.adopted
                  ? `Look adopted — review each field (save commits it)`
                  : scope
                    ? `Scoped suggestion — ${scope.label}`
                    : `${sugs.length} fields drafted — nothing applied yet`}
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

        {phase === 'looks' && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'var(--ink-2, #7A8090)' }}>
                {looks.length ? `${looks.length} look${looks.length > 1 ? 's' : ''} — nothing applied yet` : 'No usable looks came back.'}
              </span>
              <button type="button" onClick={ai.backToBrief} style={{ cursor: 'pointer', border: 'none', background: 'none', color: 'var(--accent, #4059C8)', fontSize: 11 }}>
                Edit brief
              </button>
            </div>
            {looks.map((look, i) => {
              const blocked = doc ? lookBlockedReason(doc, look) : null;
              const busy = ai.regeningLook === i;
              return (
                <div key={`${look.name}-${i}`} data-testid={`ai-look-${i}`} style={{ background: 'var(--surface-2, #F7F8FA)', border: '1px solid var(--line, #E3E6EB)', borderRadius: 10, padding: 10, display: 'flex', gap: 10 }}>
                  {lookDocs[i] ? <LookPreview campaign={campaign} lookDoc={lookDocs[i]} /> : null}
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div>
                      <div style={{ fontSize: 12.5, fontWeight: 700 }}>{look.name}</div>
                      <div style={{ font: mono, color: 'var(--ink-3, #9BA0AB)', marginTop: 2 }}>
                        {(TEMPLATE_NAMES[look.template?.id] || look.template?.id || '').toUpperCase()}
                        {look.theme?.preset ? ` · ${look.theme.preset}` : ''}
                      </div>
                    </div>
                    <div style={{ fontSize: 11, lineHeight: 1.5, color: 'var(--ink-2, #5B616E)' }}>{look.rationale}</div>
                    {look.media?.note ? (
                      <div style={{ fontSize: 10.5, lineHeight: 1.45, color: '#8A5B07' }}>✦ Art direction: {look.media.note}</div>
                    ) : null}
                    {blocked ? <div style={{ fontSize: 10.5, color: '#8A5B07' }}>{blocked}</div> : null}
                    <div style={{ display: 'flex', gap: 6, marginTop: 'auto' }}>
                      <button type="button" className="av2-btn av2-btn--primary av2-btn--sm" disabled={!!blocked || busy} onClick={() => ai.pickLook(i)}>
                        Use this look
                      </button>
                      <button type="button" className="av2-btn av2-btn--ghost av2-btn--sm" title="Regenerate this look" disabled={busy} onClick={() => ai.regenLook(i)}>
                        {busy ? '…' : '↻'}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
            {spotlightExcluded && looks.length ? (
              <div style={{ fontSize: 10, color: 'var(--ink-3, #9BA0AB)' }}>
                Spotlight looks are excluded while the quiz is off.
              </div>
            ) : null}
          </>
        )}

        {phase === 'proposal' && proposal && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ background: 'var(--accent-soft, #ECEFFA)', border: '1px solid var(--accent, #4059C8)', borderRadius: 10, padding: '10px 12px' }}>
              <div style={{ font: mono, color: 'var(--accent, #2E3F94)' }}>PROPOSAL — UNCOMMITTED</div>
              <div style={{ fontSize: 13, fontWeight: 700, marginTop: 3 }}>{proposal.look.name}</div>
              <div style={{ fontSize: 11, lineHeight: 1.5, color: 'var(--ink-2, #5B616E)', marginTop: 4 }}>{proposal.look.rationale}</div>
              {proposal.look.media?.note ? (
                <div style={{ fontSize: 10.5, lineHeight: 1.45, color: '#8A5B07', marginTop: 5 }}>
                  ✦ Art direction (never auto-applied): {proposal.look.media.note}
                </div>
              ) : null}
            </div>

            <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--ink-2, #5B616E)' }}>
              The canvas is showing this look. Keep parts of yours:
            </div>
            {[
              ['template', `Keep my template (${TEMPLATE_NAMES[proposal.prev.doc?.template?.id] || proposal.prev.doc?.template?.id || 'Editorial'})`],
              ['theme', `Keep my theme (${proposal.prev.doc?.theme?.preset || 'preset'})`],
              ['copy', 'Keep my copy'],
            ].map(([key, label]) => (
              <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer' }}>
                <input type="checkbox" checked={proposal.keep[key]} onChange={() => ai.toggleKeep(key)} />
                {label}
              </label>
            ))}

            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <button type="button" className="av2-btn av2-btn--primary" style={{ flex: 1, justifyContent: 'center' }} onClick={ai.adoptLook}>
                Adopt this look
              </button>
              <button type="button" className="av2-btn av2-btn--ghost" onClick={ai.revertLook}>
                Discard
              </button>
            </div>
            <div style={{ fontSize: 10, color: 'var(--ink-3, #9BA0AB)' }}>
              Adopting keeps it editable; nothing persists until you save. Discard restores your previous design.
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
