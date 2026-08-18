import { useState } from 'react';
import { makeBind, PanelSection, TextField, TextAreaField, Seg, ToggleRow, WarnNote } from './panelKit';
import { PROFILE_QUESTION_LIBRARY, getProfileQuestion } from '@/lib/profileQuestionLibrary';
import { suggestProfileQuestions } from '@/lib/campaignBrief';
import { LIMITS, MAX_CUSTOM_OPTIONS, MAX_CUSTOM_QUESTIONS, sanitizeQuestionText } from '@/lib/designConfigV2';
import {
  commitDraftTransform,
  draftComplete,
  draftToDef,
  emptyCustomQuestionDraft,
  genCustomQuestionId,
  mutatePQ,
  nextOptionId,
} from '../profileQuestionsModel';

/**
 * Form panel (Studio PR 3) — fields order/visibility/required with 2-col
 * merge/split, verification channel, eligibility gates (+ advertiserName,
 * placed beside the DNC switch per handoff §03), campaign T&Cs.
 *
 * Field mechanics mirror the mock exactly: reordering or hiding a field
 * clears its row pairing; merge offers only for ADJACENT, VISIBLE, compact,
 * unpaired fields; name/email/phone stay pinned (always shown + required —
 * the server clamp forces them anyway).
 */

const FIELD_DEFS = {
  name: { label: 'Full Name', compact: false, locked: true },
  email: { label: 'Email', compact: false, locked: true },
  phone: { label: 'Mobile Number', compact: false, locked: true, pin: 'Always shown · Required for OTP' },
  dob: { label: 'Date of Birth', compact: true },
  postal: { label: 'Postal Code', compact: true },
  education: { label: 'Highest Education', compact: true },
  salary: { label: 'Last Drawn Salary', compact: true },
};

let pairCounter = 0;
const pairId = () => `row-${Date.now().toString(36)}${(pairCounter += 1)}`;

