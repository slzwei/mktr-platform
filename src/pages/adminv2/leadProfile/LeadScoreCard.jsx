/**
 * The Lead Score card and everything it renders (P3-3).
 *
 * ~580 lines lifted verbatim out of AdminV2LeadProfile: the dials, the
 * component breakdown, the badge, the score-event log, the enrichment card, the
 * campaign sheet peek and the mechanics note. It is one feature with one job —
 * show the scoring's working — and it was interleaved with the rest of the page
 * for no reason other than history.
 *
 * Only three of these are used outside this file (LeadScoreCard,
 * LeadScoreBadge, EnrichmentCard); the rest are its internals, and now they
 * read that way.
 *
 * Nothing visual changed.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '@/components/adminv2/primitives';
import { COMPONENT_LABELS } from '@/lib/adminV2/scoringLabels';
import { fmtDateTime, fmtDate } from '@/lib/adminV2/format';
import { fetchScoringEdition } from '@/api/adminV2';
import { HoverHint, Disclosure } from './primitives';

/* ── MEET × BUY scoring (consumer-profile-enrichment §7.1b, §8) ───────────
 * The BREAKDOWN LEADS and the number follows (plan §11 step 4): these weights
 * are a v1 calibration, so the panel has to show its working or it is just an
 * authoritative-looking guess. Every component states whether it was assessed
 * or is simply unknown — that distinction is the point, because "unknown
 * capacity" and "low capacity" must never render the same way.
 */
// COMPONENT_LABELS moved to @/lib/adminV2/scoringLabels — shared with the
// sheet editor (campaign-scoring-editor §3.1) so the card and the editor
// describe the same components in the same words.

const FACT_LABELS = {
  'identity.gender': 'gender',
  'identity.birth_year_band': 'born',
  'identity.ethnicity': 'ethnicity',
  'identity.preferred_language': 'language',
  'family.marital_status': 'marital status',
  'family.children': 'children',
  'family.children_count_band': 'children',
  'family.parents_alive': 'parents alive',
  'household.pets': 'pets',
  'assets.car_owner': 'car owner',
  'assets.property': 'property',
  'career.job_title': 'job title',
  'career.industry': 'industry',
  'career.employment': 'employment',
  'finance.income_band': 'monthly income',
  'finance.annual_income_band': 'annual income',
  'finance.retirement_age_band': 'retirement age',
  'finance.existing_coverage': 'existing coverage',
  'life_event.recent': 'recent life event',
  'interests.tags': 'interests',
  'residency.status': 'residency',
};

/** Taxonomy values are always {v: …} plus per-key extras — render them flat. */
function factText(value) {
  if (!value || typeof value !== 'object') return '—';
  const v = value.v;
  let body;
  if (Array.isArray(v)) {
    body = v.length
      ? v.map((x) => (x && typeof x === 'object' ? Object.values(x).filter(Boolean).join(' ') : String(x))).join(', ')
      : 'none';
  } else if (typeof v === 'boolean') {
    body = v ? 'yes' : 'no';
  } else {
    body = String(v ?? '—');
  }
  if (value.when) body += ` (${value.when})`;
  // complete:false means "at least these" — say so rather than implying a
  // closed list the ledger never claimed.
  if (Array.isArray(v) && value.complete === false) body += ' — partial';
  return body;
}

function ScoreDial({ label, value, hint }) {
  const known = value != null;
  return (
    <div style={{ flex: 1, minWidth: 96 }}>
      <div className="av2-microcaps" style={{ color: 'var(--ink-3)' }}>{label}</div>
      <div
        style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 2 }}
        title={known ? `${label} ${value}/100` : hint}
      >
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 26, fontWeight: 800, lineHeight: 1, color: known ? 'var(--ink)' : 'var(--ink-3)' }}>
          {known ? value : '—'}
        </span>
        {known && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-3)' }}>/100</span>}
      </div>
      {!known && <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 3 }}>{hint}</div>}
    </div>
  );
}

