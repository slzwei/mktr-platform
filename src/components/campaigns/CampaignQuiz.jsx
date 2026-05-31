import { useState, useMemo } from 'react';
import { TOKENS, RADIUS, resolveImageUrl } from './LeadCaptureLayout';
import { scoreQuiz } from '@/lib/quizScoring';

/**
 * CampaignQuiz — the public multi-step quiz that runs in front of the lead form
 * (IG/TikTok funnel). Intro → one-question-per-screen (auto-advance) → result
 * reveal (persona, readiness meter, gap, CTA). Pure client-side; uses the client
 * scoreQuiz (the server re-scores authoritatively on submit). Styled with the
 * locked LeadCaptureLayout tokens + the campaign's themeColor so it stays on-brand.
 *
 * Renders inside the form card (as LeadCaptureLayout children). On the reveal
 * CTA it calls onComplete({ quizId, version, answers, result }); the parent then
 * shows the contact form and threads `answers` into the /api/prospects payload.
 *
 * previewMode is accepted for API symmetry with the form; the quiz has no network
 * side-effects, so it behaves identically in preview and live.
 */

const SANS = 'Albert Sans, system-ui, sans-serif';
const SERIF = 'Fraunces, serif';

export default function CampaignQuiz({ quiz, themeColor, previewMode = false, onComplete }) {
  const accent = themeColor || TOKENS.accent;
  const questions = useMemo(
    () => (quiz?.steps || []).flatMap((s) => s.questions || []),
    [quiz]
  );
  const profiles = quiz?.resultProfiles || [];
  const basePath = quiz?.media?.basePath || '';

  const [phase, setPhase] = useState('intro'); // 'intro' | 'question' | 'result'
  const [stepIdx, setStepIdx] = useState(0);
  const [answers, setAnswers] = useState([]); // [{ qid, value }]
  const [selecting, setSelecting] = useState(null); // optId being tapped (highlight)
  const [result, setResult] = useState(null);

  const optionImage = (opt) => (opt?.image ? resolveImageUrl(`${basePath}${opt.image}`) : null);

  const start = () => {
    setStepIdx(0);
    setPhase('question');
  };

  const choose = (q, optId) => {
    if (selecting) return; // debounce double-taps during the advance animation
    setSelecting(optId);
    const next = [...answers.filter((a) => a.qid !== q.id), { qid: q.id, value: optId }];
    // Brief highlight, then advance / reveal.
    setTimeout(() => {
      setAnswers(next);
      setSelecting(null);
      if (stepIdx + 1 < questions.length) {
        setStepIdx(stepIdx + 1);
      } else {
        setResult(scoreQuiz(quiz, next));
        setPhase('result');
      }
    }, 200);
  };

  const finish = () => {
    onComplete?.({ quizId: quiz?.quizId, version: quiz?.version, answers, result });
  };

  // ---------- Intro ----------
  if (phase === 'intro') {
    const intro = quiz?.intro || {};
    return (
      <div style={{ textAlign: 'center', padding: '8px 0 4px' }}>
        <h2 style={{ fontFamily: SERIF, fontWeight: 800, fontSize: 30, lineHeight: 1.1, letterSpacing: '-0.01em', color: TOKENS.ink, margin: '0 0 12px' }}>
          {intro.headline || 'Take the quiz'}
        </h2>
        {intro.subhead && (
          <p style={{ fontFamily: SANS, fontSize: 15.5, lineHeight: 1.55, color: TOKENS.body, margin: '0 auto 24px', maxWidth: 320 }}>
            {intro.subhead}
          </p>
        )}
        <PillButton accent={accent} onClick={start}>{intro.ctaLabel || 'Start'}</PillButton>
      </div>
    );
  }

  // ---------- Result reveal ----------
  if (phase === 'result') {
    const profile = profiles.find((p) => p.id === result?.profileId) || null;
    const profileColor = profile?.themeColor || accent;
    const reveal = quiz?.reveal || {};
    const readinessOn = quiz?.scoring?.readiness?.enabled !== false && typeof result?.readiness === 'number';
    const gap = readinessOn ? Math.max(0, 100 - result.readiness) : null;
    const gapText = readinessOn
      ? (reveal.gapTemplate ? reveal.gapTemplate.replace('{gap}', String(gap)) : `Still about ${gap}% to optimise.`)
      : null;

    return (
      <div style={{ textAlign: 'center', padding: '4px 0' }}>
        <p style={{ fontFamily: SANS, fontSize: 13, letterSpacing: '0.14em', textTransform: 'uppercase', color: TOKENS.muted, margin: '0 0 6px' }}>
          You are
        </p>
        <h2 style={{ fontFamily: SERIF, fontWeight: 900, fontSize: 34, lineHeight: 1.05, letterSpacing: '-0.01em', color: profileColor, margin: '0 0 4px' }}>
          {profile?.title || 'Your result'}
        </h2>
        {profile?.subtitle && (
          <p style={{ fontFamily: SANS, fontSize: 13, fontWeight: 600, color: TOKENS.muted, margin: '0 0 14px' }}>{profile.subtitle}</p>
        )}
        {optionImage(profile) && (
          <img src={optionImage(profile)} alt="" style={{ width: 120, height: 120, objectFit: 'contain', margin: '0 auto 14px', display: 'block' }} />
        )}
        {profile?.description && (
          <p style={{ fontFamily: SANS, fontSize: 15, lineHeight: 1.55, color: TOKENS.body, margin: '0 auto 18px', maxWidth: 330 }}>
            {profile.description}
          </p>
        )}

        {readinessOn && (
          <div style={{ margin: '0 auto 8px', maxWidth: 320 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
              <span style={{ fontFamily: SANS, fontSize: 12.5, color: TOKENS.muted }}>{quiz?.scoring?.readiness?.label || 'Readiness'}</span>
              <span style={{ fontFamily: SERIF, fontWeight: 800, fontSize: 18, color: profileColor }}>{result.readiness}%</span>
            </div>
            <div style={{ height: 10, borderRadius: RADIUS.pill, backgroundColor: TOKENS.hairline, overflow: 'hidden' }}>
              <div style={{ width: `${Math.min(100, Math.max(0, result.readiness))}%`, height: '100%', backgroundColor: profileColor, borderRadius: RADIUS.pill, transition: 'width 600ms ease' }} />
            </div>
            {reveal.alwaysShowGap && gapText && (
              <p style={{ fontFamily: SANS, fontSize: 12.5, color: TOKENS.muted, margin: '8px 0 0' }}>{gapText}</p>
            )}
          </div>
        )}

        {reveal.rarityEnabled && profiles.length > 0 && (
          <p style={{ fontFamily: SANS, fontSize: 12.5, color: TOKENS.muted, margin: '12px auto 0', maxWidth: 320 }}>
            About 1 in {profiles.length} share your result.
          </p>
        )}

        <div style={{ marginTop: 22 }}>
          {reveal.valueExchange && (
            <p style={{ fontFamily: SANS, fontWeight: 700, fontSize: 15, color: TOKENS.ink, margin: '0 auto 4px', maxWidth: 320 }}>
              {reveal.valueExchange}
            </p>
          )}
          {reveal.ctaSubtext && (
            <p style={{ fontFamily: SANS, fontSize: 13, color: TOKENS.body, margin: '0 auto 14px', maxWidth: 320 }}>{reveal.ctaSubtext}</p>
          )}
          <PillButton accent={profileColor} onClick={finish}>{profile?.ctaLabel || 'Continue'}</PillButton>
        </div>
      </div>
    );
  }

  // ---------- Question ----------
  const q = questions[stepIdx];
  if (!q) {
    // Defensive: malformed quiz — let the parent fall through to the form.
    return (
      <div style={{ textAlign: 'center' }}>
        <PillButton accent={accent} onClick={finish}>Continue</PillButton>
      </div>
    );
  }
  const progress = ((stepIdx + 1) / questions.length) * 100;
  const selectedForQ = answers.find((a) => a.qid === q.id)?.value;

  return (
    <div>
      {/* Progress */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
        <div style={{ flex: 1, height: 6, borderRadius: RADIUS.pill, backgroundColor: TOKENS.hairline, overflow: 'hidden' }}>
          <div style={{ width: `${progress}%`, height: '100%', backgroundColor: accent, borderRadius: RADIUS.pill, transition: 'width 300ms ease' }} />
        </div>
        <span style={{ fontFamily: SANS, fontSize: 12, fontWeight: 600, color: TOKENS.muted, whiteSpace: 'nowrap' }}>
          {stepIdx + 1} / {questions.length}
        </span>
      </div>

      <h2 style={{ fontFamily: SERIF, fontWeight: 800, fontSize: 23, lineHeight: 1.2, letterSpacing: '-0.01em', color: TOKENS.ink, margin: '0 0 18px' }}>
        {q.prompt}
      </h2>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {(q.options || []).map((opt) => {
          const isSelected = selecting === opt.id || (!selecting && selectedForQ === opt.id);
          const img = optionImage(opt);
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => choose(q, opt.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                width: '100%',
                textAlign: 'left',
                padding: img ? '10px 14px' : '14px 16px',
                borderRadius: RADIUS.image,
                border: `1.5px solid ${isSelected ? accent : TOKENS.hairline}`,
                backgroundColor: isSelected ? accent + '14' : TOKENS.formCard,
                color: TOKENS.ink,
                fontFamily: SANS,
                fontSize: 15,
                fontWeight: 500,
                lineHeight: 1.35,
                cursor: 'pointer',
                transition: 'border-color 150ms ease, background-color 150ms ease',
              }}
            >
              {img && (
                <img src={img} alt="" style={{ width: 44, height: 44, objectFit: 'contain', flexShrink: 0 }} />
              )}
              <span style={{ flex: 1 }}>{opt.label}</span>
              <span
                aria-hidden="true"
                style={{
                  width: 20,
                  height: 20,
                  flexShrink: 0,
                  borderRadius: '50%',
                  border: `2px solid ${isSelected ? accent : TOKENS.divider}`,
                  backgroundColor: isSelected ? accent : 'transparent',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#fff',
                  fontSize: 12,
                }}
              >
                {isSelected ? '✓' : ''}
              </span>
            </button>
          );
        })}
      </div>

      {previewMode && (
        <p style={{ fontFamily: SANS, fontSize: 11, color: TOKENS.muted, textAlign: 'center', marginTop: 14 }}>
          Preview — tap an answer to continue
        </p>
      )}
    </div>
  );
}

function PillButton({ accent, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        height: 54,
        paddingLeft: 30,
        paddingRight: 30,
        borderRadius: RADIUS.pill,
        backgroundColor: accent || TOKENS.accent,
        color: '#ffffff',
        border: 'none',
        fontFamily: SANS,
        fontWeight: 600,
        fontSize: 16,
        cursor: 'pointer',
        boxShadow: '0 4px 14px rgba(60, 40, 20, 0.18)',
      }}
    >
      {children}
    </button>
  );
}

/**
 * QuizGate — wrap the lead form. When the campaign has an enabled quiz, show the
 * quiz first; once the user reaches the result and taps the CTA, render the form
 * (children). When there's no quiz, render the form directly. onComplete receives
 * { quizId, version, answers, result } so the live page can thread answers into
 * the prospect submit; previews pass a no-op (or omit it).
 */
export function QuizGate({ quiz, themeColor, previewMode = false, onComplete, children }) {
  const enabled = !!(quiz && quiz.enabled && Array.isArray(quiz.steps) && quiz.steps.length > 0);
  const [done, setDone] = useState(false);

  if (!enabled || done) return children;

  return (
    <CampaignQuiz
      quiz={quiz}
      themeColor={themeColor}
      previewMode={previewMode}
      onComplete={(r) => {
        setDone(true);
        onComplete?.(r);
      }}
    />
  );
}