// `whatsappOtpConfigured` (PR 5): the server readiness payload's env fact.
// true → creds verified, the speculative warning is noise; false/undefined →
// keep warning (fail-noisy while unknown).
// `campaignBrief`: the campaign's stored targetAudience (campaign-brief.md
// §6.4) — drives the SUGGESTED profile questions below. Suggestions are
// one-click adds, never auto-applied: enabling a question changes a live
// funnel's conversion, and that stays a human decision.
export default function FormPanel({ doc, setPath, mut, whatsappOtpConfigured, campaignBrief, cqDraft, onCqDraftChange }) {
  const bind = makeBind(doc, setPath);
  const fields = doc.form?.fields || [];
  const gates = doc.form?.gates || {};
  const verification = doc.form?.verification === 'whatsapp' ? 'whatsapp' : 'sms';
  const askedIds = doc.profileQuestions?.questionIds || [];
  const suggestions = suggestProfileQuestions(campaignBrief).filter((s) => !askedIds.includes(s.id));
  const customDefs = (Array.isArray(doc.profileQuestions?.custom) ? doc.profileQuestions.custom : [])
    .filter((q) => q && typeof q === 'object' && typeof q.id === 'string');

  // Incomplete EDITS of committed questions stay panel-local (badge shows;
  // the last complete value stays in the doc — studio-custom-questions §4).
  // NEW-question drafts live one level up (the Studio page owns cqDraft, so a
  // rail switch can't destroy them).
  const [editBuffers, setEditBuffers] = useState({});

  // Every profileQuestions write goes through the ONE mutation door
  // (profileQuestionsModel.mutatePQ) — the old per-site rebuilds were lossy
  // (the master toggle dropped requiredIds/showZh; library/suggestion writes
  // would have deleted custom state).
  const addSuggestedQuestion = (id) => mutatePQ(mut, (s) => {
    s.enabled = true; // the click is the human decision — it may switch the section on
    if (!s.libraryPicks.includes(id)) s.libraryPicks.push(id);
    return s;
  });

  const mutFields = (fn) => mut((d) => fn(d.form.fields));

  const clearPair = (list, rowId) => {
    if (!rowId) return;
    list.forEach((f) => {
      if (f.row === rowId) f.row = null;
    });
  };

  return (
    <div data-testid="panel-form">
      <PanelSection title="FIELDS — ORDER · VISIBILITY · REQUIRED" first>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {fields.map((f, i) => {
            const def = FIELD_DEFS[f.id] || { label: f.id };
            const next = fields[i + 1];
            const canMerge =
              def.compact && f.visible && !f.row && next && (FIELD_DEFS[next.id] || {}).compact && next.visible && !next.row;
            return (
              <div
                key={f.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '7px 8px',
                  borderRadius: 8,
                  border: '1px solid var(--line, #E3E6EB)',
                  borderLeft: `3px solid ${f.row ? 'var(--accent, #4059C8)' : f.visible ? 'var(--line-strong, #C6CAD2)' : 'var(--line, #EDEFF3)'}`,
                  opacity: f.visible ? 1 : 0.55,
                  background: 'var(--surface, #fff)',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink, #171A20)' }}>
                    {def.label}
                    {f.row ? <span style={{ fontSize: 9.5, color: 'var(--accent, #4059C8)', marginLeft: 6 }}>paired</span> : null}
                  </div>
                  {def.locked ? (
                    <div style={{ fontSize: 9.5, color: 'var(--ink-3, #9BA0AB)' }}>{def.pin || 'Always shown · Always required'}</div>
                  ) : null}
                </div>
                <button
                  type="button"
                  aria-label={`Move ${def.label} up`}
                  disabled={i === 0}
                  className="av2-btn av2-btn--ghost av2-btn--sm"
                  onClick={() =>
                    mutFields((list) => {
                      clearPair(list, list[i].row);
                      clearPair(list, list[i - 1].row);
                      [list[i - 1], list[i]] = [list[i], list[i - 1]];
                    })
                  }
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={`Move ${def.label} down`}
                  disabled={i === fields.length - 1}
                  className="av2-btn av2-btn--ghost av2-btn--sm"
                  onClick={() =>
                    mutFields((list) => {
                      clearPair(list, list[i].row);
                      clearPair(list, list[i + 1].row);
                      [list[i + 1], list[i]] = [list[i], list[i + 1]];
                    })
                  }
                >
                  ↓
                </button>
                <label style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10.5, color: 'var(--ink-2)' }}>
                  <input
                    type="checkbox"
                    aria-label={`${def.label} visible`}
                    checked={f.visible === true}
                    disabled={!!def.locked}
                    onChange={(e) =>
                      mutFields((list) => {
                        list[i].visible = e.target.checked;
                        if (!e.target.checked) clearPair(list, list[i].row);
                      })
                    }
                  />
                  shown
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10.5, color: def.locked ? 'var(--ink-3)' : 'var(--ink-2)' }}>
                  <input
                    type="checkbox"
                    aria-label={`${def.label} required`}
                    checked={def.locked ? true : f.required === true}
                    disabled={!!def.locked}
                    onChange={(e) => mutFields((list) => { list[i].required = e.target.checked; })}
                  />
                  req
                </label>
                {canMerge ? (
                  <button
                    type="button"
                    className="av2-btn av2-btn--ghost av2-btn--sm"
                    title={`Pair with ${(FIELD_DEFS[next.id] || {}).label} on one row`}
                    onClick={() =>
                      mutFields((list) => {
                        const id = pairId();
                        list[i].row = id;
                        list[i + 1].row = id;
                      })
                    }
                  >
                    ⇤⇥
                  </button>
                ) : null}
                {f.row ? (
                  <button
                    type="button"
                    className="av2-btn av2-btn--ghost av2-btn--sm"
                    title="Split back to full-width rows"
                    onClick={() => mutFields((list) => clearPair(list, list[i].row))}
                  >
                    split
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
        <p style={{ margin: 0, fontSize: 10.5, color: 'var(--ink-3, #9BA0AB)' }}>
          Paired fields share one row on desktop and stack on phones. Hidden fields keep their place, dimmed.
        </p>
      </PanelSection>

      <PanelSection title="VERIFICATION">
        <Seg
          ariaLabel="Verification channel"
          options={[
            { value: 'sms', label: 'SMS OTP' },
            { value: 'whatsapp', label: 'WhatsApp OTP' },
          ]}
          value={verification}
          onChange={(v) => setPath('form.verification', v)}
        />
        {verification === 'whatsapp' && whatsappOtpConfigured !== true ? (
          <WarnNote>WhatsApp verification needs configured Meta credentials (server env); without them sends fall back to SMS.</WarnNote>
        ) : null}
        {verification === 'whatsapp' && whatsappOtpConfigured === true ? (
          <WarnNote tone="info">✓ WhatsApp credentials are configured on the server.</WarnNote>
        ) : null}
      </PanelSection>

      <PanelSection title="PROFILE QUESTIONS">
        {/* Enrichment collection block (studio-profile-questions §3): library
            questions are PICKED (structured choices that build the customer
            profile); custom questions below are AUTHORED and display-only
            (studio-custom-questions §1 — answers land on the lead, never the
            fact ledger). All skippable on the funnel unless marked required.
            The AI Fill-everything flow never enables or authors any of this
            (conversion-vs-data is the owner's per-campaign call). */}
        <ToggleRow
          id="studio-profile-questions"
          label="Ask profile questions"
          hint="Optional questions after the signup fields — answers build the customer profile"
          checked={doc.profileQuestions?.enabled === true}
          onChange={(v) => mutatePQ(mut, (s) => {
            s.enabled = v === true;
            return s;
          })}
        />
        {suggestions.length > 0 && (
          <div
            data-testid="brief-question-suggestions"
            style={{ border: '1px dashed var(--line-strong, #C6CAD2)', borderRadius: 8, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}
          >
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.4, color: 'var(--ink-3, #9BA0AB)' }}>
              SUGGESTED BY THE CAMPAIGN BRIEF
            </span>
            {suggestions.map((s) => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink, #171A20)' }}>
                    {getProfileQuestion(s.id)?.prompt || s.id}
                  </div>
                  <div style={{ fontSize: 10.5, color: 'var(--ink-3, #9BA0AB)' }}>{s.reason}</div>
                </div>
                <button
                  type="button"
                  className="av2-btn av2-btn--ghost av2-btn--sm"
                  data-testid={`brief-suggest-add-${s.id}`}
                  onClick={() => addSuggestedQuestion(s.id)}
                >
                  + Add
                </button>
              </div>
            ))}
            <span style={{ fontSize: 10, color: 'var(--ink-3, #9BA0AB)' }}>
              Suggestions only — each question changes conversion, so adding one is always your call.
            </span>
          </div>
        )}
        {doc.profileQuestions?.enabled === true && (
          <ToggleRow
            id="studio-pq-showzh"
            label="Show Chinese text"
            hint="Off = English-only prompts on the funnel"
            checked={doc.profileQuestions?.showZh !== false}
            onChange={(v) => mutatePQ(mut, (s) => {
              s.showZh = v === true;
              return s;
            })}
          />
        )}
        {doc.profileQuestions?.enabled === true && PROFILE_QUESTION_LIBRARY.map((q) => {
          const asked = (doc.profileQuestions?.questionIds || []).includes(q.id);
          return (
            <div key={q.id}>
              <ToggleRow
                id={`studio-pq-${q.id}`}
                label={q.prompt}
                hint={q.promptZh}
                checked={asked}
                onChange={(v) => mutatePQ(mut, (s) => {
                  // Canonical library order is reconstruction's job; the clamp
                  // also drops a requiredId whose question is unasked.
                  s.libraryPicks = s.libraryPicks.filter((id) => id !== q.id);
                  if (v) s.libraryPicks.push(q.id);
                  return s;
                })}
              />
              {asked && (
                <div style={{ paddingLeft: 16 }}>
                  <ToggleRow
                    id={`studio-pq-${q.id}-required`}
                    label="Required"
                    hint="Signup blocked until answered (this campaign only)"
                    checked={(doc.profileQuestions?.requiredIds || []).includes(q.id)}
                    onChange={(v) => mutatePQ(mut, (s) => {
                      s.requiredIds = s.requiredIds.filter((id) => id !== q.id);
                      if (v) s.requiredIds.push(q.id);
                      return s;
                    })}
                  />
                </div>
              )}
            </div>
          );
        })}
        {doc.profileQuestions?.enabled === true && (
          <CustomQuestionsBlock
            mut={mut}
            customDefs={customDefs}
            requiredIds={doc.profileQuestions?.requiredIds || []}
            editBuffers={editBuffers}
            setEditBuffers={setEditBuffers}
            cqDraft={cqDraft}
            onCqDraftChange={onCqDraftChange}
          />
        )}
      </PanelSection>

      <PanelSection title="ELIGIBILITY GATES">
        <ToggleRow
          id="studio-gate-sgpr"
          label="Singapore Citizen / PR gate"
          hint="Yes/No screening card before the form"
          checked={gates.sgPr === true}
          onChange={(v) => setPath('form.gates.sgPr', v)}
        />
        <ToggleRow
          id="studio-gate-advisor"
          label="Exclude financial advisors"
          hint="Second screening card, stacks after SG/PR"
          checked={gates.advisorExclusion === true}
          onChange={(v) => setPath('form.gates.advisorExclusion', v)}
        />
        <ToggleRow
          id="studio-gate-dnc"
          label="DNC registry check"
          hint="Post-OTP consent gate for registered numbers"
          checked={gates.dncCheck === true}
          onChange={(v) => setPath('form.gates.dncCheck', v)}
        />
        <ToggleRow
          id="studio-gate-screening"
          label="AI screening call"
          hint="Retell calls the lead after signup; only qualified leads reach an agent"
          checked={gates.screeningCall === true}
          onChange={(v) => setPath('form.gates.screeningCall', v)}
        />
        <TextField
          id="studio-advertiser-name"
          label="Advertiser display name (DNC gate)"
          bind={bind('content.advertiserName', 60)}
          placeholder="Defaults to the campaign name"
        />
      </PanelSection>

      <PanelSection title="CONSENT">
        {/* Top-level design_config key (not form.gates) — default ON, so the
            inverted read keeps legacy docs sponsored until explicitly untoggled. */}
        <ToggleRow
          id="studio-third-party-disclosure"
          label="Third-party disclosure clause"
          hint="Shows only when a NAMED sponsor is configured (this switch is the kill-switch); the agree-all block then includes sharing details with that named rep"
          checked={doc.thirdPartyDisclosure !== false}
          onChange={(v) => setPath('thirdPartyDisclosure', v)}
        />
      </PanelSection>

      <PanelSection title="TERMS & CONDITIONS">
        <Seg
          ariaLabel="Terms template"
          options={[
            { value: 'default', label: 'Default' },
            { value: 'privacy', label: 'Privacy' },
            { value: 'marketing', label: 'Marketing' },
          ]}
          value={doc.form?.terms?.template || 'default'}
          onChange={(v) =>
            mut((d) => {
              d.form.terms = { template: v, html: d.form.terms?.html ?? '' };
            })
          }
        />
        <TextAreaField id="studio-terms-html" label="Campaign T&Cs (HTML)" bind={bind('form.terms.html', 10000)} rows={7} />
        {doc.luckyDraw?.enabled === true && !(doc.form?.terms?.html || '').trim() ? (
          <WarnNote tone="bad">Lucky-draw campaigns cannot save without T&Cs (server invariant).</WarnNote>
        ) : null}
        <p style={{ margin: 0, fontSize: 10.5, color: 'var(--ink-3, #9BA0AB)' }}>
          The template picker labels the document; it never overwrites your text. Consent-checkbox copy is fixed by
          the platform and is not editable here.
        </p>
      </PanelSection>
    </div>
  );
}

// ─────────────── custom questions (studio-custom-questions §4) ───────────────

const cqInputStyle = {
  width: '100%',
  boxSizing: 'border-box',
  height: 30,
  padding: '0 9px',
  borderRadius: 8,
  border: '1px solid var(--line-strong, #C6CAD2)',
  background: 'var(--surface, #fff)',
  color: 'var(--ink, #171A20)',
  fontSize: 12,
};

const cqSubLabel = { fontSize: 10, fontWeight: 700, letterSpacing: 0.4, color: 'var(--ink-3, #9BA0AB)' };

function defToDraft(def) {
  return {
    type: def.type === 'multi' || def.type === 'text' ? def.type : 'single',
    prompt: def.prompt || '',
    promptZh: def.promptZh || '',
    options: (Array.isArray(def.options) ? def.options : []).map((o) => ({
      id: o.id,
      label: o.label || '',
      ...(o.labelZh ? { labelZh: o.labelZh } : {}),
    })),
  };
}

/** One controlled editor for both the NEW-question draft and committed-question
 * edits — prompt, optional 中文 prompt, answer style, options. */
function CustomQuestionEditor({ idPrefix, value, onChange }) {
  const set = (patch) => onChange({ ...value, ...patch });
  const setType = (type) => {
    let options = Array.isArray(value.options) ? [...value.options] : [];
    if (type !== 'text') {
      while (options.length < 2) options = [...options, { id: nextOptionId(options), label: '' }];
    }
    onChange({ ...value, type, options });
  };
  const options = Array.isArray(value.options) ? value.options : [];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <input
        id={`${idPrefix}-prompt`}
        type="text"
        aria-label="Question prompt"
        placeholder="e.g. Which showroom is closer to you?"
        maxLength={LIMITS.cqPrompt}
        style={cqInputStyle}
        value={value.prompt}
        onChange={(e) => set({ prompt: e.target.value })}
      />
      <input
        id={`${idPrefix}-prompt-zh`}
        type="text"
        aria-label="Question prompt (Chinese, optional)"
        placeholder="中文提问（可选）"
        maxLength={LIMITS.cqPrompt}
        style={cqInputStyle}
        value={value.promptZh}
        onChange={(e) => set({ promptZh: e.target.value })}
      />
      <Seg
        ariaLabel="Answer style"
        options={[
          { value: 'single', label: 'One choice' },
          { value: 'multi', label: 'Multi' },
          { value: 'text', label: 'Short text' },
        ]}
        value={value.type}
        onChange={setType}
      />
      {value.type !== 'text' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {options.map((opt, i) => (
            <div key={opt.id} style={{ display: 'flex', gap: 4 }}>
              <input
                type="text"
                aria-label={`Option ${i + 1} label`}
                placeholder={`Option ${i + 1}`}
                maxLength={LIMITS.cqOption}
                style={{ ...cqInputStyle, flex: 1 }}
                value={opt.label}
                onChange={(e) => set({
                  options: options.map((o) => (o.id === opt.id ? { ...o, label: e.target.value } : o)),
                })}
              />
              <button
                type="button"
                aria-label={`Remove option ${i + 1}`}
                className="av2-btn av2-btn--ghost av2-btn--sm"
                onClick={() => set({ options: options.filter((o) => o.id !== opt.id) })}
              >
                ✕
              </button>
            </div>
          ))}
          <button
            type="button"
            className="av2-btn av2-btn--ghost av2-btn--sm"
            disabled={options.length >= MAX_CUSTOM_OPTIONS}
            onClick={() => set({ options: [...options, { id: nextOptionId(options), label: '' }] })}
          >
            + Add option{options.length >= MAX_CUSTOM_OPTIONS ? ` (max ${MAX_CUSTOM_OPTIONS})` : ''}
          </button>
        </div>
      )}
      {value.type === 'text' && (
        <p style={{ margin: 0, fontSize: 10.5, color: 'var(--ink-3, #9BA0AB)' }}>
          Customers type a short answer (200 characters max).
        </p>
      )}
    </div>
  );
}

