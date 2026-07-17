import { STARTER_QUIZ, BLANK_QUIZ } from '@/components/campaigns/editor/QuizPanel';
import {
  flattenQuestions,
  updateQuestion,
  removeQuestion,
  addQuestion,
  updateOption,
  addOption,
  removeOption,
  isSimpleScores,
  setOptionProfile,
  addProfile,
  updateProfile,
  removeProfile,
  profileReferenceCounts,
} from '../studioQuizView';
import { makeBind, PanelSection, TextField, TextAreaField, Seg, ToggleRow, WarnNote, FieldLabel } from './panelKit';

/**
 * Quiz panel (Studio PR 3) — the editing view over the VERBATIM stored quiz
 * (steps[].questions[].options[].scores · scoring · resultProfiles). The
 * server re-scores from this exact shape, so nothing here restructures
 * storage; helpers in studioQuizView keep referential integrity on profile
 * removal (atomic strip of profileOrder + rankFactor + every option score).
 *
 * §03 STATIC row: per-option images, score matrices (rankFactor), lead-score
 * points/bands stay documented-but-read-only (the starter ships them).
 */

export default function StudioQuizPanel({ doc, campaign, setPath }) {
  const bind = makeBind(doc, setPath);
  const quiz = doc.quiz;
  const setQuiz = (next) => setPath('quiz', next);

  if (!quiz) {
    return (
      <div data-testid="panel-quiz">
        <PanelSection title="QUIZ" first>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--ink-2, #5B616E)', lineHeight: 1.55 }}>
            No quiz on this campaign yet. Start from the validated Protection Personality starter — tested copy,
            scoring and personas you can reshape — or from a blank quiz.
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="av2-btn av2-btn--primary av2-btn--sm" onClick={() => setQuiz(structuredClone(STARTER_QUIZ))}>
              Load starter
            </button>
            <button type="button" className="av2-btn av2-btn--ghost av2-btn--sm" onClick={() => setQuiz(structuredClone(BLANK_QUIZ))}>
              Start blank
            </button>
          </div>
        </PanelSection>
      </div>
    );
  }

  const profiles = quiz.resultProfiles || [];
  const rows = flattenQuestions(quiz);
  const scoring = quiz.scoring || {};

  const confirmRemoveProfile = (p) => {
    const refs = profileReferenceCounts(quiz, p.id);
    const detail = `${refs.optionScores} option score${refs.optionScores === 1 ? '' : 's'}, ${refs.rankFactor ? 'a readiness rank factor, ' : ''}${refs.profileOrder ? 'the tie-break order' : ''}`;

    if (window.confirm(`Remove “${p.title || p.id}”? This also removes its references (${detail}).`)) {
      setQuiz(removeProfile(quiz, p.id));
    }
  };

  return (
    <div data-testid="panel-quiz">
      <PanelSection title="QUIZ" first>
        <ToggleRow
          id="studio-quiz-enabled"
          label="Quiz in front of the form"
          hint="Persona quiz → reveal → contact form"
          checked={quiz.enabled === true}
          onChange={(v) => setPath('quiz.enabled', v)}
        />
        {campaign?.type === 'quiz' && quiz.enabled !== true ? (
          <WarnNote tone="bad">This is a QUIZ campaign but the quiz is disabled — the page falls back to a plain form.</WarnNote>
        ) : null}
        {quiz.enabled === true && rows.length === 0 ? (
          <WarnNote tone="bad">Quiz is enabled with zero questions.</WarnNote>
        ) : null}
      </PanelSection>

      <PanelSection title="INTRO">
        <TextField id="studio-quiz-intro-h" label="Headline" bind={bind('quiz.intro.headline', 80)} />
        <TextAreaField id="studio-quiz-intro-s" label="Subhead" bind={bind('quiz.intro.subhead', 160)} rows={2} />
        <TextField id="studio-quiz-intro-cta" label="Start button label" bind={bind('quiz.intro.ctaLabel', 40)} placeholder="Start" />
      </PanelSection>

      <PanelSection title="SCORING & REVEAL">
        <Seg
          label="Tie-break"
          options={[
            { value: 'prepared-first', label: 'Prepared-first' },
            { value: 'gap-first', label: 'Gap-first' },
          ]}
          value={scoring.tiebreak || 'prepared-first'}
          onChange={(v) => setPath('quiz.scoring.tiebreak', v)}
        />
        <ToggleRow
          id="studio-quiz-readiness"
          label="Readiness % meter"
          checked={scoring.readiness?.enabled === true}
          onChange={(v) => setPath('quiz.scoring.readiness.enabled', v)}
        />
        {scoring.readiness?.enabled === true ? (
          <TextField id="studio-quiz-readiness-label" label="Meter label" bind={bind('quiz.scoring.readiness.label', 40)} placeholder="Readiness" />
        ) : null}
        <ToggleRow
          id="studio-quiz-leadscore"
          label="Lead-score bands (internal)"
          hint="Hot/Warm/Cool from answer tags — agent-facing only"
          checked={scoring.leadScore?.enabled === true}
          onChange={(v) => setPath('quiz.scoring.leadScore.enabled', v)}
        />
        <TextField id="studio-quiz-gap" label="Gap line template ({gap} = %)" bind={bind('quiz.reveal.gapTemplate', 120)} placeholder="Still about {gap}% to optimise." />
        <ToggleRow
          id="studio-quiz-alwaysgap"
          label="Always show the gap line"
          checked={quiz.reveal?.alwaysShowGap === true}
          onChange={(v) => setPath('quiz.reveal.alwaysShowGap', v)}
        />
        <ToggleRow
          id="studio-quiz-rarity"
          label="Rarity line (“About 1 in N share your result”)"
          checked={quiz.reveal?.rarityEnabled === true}
          onChange={(v) => setPath('quiz.reveal.rarityEnabled', v)}
        />
        <TextField id="studio-quiz-value" label="Value-exchange line" bind={bind('quiz.reveal.valueExchange', 160)} />
        <TextField id="studio-quiz-ctasub" label="CTA subtext" bind={bind('quiz.reveal.ctaSubtext', 120)} />
        <WarnNote tone="info">
          Advanced keys stay as stored (starter ships them): per-option images, readiness rank factors, lead-score
          tag points &amp; bands — view them in the JSON panel.
        </WarnNote>
      </PanelSection>

      <PanelSection title={`RESULT PROFILES · ${profiles.length}`}>
        {profiles.map((p) => (
          <div key={p.id} style={{ border: '1px solid var(--line, #E3E6EB)', borderRadius: 10, padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                aria-label={`Profile title ${p.id}`}
                type="text"
                value={p.title || ''}
                maxLength={40}
                placeholder="Profile title"
                onChange={(e) => setQuiz(updateProfile(quiz, p.id, { title: e.target.value }))}
                style={{ flex: 1, height: 30, padding: '0 9px', borderRadius: 7, border: '1px solid var(--line-strong, #C6CAD2)', fontSize: 12.5, fontWeight: 600 }}
              />
              <input
                aria-label={`Profile color ${p.id}`}
                type="color"
                value={/^#[0-9a-fA-F]{6}$/.test(p.themeColor || '') ? p.themeColor : '#D17029'}
                onChange={(e) => setQuiz(updateProfile(quiz, p.id, { themeColor: e.target.value }))}
                style={{ width: 30, height: 30, padding: 0, border: '1px solid var(--line)', borderRadius: 7, background: 'none', cursor: 'pointer' }}
              />
              <button type="button" className="av2-btn av2-btn--ghost av2-btn--sm" aria-label={`Remove profile ${p.title || p.id}`} onClick={() => confirmRemoveProfile(p)}>
                ✕
              </button>
            </div>
            <textarea
              aria-label={`Profile description ${p.id}`}
              rows={2}
              maxLength={400}
              value={p.description || ''}
              placeholder="Description shown on the reveal"
              onChange={(e) => setQuiz(updateProfile(quiz, p.id, { description: e.target.value }))}
              style={{ width: '100%', boxSizing: 'border-box', padding: '7px 9px', borderRadius: 7, border: '1px solid var(--line-strong, #C6CAD2)', fontSize: 12, resize: 'vertical' }}
            />
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                aria-label={`Profile CTA ${p.id}`}
                type="text"
                value={p.ctaLabel || ''}
                maxLength={40}
                placeholder="Reveal CTA"
                onChange={(e) => setQuiz(updateProfile(quiz, p.id, { ctaLabel: e.target.value }))}
                style={{ flex: 1, height: 28, padding: '0 9px', borderRadius: 7, border: '1px solid var(--line-strong, #C6CAD2)', fontSize: 11.5 }}
              />
              <input
                aria-label={`Profile agent angle ${p.id}`}
                type="text"
                value={p.agentAngle || ''}
                maxLength={80}
                placeholder="Agent angle (internal)"
                onChange={(e) => setQuiz(updateProfile(quiz, p.id, { agentAngle: e.target.value }))}
                style={{ flex: 1.4, height: 28, padding: '0 9px', borderRadius: 7, border: '1px solid var(--line-strong, #C6CAD2)', fontSize: 11.5 }}
              />
            </div>
          </div>
        ))}
        <button type="button" className="av2-btn av2-btn--ghost av2-btn--sm" onClick={() => setQuiz(addProfile(quiz))}>
          + Add profile
        </button>
      </PanelSection>

      <PanelSection title={`QUESTIONS · ${rows.length}`}>
        {rows.map(({ stepIndex, questionIndex, question }, displayIdx) => (
          <div key={question.id || `${stepIndex}-${questionIndex}`} style={{ border: '1px solid var(--line, #E3E6EB)', borderRadius: 10, padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ fontSize: 10, color: 'var(--ink-3)', fontVariantNumeric: 'tabular-nums' }}>Q{displayIdx + 1}</span>
              <input
                aria-label={`Question prompt ${displayIdx + 1}`}
                type="text"
                value={question.prompt || ''}
                maxLength={140}
                placeholder="Question prompt"
                onChange={(e) => setQuiz(updateQuestion(quiz, stepIndex, questionIndex, { prompt: e.target.value }))}
                style={{ flex: 1, height: 30, padding: '0 9px', borderRadius: 7, border: '1px solid var(--line-strong, #C6CAD2)', fontSize: 12.5 }}
              />
              <label style={{ fontSize: 10, color: 'var(--ink-3)' }}>
                w
                <input
                  aria-label={`Question weight ${displayIdx + 1}`}
                  type="number"
                  min={1}
                  max={5}
                  value={question.weight ?? 1}
                  onChange={(e) => setQuiz(updateQuestion(quiz, stepIndex, questionIndex, { weight: Number(e.target.value) || 1 }))}
                  style={{ width: 40, height: 28, marginLeft: 3, padding: '0 5px', borderRadius: 7, border: '1px solid var(--line-strong)', fontSize: 11.5 }}
                />
              </label>
              <button type="button" className="av2-btn av2-btn--ghost av2-btn--sm" aria-label={`Remove question ${displayIdx + 1}`} onClick={() => setQuiz(removeQuestion(quiz, stepIndex, questionIndex))}>
                ✕
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {(question.options || []).map((opt, oi) => (
                <div key={opt.id || oi} style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                  <input
                    aria-label={`Q${displayIdx + 1} option ${oi + 1} label`}
                    type="text"
                    value={opt.label || ''}
                    maxLength={80}
                    placeholder={`Option ${oi + 1}`}
                    onChange={(e) => setQuiz(updateOption(quiz, stepIndex, questionIndex, oi, { label: e.target.value }))}
                    style={{ flex: 1.4, height: 28, padding: '0 8px', borderRadius: 7, border: '1px solid var(--line-strong, #C6CAD2)', fontSize: 11.5 }}
                  />
                  {isSimpleScores(opt) ? (
                    <select
                      aria-label={`Q${displayIdx + 1} option ${oi + 1} profile`}
                      value={Object.keys(opt.scores || {})[0] || ''}
                      onChange={(e) => setQuiz(setOptionProfile(quiz, stepIndex, questionIndex, oi, e.target.value || null))}
                      style={{ flex: 1, height: 28, borderRadius: 7, border: '1px solid var(--line-strong, #C6CAD2)', fontSize: 11 }}
                    >
                      <option value="">— profile —</option>
                      {profiles.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.title || p.id}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span
                      title="This option carries a multi-profile score map — edit via JSON to avoid destroying weights."
                      style={{ flex: 1, fontSize: 10, color: 'var(--ink-3)', textAlign: 'center' }}
                    >
                      advanced scores
                    </span>
                  )}
                  <input
                    aria-label={`Q${displayIdx + 1} option ${oi + 1} tag`}
                    type="text"
                    value={opt.tag || ''}
                    maxLength={40}
                    placeholder="tag"
                    onChange={(e) => setQuiz(updateOption(quiz, stepIndex, questionIndex, oi, { tag: e.target.value || undefined }))}
                    style={{ width: 74, height: 28, padding: '0 7px', borderRadius: 7, border: '1px solid var(--line-strong, #C6CAD2)', fontSize: 10.5, fontFamily: 'var(--font-mono)' }}
                  />
                  <button type="button" className="av2-btn av2-btn--ghost av2-btn--sm" aria-label={`Remove Q${displayIdx + 1} option ${oi + 1}`} onClick={() => setQuiz(removeOption(quiz, stepIndex, questionIndex, oi))}>
                    ✕
                  </button>
                </div>
              ))}
              <button type="button" className="av2-btn av2-btn--ghost av2-btn--sm" style={{ alignSelf: 'flex-start' }} onClick={() => setQuiz(addOption(quiz, stepIndex, questionIndex))}>
                + option
              </button>
            </div>
          </div>
        ))}
        <button type="button" className="av2-btn av2-btn--ghost av2-btn--sm" onClick={() => setQuiz(addQuestion(quiz))}>
          + Add question
        </button>
        <FieldLabel>The preview quiz is fully playable — jump to “Quiz intro” in the canvas and tap through.</FieldLabel>
      </PanelSection>
    </div>
  );
}