function ComponentRow({ name, c }) {
  const assessed = c.state === 'assessed';
  const max = Number(c.maxPoints) || 0;
  // A penalty component's magnitude is what fills the bar; its sign shows in
  // the number. Unknown draws no bar at all — an empty bar would read as zero.
  const pct = assessed && max !== 0 ? Math.min(100, Math.abs(c.points / max) * 100) : 0;
  const penalty = max < 0;
  const label = COMPONENT_LABELS[name] || name.replace(/_/g, ' ');
  // The reason moved ONTO the label (dotted = there is more here). It used to
  // ride in a trailing column that ellipsed nearly every row — "reachable via
  // marketi…", "no recent life event…" — so the one part that explains the
  // number was the one part you could not read. Nothing is lost: the full text
  // is one hover away, and the space it freed goes to the bar, which is what
  // makes two components comparable at a glance.
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '3px 0', fontSize: 12 }}>
      <span style={{ width: 116, flex: 'none', color: assessed ? 'var(--ink-2)' : 'var(--ink-3)' }}>
        {c.note
          ? <HoverHint label={label} hint={c.note} ariaLabel={`${label}: ${c.note}`} />
          : label}
      </span>
      <span style={{ width: 58, flex: 'none', fontFamily: 'var(--font-mono)', fontSize: 11, textAlign: 'right', color: assessed ? 'var(--ink)' : 'var(--ink-3)' }}>
        {assessed ? `${c.points}` : '—'}<span style={{ color: 'var(--ink-3)' }}>/{max}</span>
      </span>
      <span aria-hidden="true" style={{ flex: 1, minWidth: 46, height: 4, borderRadius: 3, background: 'var(--surface-2)', overflow: 'hidden' }}>
        {assessed && pct > 0 && (
          <span style={{ display: 'block', width: `${pct}%`, height: '100%', background: penalty ? 'var(--bad)' : 'var(--accent-text)' }} />
        )}
      </span>
    </div>
  );
}

/**
 * The parts, grouped the way the config groups them. Shared by both grains
 * BECAUSE the two breakdowns are the same shape — the person's is literally a
 * copy of their winning lead's (`projectPersonScore`), so a reader who learns
 * to read one has learned to read the other.
 */
function ScoreComponents({ breakdown }) {
  const comps = breakdown?.components || {};
  const groups = breakdown?.groups || {};
  const completeness = breakdown?.completeness;
  const meetNames = groups.meet?.components || [];
  const buyNames = groups.buy?.components || [];
  return (
    <div style={{ padding: '4px 18px 12px' }}>
      {meetNames.length > 0 && (
        <>
          <div className="av2-microcaps" style={{ padding: '6px 0 2px' }}>Reachability</div>
          {meetNames.map((n) => comps[n] && <ComponentRow key={n} name={n} c={comps[n]} />)}
        </>
      )}
      {buyNames.length > 0 && (
        <>
          <div className="av2-microcaps" style={{ padding: '10px 0 2px' }}>Potential</div>
          {buyNames.map((n) => comps[n] && <ComponentRow key={n} name={n} c={comps[n]} />)}
        </>
      )}
      {completeness && (
        <div style={{ fontSize: 11.5, color: 'var(--ink-3)', paddingTop: 10 }}>
          {completeness.assessed} of {completeness.total} components assessed
          {completeness.assessed < completeness.total && ' — the unknowns above are questions nobody has been asked'}
        </div>
      )}
    </div>
  );
}

/**
 * THIS campaign's score for THIS person (per-campaign-lead-scoring.md §4).
 *
 * The scoring card on the person profile shows the WINNING lead's numbers — the
 * projection. For anyone with a single signup those are the same number, but a
 * person with two campaigns has two scores and only one of them surfaces there.
 * The drill-in is the page about one lead, so it is where that lead's own score
 * belongs.
 *
 * NULL is not zero. A lead the sweep has not reached yet says so in words
 * rather than showing a 0 nobody computed.
 */
export function LeadScoreBadge({ signup }) {
  if (!signup) return null;
  const scored = signup.score !== null && signup.score !== undefined;
  if (!scored) {
    return (
      <span
        className="av2-mono"
        style={{ fontSize: 10.5, color: 'var(--ink-3)', flex: 'none' }}
        title="The nightly sweep has not reached this lead yet."
      >
        NOT SCORED YET
      </span>
    );
  }
  return (
    <span
      style={{ display: 'inline-flex', alignItems: 'baseline', gap: 5, flex: 'none' }}
      title={signup.scoredAt ? `Scored ${fmtDateTime(signup.scoredAt)}` : 'Lead score'}
    >
      <span className="av2-microcaps" style={{ color: 'var(--ink-3)' }}>lead score</span>
      <span
        className="av2-mono"
        style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}
      >
        {signup.score}
      </span>
    </span>
  );
}