function CustomQuestionsBlock({ mut, customDefs, requiredIds, editBuffers, setEditBuffers, cqDraft, onCqDraftChange }) {
  const atCap = customDefs.length >= MAX_CUSTOM_QUESTIONS;

  const commitDraft = () => {
    if (!draftComplete(cqDraft) || atCap) return;
    const qid = genCustomQuestionId(customDefs.map((q) => q.id));
    mutatePQ(mut, (s) => commitDraftTransform(s, cqDraft, qid));
    onCqDraftChange?.(null);
  };

  const move = (qid, delta) => mutatePQ(mut, (s) => {
    const i = s.customOrder.indexOf(qid);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= s.customOrder.length) return s;
    [s.customOrder[i], s.customOrder[j]] = [s.customOrder[j], s.customOrder[i]];
    return s;
  });

  const remove = (qid) => {
    mutatePQ(mut, (s) => {
      s.defsById.delete(qid);
      s.customOrder = s.customOrder.filter((id) => id !== qid);
      s.requiredIds = s.requiredIds.filter((id) => id !== qid);
      return s;
    });
    setEditBuffers((prev) => {
      const { [qid]: _gone, ...rest } = prev;
      return rest;
    });
  };

  return (
    <div
      data-testid="custom-questions-block"
      style={{ borderTop: '1px dashed var(--line-strong, #C6CAD2)', paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}
    >
      <span style={cqSubLabel}>YOUR OWN QUESTIONS</span>
      <p style={{ margin: 0, fontSize: 10.5, color: 'var(--ink-3, #9BA0AB)' }}>
        Campaign-specific questions, shown after the profile questions. Answers appear on the lead — they never feed
        lead scoring or the customer profile.
      </p>
      {customDefs.map((def, i) => {
        const buffer = editBuffers[def.id];
        const editorValue = buffer || defToDraft(def);
        const incomplete = buffer && !draftComplete(buffer);
        return (
          <div
            key={def.id}
            data-testid={`custom-question-${def.id}`}
            style={{ border: '1px solid var(--line, #E3E6EB)', borderRadius: 8, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ flex: 1, minWidth: 0, fontSize: 11, fontWeight: 700, color: 'var(--ink-2, #5B616E)' }}>
                Question {i + 1}
                {incomplete ? (
                  <span style={{ marginLeft: 6, fontWeight: 600, color: '#B97D10' }}>incomplete — not saved</span>
                ) : null}
              </span>
              <button type="button" aria-label={`Move question ${i + 1} up`} disabled={i === 0} className="av2-btn av2-btn--ghost av2-btn--sm" onClick={() => move(def.id, -1)}>↑</button>
              <button type="button" aria-label={`Move question ${i + 1} down`} disabled={i === customDefs.length - 1} className="av2-btn av2-btn--ghost av2-btn--sm" onClick={() => move(def.id, 1)}>↓</button>
              <button type="button" aria-label={`Delete question ${i + 1}`} className="av2-btn av2-btn--ghost av2-btn--sm" onClick={() => remove(def.id)}>Delete</button>
            </div>
            <CustomQuestionEditor
              idPrefix={`studio-cq-${def.id}`}
              value={editorValue}
              onChange={(candidate) => {
                // Incomplete edits stay panel-local; complete edits write
                // through the mutation door with SANITIZED values, so the doc
                // always holds the last complete state (§4).
                setEditBuffers((prev) => ({ ...prev, [def.id]: candidate }));
                if (draftComplete(candidate)) {
                  mutatePQ(mut, (s) => {
                    s.defsById.set(def.id, draftToDef(candidate, def.id));
                    return s;
                  });
                }
              }}
            />
            <ToggleRow
              id={`studio-cq-${def.id}-required`}
              label="Required"
              hint="Signup blocked until answered (this campaign only)"
              checked={requiredIds.includes(def.id)}
              onChange={(v) => mutatePQ(mut, (s) => {
                s.requiredIds = s.requiredIds.filter((id) => id !== def.id);
                if (v) s.requiredIds.push(def.id);
                return s;
              })}
            />
          </div>
        );
      })}
      {cqDraft ? (
        <div
          data-testid="custom-question-draft"
          style={{ border: '1px dashed var(--accent, #4059C8)', borderRadius: 8, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}
        >
          <span style={cqSubLabel}>NEW QUESTION — NOT SAVED YET</span>
          <CustomQuestionEditor idPrefix="studio-cq-draft" value={cqDraft} onChange={(v) => onCqDraftChange?.(v)} />
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button
              type="button"
              className="av2-btn av2-btn--sm"
              data-testid="custom-question-draft-commit"
              disabled={!draftComplete(cqDraft) || atCap}
              onClick={commitDraft}
            >
              Add to form
            </button>
            <button type="button" className="av2-btn av2-btn--ghost av2-btn--sm" onClick={() => onCqDraftChange?.(null)}>
              Discard
            </button>
            {!draftComplete(cqDraft) ? (
              <span style={{ fontSize: 10.5, color: '#B97D10' }}>
                {sanitizeQuestionText(cqDraft.prompt, LIMITS.cqPrompt) ? 'Needs 2 labelled options' : 'Needs a prompt'}
              </span>
            ) : null}
          </div>
        </div>
      ) : (
        <div>
          <button
            type="button"
            className="av2-btn av2-btn--ghost av2-btn--sm"
            data-testid="custom-question-add"
            disabled={atCap}
            onClick={() => onCqDraftChange?.(emptyCustomQuestionDraft())}
          >
            + Add question
          </button>
          {atCap ? (
            <p style={{ margin: '4px 0 0', fontSize: 10.5, color: 'var(--ink-3, #9BA0AB)' }}>
              Limit of {MAX_CUSTOM_QUESTIONS} custom questions — delete one to add another.
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