/**
 * What actually happened, and when (per-campaign-lead-scoring.md §6).
 *
 * The components above say how much each thing is worth right now; this says
 * what the "thing" was. Weights are shown UNDECAYED — the score already has
 * the decay baked in as of `scoredAt`, so the gap between an event's full
 * weight and its contribution IS the age shown beside it. Rendering a decayed
 * figure here would just repeat the score twice and explain nothing.
 *
 * Absent for a lead nobody has messaged or called, which is most of them —
 * an empty section would read as "no response" rather than "no contact".
 */
function ScoreEvents({ events, scoredAt }) {
  const rows = Array.isArray(events) ? events : [];
  if (!rows.length) return null;

  const label = (e) => {
    if (e.type === 'wa_read') return 'Read a WhatsApp from this campaign';
    if (e.type === 'screening') {
      const bits = [
        e.verdict === 'qualified' ? 'Screening call: qualified'
          : e.verdict === 'not_qualified' ? 'Screening call: not qualified'
            : 'Screening call',
        e.interest && `interest ${e.interest}`,
        e.sentiment && `sentiment ${e.sentiment}`,
        e.agreedToMeet === true && 'agreed to meet',
        e.agreedToMeet === false && 'declined to meet',
      ].filter(Boolean);
      return bits.join(' · ');
    }
    return e.type;
  };

  return (
    <Disclosure
      label="Response events"
      count={`${rows.length} EVENT${rows.length === 1 ? '' : 'S'}`}
      indent={36}
    >
      {rows.map((e, i) => (
        <div
          key={`${e.type}-${e.at || i}`}
          style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '3px 0', fontSize: 12 }}
        >
          <span style={{ flex: 1, color: 'var(--ink-2)' }}>{label(e)}</span>
          <span className="av2-mono" style={{ fontSize: 10.5, color: 'var(--ink-3)', flex: 'none' }}>
            {e.at ? fmtDateTime(e.at) : 'undated'}
            {Number.isFinite(e.ageDays) && ` · ${e.ageDays}d`}
          </span>
          <span
            className="av2-mono"
            style={{ width: 44, textAlign: 'right', flex: 'none', fontSize: 10.5, color: 'var(--ink-3)' }}
            title="Full weight before decay"
          >
            {e.undecayedWeight != null ? `${e.undecayedWeight > 0 ? '+' : ''}${e.undecayedWeight}` : '—'}
          </span>
        </div>
      ))}
      <div style={{ fontSize: 11, color: 'var(--ink-3)', paddingTop: 6 }}>
        Weights are shown at full strength; the score above applies decay as of{' '}
        {scoredAt ? fmtDateTime(scoredAt) : 'the last rescore'}.
      </div>
    </Disclosure>
  );
}

export function EnrichmentCard({ enrichment }) {
  const bd = enrichment?.breakdown;
  const facts = enrichment?.facts || [];

  return (
    <Card
      title="Scoring"
      // The caption stamps come from the SOURCE lead (campaign-scoring-editor
      // §4.4). When a breakdown survives but its source signup is gone —
      // deleted, or a projection older than the pointer column — there is no
      // honest stamp to show, and borrowing the person-pass one would caption
      // this breakdown with an unrelated config.
      meta={enrichment?.stampsUnavailable
        ? 'SCORE SOURCE SIGNUP UNAVAILABLE'
        : enrichment?.configVersion != null ? `CONFIG v${enrichment.configVersion}` : undefined}
    >
      <div style={{ padding: '12px 18px 6px', display: 'flex', gap: 18 }}>
        <ScoreDial label="Meet" value={enrichment?.meetScore} hint="no signal yet" />
        <ScoreDial
          label="Buy"
          value={enrichment?.buyScore}
          hint="no facts to judge"
        />
      </div>

      {/* A person does not have one worth — a fresh grad is a strong recruit
          and a weak policyholder. These numbers are their BEST lead's (§4's
          projection), so naming that lead is the difference between a number a
          reader can act on and one they will misread the moment two campaigns
          score the same person differently. */}
      {enrichment?.scoreSource?.campaignName && (
        <div style={{ padding: '0 18px 8px', fontSize: 11.5, color: 'var(--ink-3)' }}>
          their best campaign —{' '}
          <span style={{ color: 'var(--ink-2)', fontWeight: 600 }}>
            {enrichment.scoreSource.campaignName}
          </span>
        </div>
      )}

      <ScoreComponents breakdown={bd} />

      <ScoreEvents events={bd?.events} scoredAt={enrichment?.scoredAt} />

      {facts.length > 0 && (
        <Disclosure label="Fact ledger" count={`${facts.length} FACT${facts.length === 1 ? '' : 'S'}`} indent={36}>
          {facts.map((f) => (
            <div key={f.key} style={{ display: 'flex', gap: 10, fontSize: 12, padding: '3px 0', alignItems: 'baseline' }}>
              <span style={{ width: 116, flex: 'none', color: 'var(--ink-3)' }}>{FACT_LABELS[f.key] || f.key}</span>
              <span style={{ flex: 1, minWidth: 0, color: 'var(--ink)', fontWeight: 600, overflowWrap: 'anywhere' }}>
                {factText(f.value)}
              </span>
              <span
                className="av2-mono"
                style={{ flex: 'none', fontSize: 10, color: 'var(--ink-3)' }}
                title={`${f.source} · confidence ${f.confidence}${f.observedAt ? ` · ${fmtDate(f.observedAt)}` : ''}`}
              >
                {f.source}
              </span>
            </div>
          ))}
        </Disclosure>
      )}

      <ScoringMechanicsNote edition={enrichment?.stampsUnavailable ? null : enrichment?.configVersion} />
    </Card>
  );
}

/**
 * THIS CAMPAIGN'S customised sheet, on the lead (the follow-up ask: "no i
 * mean, the customised scoring metrics for this particular campaign").
 *
 * Shows the EXACT EDITION the stamp names — fetched lazily on first open,
 * never the currently-resolved sheet: the campaign may have moved to a newer
 * edition since this lead was scored, and captioning old points with new
 * rules is the §4.4 lie all over again. Weights render beside their house
 * values with a ↑/↓ marker on every deviation; the age curve and target
 * segments come from the same document. Effective weights fall back to the
 * breakdown's own maxPoints when an older edition's document omits a key.
 */
function CampaignSheetPeek({ edition, breakdown, campaignId }) {
  const [state, setState] = useState({ status: 'idle', sheet: null });
  if (edition == null) return null;

  const load = async (e) => {
    if (!e.currentTarget.open || state.status === 'ready' || state.status === 'loading') return;
    setState({ status: 'loading', sheet: null });
    try {
      setState({ status: 'ready', sheet: await fetchScoringEdition(edition) });
    } catch {
      setState({ status: 'error', sheet: null });
    }
  };

  const sheet = state.sheet;
  const cfg = sheet?.configJson || {};
  const house = sheet?.houseDefault || {};
  const comps = breakdown?.components || {};
  // Effective weight: the edition's document, else the breakdown's own max —
  // which IS the weight that actually applied.
  const weightFor = (name, leadGrain) => {
    const map = leadGrain ? cfg.leadComponents : cfg.components;
    return map?.[name]?.maxPoints ?? comps[name]?.maxPoints ?? null;
  };
  const houseFor = (name, leadGrain) => {
    const map = leadGrain ? house.leadComponents : house.components;
    return map?.[name]?.maxPoints ?? null;
  };

  // "peaks 30-44" from the curve: the segments at the curve's own maximum.
  const curve = Array.isArray(cfg.ageCurve) ? cfg.ageCurve : [];
  let peak = null;
  if (curve.length) {
    const top = Math.max(...curve.map((s) => s.value));
    const ranges = [];
    let lo = 0;
    for (const seg of curve) {
      const hi = seg.upTo == null ? null : seg.upTo;
      if (seg.value === top) ranges.push(hi == null ? `${lo}+` : `${lo}–${hi}`);
      lo = hi == null ? lo : hi + 1;
    }
    peak = ranges.join(', ');
  }
  const segments = Array.isArray(cfg.targetSegments) ? cfg.targetSegments : [];

  const NAMES = [
    ['meet', 'Reachability', [['engagement', false], ['contactability', false], ['market_fit', false], ['response', true], ['screening', true]]],
    ['buy', 'Potential', [['life_events', false], ['family_gap', false], ['capacity', false], ['coverage_headroom', false], ['age', false]]],
  ];

  return (
    <details style={{ borderTop: '1px solid var(--line)' }} onToggle={load}>
      <summary style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 16px', cursor: 'pointer', fontSize: 11.5, fontWeight: 700, color: 'var(--ink-2)' }}>
        <span className="disc-caret" aria-hidden="true" style={{ color: 'var(--ink-3)', display: 'inline-block', transition: 'transform .12s ease' }}>▸</span>
        This campaign's scoring sheet
        <span style={{ flex: 1 }} />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-3)' }}>EDITION #{edition}</span>
      </summary>
      <div style={{ padding: '2px 16px 12px 36px' }}>
        {state.status === 'loading' && <div style={{ fontSize: 12, color: 'var(--ink-3)', padding: '4px 0' }}>Loading the edition…</div>}
        {state.status === 'error' && (
          <div style={{ fontSize: 12, color: 'var(--ink-3)', padding: '4px 0' }}>
            Couldn't load edition #{edition} — the weights in the breakdown above (the “/N” figures) are the ones that applied.
          </div>
        )}
        {state.status === 'ready' && (
          <>
            {NAMES.map(([key, title, names]) => (
              <div key={key}>
                <div className="av2-microcaps" style={{ padding: '6px 0 2px' }}>{title}</div>
                {names.map(([name, leadGrain]) => {
                  const w = weightFor(name, leadGrain);
                  const h = houseFor(name, leadGrain);
                  const differs = w != null && h != null && w !== h;
                  return (
                    <div key={name} style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '2px 0', fontSize: 12 }}>
                      <span style={{ width: 148, flex: 'none', color: 'var(--ink-2)' }}>{COMPONENT_LABELS[name] || name}</span>
                      <span className="av2-mono" style={{ width: 34, textAlign: 'right', flex: 'none', fontWeight: differs ? 800 : 500, color: differs ? 'var(--ink)' : 'var(--ink-2)' }}>
                        {w ?? '—'}
                      </span>
                      <span className="av2-mono" style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>
                        house {h ?? '—'}
                        {differs && (
                          <span style={{ color: w > h ? 'var(--accent-text)' : 'var(--warn)', fontWeight: 700 }}>
                            {' '}{w > h ? '↑' : '↓'} {w > h ? '+' : ''}{Math.round((w - h) * 10) / 10}
                          </span>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}
            <div style={{ fontSize: 12, color: 'var(--ink-2)', paddingTop: 8 }}>
              <span className="av2-microcaps" style={{ display: 'block', paddingBottom: 2 }}>Age dial</span>
              {peak ? <>full weight at ages <span style={{ fontWeight: 700, color: 'var(--ink)' }}>{peak}</span>, ramping down outside</> : 'house curve'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-2)', paddingTop: 8 }}>
              <span className="av2-microcaps" style={{ display: 'block', paddingBottom: 2 }}>Target market</span>
              {segments.length
                ? segments.map((s, i) => (
                  <span key={i}>
                    {i > 0 && ' · '}
                    {[s.language && (SEGMENT_LANGUAGE_LABELS[s.language] || s.language), s.ethnicity].filter(Boolean).join(' / ')}
                    {typeof s.weight === 'number' && s.weight !== 1 ? ` ×${s.weight}` : ''}
                  </span>
                ))
                : 'everyone equally'}
            </div>
            {campaignId && (
              <div style={{ paddingTop: 10 }}>
                <Link to={`/admin/campaigns/${campaignId}`} style={{ fontSize: 11.5, fontWeight: 700 }}>
                  Tune this sheet on the campaign page →
                </Link>
              </div>
            )}
          </>
        )}
      </div>
    </details>
  );
}

const SEGMENT_LANGUAGE_LABELS = { en: 'English', zh: 'Mandarin', ms: 'Malay', ta: 'Tamil' };

/**
 * The MECHANICS, on the page (asked for directly: "can you put somewhere,
 * the scoring mechanics on the lead?"). The same plain language the console
 * uses everywhere, tucked behind a disclosure so it teaches without
 * shouting. Shared by BOTH score cards — the person card renders a copy of a
 * lead's breakdown, so one explanation is the truth for both.
 *
 * Wordings are deliberately DISTINCT from the cards' own microcopy (the sum
 * line, the completeness line) so nothing on screen repeats itself verbatim.
 */
function ScoringMechanicsNote({ edition }) {
  const p = { margin: 0 };
  const b = (text) => <span style={{ fontWeight: 700, color: 'var(--ink)' }}>{text}</span>;
  return (
    <Disclosure label="How this score works" indent={36}>
      <div style={{ fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.6, display: 'grid', gap: 8, maxWidth: 660, paddingTop: 2 }}>
        <p style={p}>
          {b('A points checklist, not a grade.')} Ten questions we would ask about any
          lead, each worth a set number of points. Evidence earns points; a question
          never asked shows “—” and earns nothing — {b('unknown is never treated as low')}.
        </p>
        <p style={p}>
          {b('Two kinds of evidence.')} What the person {b('did')} — signed up, verified
          their phone, read our WhatsApp, took the screening call — and what we
          {' '}{b('know')} about them — age, children, income — from form answers and
          call transcripts. Each row’s dotted label explains its own points on hover.
        </p>
        <p style={p}>
          {b('The three numbers.')} The headline is every earned point added together
          (capped at 100). Meet is the reachability rows against their own maximum —
          “will they take a consultant’s call”. Buy is the potential rows against
          theirs — “would they actually buy”. Buy stays “—” until at least one real
          fact is known, so ignorance can never fake a number.
        </p>
        <p style={p}>
          {b('Old signals fade.')} Activity counts for about half after six months,
          life events after a year. The score is recomputed nightly and when
          something new happens; “scored” above is its as-of stamp.
        </p>
        <p style={p}>
          {b('The rulebook is per campaign.')} These weights come from
          {edition != null ? <> this campaign’s scoring sheet — edition #{edition}</> : ' the campaign’s scoring sheet'},
          tunable from the campaign page (draft → preview on real leads → approve;
          every edition is kept, with who approved it).
        </p>
      </div>
    </Disclosure>
  );
}

/**
 * WHY this lead scored what it scored — the drill-in's own breakdown.
 *
 * The hero line states the number; this states the working, in the same parts
 * and the same order as the person card, because the two breakdowns are the
 * same shape.
 *
 * It reads the PROSPECT ROW, which is the only per-lead source on this page:
 * `journey.enrichment` is the person's projection of their best lead (§4), so
 * on anyone's second campaign it would explain a number this page is not
 * showing. `?include=profile` already serializes the whole prospect model, so
 * the breakdown, both halves and the config stamp arrive with no extra request.
 *
 * Absent until the sweep has scored this lead — `scoredConfigVersion` is the
 * stamp that means "scored", and an empty card would imply a verdict nobody
 * has reached.
 */
export function LeadScoreCard({ prospect, campaignName, campaignId, hasPersonCard }) {
  const bd = prospect?.scoreBreakdown || null;
  if (!bd || prospect.scoredConfigVersion == null) return null;
  const stamp = [
    `CONFIG v${prospect.scoredConfigVersion}`,
    prospect.scoreComputedAt ? `SCORED ${fmtDateTime(prospect.scoreComputedAt).toUpperCase()}` : null,
  ].filter(Boolean).join(' · ');
  return (
    <Card title="Lead score" meta={stamp}>
      <div style={{ padding: '12px 18px 6px', display: 'flex', gap: 18 }}>
        <ScoreDial label="Meet" value={prospect.meetScore} hint="no signal yet" />
        <ScoreDial label="Buy" value={prospect.buyScore} hint="no facts to judge" />
      </div>

      {/* The total is NOT an average of the two halves — average 50 and 16 and
          you get 33, not the 48 in the hero. It is the points below, added up
          and capped. Stated here because this is the one place the parts and
          the whole are on screen together, which is exactly where a reader
          tries the arithmetic and concludes the page is lying. */}
      {prospect.score != null && (
        <div style={{ padding: '0 18px 4px', fontSize: 11.5, color: 'var(--ink-3)' }}>
          <span className="av2-mono" style={{ color: 'var(--ink-2)', fontWeight: 700 }}>{prospect.score}</span>
          {' = the points below, added up and capped at 100 — not an average of the two halves.'}
        </div>
      )}

      {/* §4: the profile card shows this person's BEST lead. On a second
          campaign that is a different lead with different numbers, so the two
          cards disagreeing is the system working — say so before a reader
          reads it as a bug. But only when that card exists: a consumer-less
          (or never-person-scored) lead has no profile scoring card, and
          pointing at one would send the reader hunting for a surface that
          isn't there. */}
      <div style={{ padding: '0 18px 8px', fontSize: 11.5, color: 'var(--ink-3)' }}>
        {campaignName
          ? <><span style={{ color: 'var(--ink-2)', fontWeight: 600 }}>{campaignName}</span>{' only'}</>
          : 'This campaign only'}
        {hasPersonCard ? ' — the profile card scores their best campaign.' : '.'}
      </div>

      <ScoreComponents breakdown={bd} />

      <ScoreEvents events={bd.events} scoredAt={prospect.scoreComputedAt} />

      <CampaignSheetPeek
        edition={prospect.scoredConfigVersion}
        breakdown={bd}
        campaignId={campaignId}
      />

      <ScoringMechanicsNote edition={prospect.scoredConfigVersion} />
    </Card>
  );
}
