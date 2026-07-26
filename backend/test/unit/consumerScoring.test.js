import {
  scoreConsumer, quarterEndMs, normalizeConfig, DEFAULT_SCORING_CONFIG,
  SCORING_ALGORITHM_VERSION,
} from '../../src/utils/consumerScoring.js'
import { sgtDateString } from '../../src/services/enrichmentSweepService.js'

/**
 * MEET × BUY scoring engine — the pure half of PR 2
 * (docs/plans/consumer-profile-enrichment.md §7.1, §7.1b).
 *
 * The load-bearing property under test is UNKNOWN ≠ ZERO. A person we never
 * asked about income must not score the same as one who told us they earn
 * under 40k, and Buy must refuse to produce a number at all until at least
 * one fact component is assessed. Everything else here — decay, round-once,
 * config overrides — exists to keep that distinction honest under change.
 */

const NOW = Date.UTC(2026, 6, 26, 9, 0, 0) // 2026-07-26 17:00 SGT

/** Telemetry for a maximally reachable person — isolates the Buy half. */
const fullTelemetry = {
  signupCount: 1,
  verifiedSignupCount: 1,
  newestSignupAt: new Date(NOW).toISOString(),
  hasEmail: true,
  marketingConsent: true,
  whatsappReachable: true,
}

const fact = (v, extra = {}) => ({
  value: v, confidence: 1, source: 'form', sourceEventAt: new Date(NOW).toISOString(),
  observationId: 'obs-1', basis: ['obs-1'], ...extra,
})

const score = (facts = {}, telemetry = fullTelemetry, config = undefined) =>
  scoreConsumer({ facts, telemetry, config, now: NOW })

describe('scoreability — a number is never invented from ignorance', () => {
  test('Buy is NULL when no fact component is assessed', () => {
    const r = score({})
    expect(r.buyScore).toBeNull()
    expect(r.breakdown.components.capacity.state).toBe('unknown')
    expect(r.breakdown.components.family_gap.state).toBe('unknown')
  })

  test('Meet still computes with zero facts — engagement + contactability are behavioral', () => {
    const r = score({})
    expect(r.meetScore).toBeGreaterThan(0)
    expect(r.breakdown.components.engagement.state).toBe('assessed')
    expect(r.breakdown.components.contactability.state).toBe('assessed')
    // Market fit needs a fact; its absence is unknown, NOT a zero-scoring miss.
    expect(r.breakdown.components.market_fit.state).toBe('unknown')
  })

  test('one assessed fact component unlocks Buy', () => {
    const r = score({ 'finance.annual_income_band': fact({ v: '>200k' }) })
    expect(r.buyScore).not.toBeNull()
    expect(r.breakdown.components.capacity.state).toBe('assessed')
  })

  test('unknown capacity does NOT read as low capacity', () => {
    const unknownCapacity = score({ 'family.children_count_band': fact({ v: '2' }) })
    const lowCapacity = score({
      'family.children_count_band': fact({ v: '2' }),
      'finance.annual_income_band': fact({ v: '<40k' }),
    })
    // Both are scoreable, but the one who told us "<40k" carries an assessed
    // component the other lacks — the breakdown must distinguish them.
    expect(unknownCapacity.breakdown.components.capacity.state).toBe('unknown')
    expect(lowCapacity.breakdown.components.capacity.state).toBe('assessed')
    expect(lowCapacity.buyScore).toBeGreaterThan(unknownCapacity.buyScore)
  })

  test('both scores NULL only when nothing at all is assessable', () => {
    const r = scoreConsumer({ facts: {}, telemetry: { signupCount: 0 }, now: NOW })
    // No signups ⇒ engagement unknown, but contactability is still assessed
    // (absence of consent IS the answer), so Meet survives.
    expect(r.breakdown.components.engagement.state).toBe('unknown')
    expect(r.meetScore).not.toBeNull()
    expect(r.buyScore).toBeNull()
  })
})

describe('v2 recency anchor — newest signup, never lastSeenAt (§16 B1)', () => {
  const HALF_LIFE_AGO = new Date(NOW - 180 * 86_400_000).toISOString() // one engagementHalfLifeDays

  test('recency decays from newestSignupAt', () => {
    const fresh = score({}, fullTelemetry)
    const stale = score({}, { ...fullTelemetry, newestSignupAt: HALF_LIFE_AGO })
    // depth(1 signup)=0.35; one half-life halves it; verified bonus 0.15 rides
    // on top. Precision 1: stored breakdown points are rounded to 2dp.
    expect(stale.breakdown.components.engagement.points)
      .toBeCloseTo((0.35 * 0.5 + 0.15) * 15, 1)
    expect(stale.breakdown.components.engagement.points)
      .toBeLessThan(fresh.breakdown.components.engagement.points)
  })

  test('lastSeenAt is IGNORED — a response touch cannot refresh the person score', () => {
    // Old signup + a lastSeenAt refreshed "now" (e.g. a WhatsApp read landed
    // somewhere): the engine must score it identically to the old signup
    // alone. This pins the v2 anchor so a regression back to lastSeenAt fails.
    const anchorOnly = score({}, { ...fullTelemetry, newestSignupAt: HALF_LIFE_AGO })
    const withTouch = score({}, {
      ...fullTelemetry,
      newestSignupAt: HALF_LIFE_AGO,
      lastSeenAt: new Date(NOW).toISOString(),
    })
    expect(withTouch.breakdown.components.engagement.points)
      .toBe(anchorOnly.breakdown.components.engagement.points)
    expect(withTouch.meetScore).toBe(anchorOnly.meetScore)
  })

  test('missing newestSignupAt falls back to full recency, as lastSeen always did', () => {
    const { newestSignupAt, ...rest } = fullTelemetry
    const r = score({}, rest)
    expect(r.breakdown.components.engagement.points)
      .toBeCloseTo((0.35 + 0.15) * 15, 5)
  })
})

describe('market fit is language-primary (§7.2)', () => {
  test('language match scores full weight', () => {
    const r = score({ 'identity.preferred_language': fact({ v: 'zh' }) })
    const mf = r.breakdown.components.market_fit
    expect(mf.state).toBe('assessed')
    expect(mf.points).toBeCloseTo(15, 5)
  })

  test('ethnicity alone is a half-strength signal — it does not establish servicing language', () => {
    const r = score({ 'identity.ethnicity': fact({ v: 'chinese' }) })
    expect(r.breakdown.components.market_fit.points).toBeCloseTo(7.5, 5)
  })

  test('outside the target segment scores zero but is still ASSESSED', () => {
    const r = score({ 'identity.preferred_language': fact({ v: 'ta' }) })
    const mf = r.breakdown.components.market_fit
    expect(mf.state).toBe('assessed')
    expect(mf.points).toBe(0)
  })

  test('retargeting is a config change, not a deploy', () => {
    const tamilMarket = { ...DEFAULT_SCORING_CONFIG, targetSegments: [{ language: 'ta', weight: 1 }] }
    const r = score({ 'identity.preferred_language': fact({ v: 'ta' }) }, fullTelemetry, tamilMarket)
    expect(r.breakdown.components.market_fit.points).toBeCloseTo(15, 5)
  })
})

describe('life-event decay is SGT-quarter-anchored', () => {
  test('quarterEndMs lands on the last instant of the quarter in SGT', () => {
    // 2026-Q1 ends 31 Mar 2026 23:59:59.999 SGT = 15:59:59.999 UTC.
    expect(quarterEndMs('2026-Q1')).toBe(Date.UTC(2026, 2, 31, 15, 59, 59, 999))
    // Q4 must roll into the next year, not month 12 of the same one.
    expect(quarterEndMs('2026-Q4')).toBe(Date.UTC(2026, 11, 31, 15, 59, 59, 999))
    expect(quarterEndMs('nonsense')).toBeNull()
  })

  test('a fresh trigger outscores an old one of the same kind', () => {
    const fresh = score({ 'life_event.recent': fact({ v: 'new_child', when: '2026-Q2' }) })
    const old = score({ 'life_event.recent': fact({ v: 'new_child', when: '2022-Q1' }) })
    expect(fresh.breakdown.components.life_events.points)
      .toBeGreaterThan(old.breakdown.components.life_events.points)
  })

  test('one half-life halves the component', () => {
    // Half-life is 365d; place the quarter end exactly 365d before NOW.
    const cfg = { ...DEFAULT_SCORING_CONFIG, decay: { ...DEFAULT_SCORING_CONFIG.decay, lifeEventHalfLifeDays: 365 } }
    const at = quarterEndMs('2025-Q2')
    const ageDays = (NOW - at) / 86_400_000
    const r = scoreConsumer({
      facts: { 'life_event.recent': fact({ v: 'new_child', when: '2025-Q2' }) },
      telemetry: fullTelemetry, config: cfg, now: NOW,
    })
    const expected = 25 * 1.0 * Math.pow(0.5, ageDays / 365)
    expect(r.breakdown.components.life_events.points).toBeCloseTo(Math.round(expected * 100) / 100, 1)
  })

  test('an undated event decays from when we observed it', () => {
    const r = score({
      'life_event.recent': fact({ v: 'marriage' }, { sourceEventAt: new Date(NOW).toISOString() }),
    })
    // Observed now ⇒ no decay ⇒ full base weight for marriage (0.9).
    expect(r.breakdown.components.life_events.points).toBeCloseTo(0.9 * 25, 5)
  })
})

describe('coverage headroom is a penalty, and only a COMPLETE list may penalize', () => {
  test('a partial coverage list cannot establish what they lack', () => {
    const r = score({ 'finance.existing_coverage': fact({ v: ['health'], complete: false }) })
    expect(r.breakdown.components.coverage_headroom.state).toBe('unknown')
  })

  test('explicitly no coverage takes no penalty and still counts as evidence', () => {
    const r = score({ 'finance.existing_coverage': fact({ v: [], complete: true }) })
    const ch = r.breakdown.components.coverage_headroom
    expect(ch.state).toBe('assessed')
    expect(ch.points).toBe(0)
    // Knowing someone carries nothing is a real finding — it unlocks Buy.
    expect(r.buyScore).not.toBeNull()
  })

  test('full core coverage applies the full negative', () => {
    const r = score({ 'finance.existing_coverage': fact({ v: ['life', 'health', 'ci'], complete: true }) })
    expect(r.breakdown.components.coverage_headroom.points).toBeCloseTo(-10, 5)
  })

  test('the penalty cannot drive a sub-score below zero', () => {
    const r = score({ 'finance.existing_coverage': fact({ v: ['life', 'health', 'ci'], complete: true }) })
    expect(r.buyScore).toBe(0)
    expect(r.consumerScore).toBeGreaterThanOrEqual(0)
  })
})

describe('arithmetic discipline', () => {
  test('rounds exactly once — sub-scores derive from unrounded points', () => {
    const r = score({
      'finance.annual_income_band': fact({ v: '80-120k' }),
      'family.children_count_band': fact({ v: '1' }),
    })
    // capacity = 0.60 × 15 = 9 ; family = 0.60 × 20 = 12 ⇒ 21/60 = 35%
    expect(r.breakdown.components.capacity.points).toBeCloseTo(9, 5)
    expect(r.breakdown.components.family_gap.points).toBeCloseTo(12, 5)
    expect(r.buyScore).toBe(35)
  })

  test('scores stay inside 0..100', () => {
    const maxed = score({
      'identity.preferred_language': fact({ v: 'zh' }),
      'life_event.recent': fact({ v: 'new_child', when: '2026-Q3' }),
      'family.children_count_band': fact({ v: '3_plus' }),
      'family.marital_status': fact({ v: 'married' }),
      'finance.annual_income_band': fact({ v: '>200k' }),
      'assets.property': fact({ v: 'landed' }),
      'career.employment': fact({ v: 'self_employed' }),
    })
    expect(maxed.meetScore).toBeLessThanOrEqual(100)
    expect(maxed.buyScore).toBeLessThanOrEqual(100)
    expect(maxed.consumerScore).toBeLessThanOrEqual(100)
    expect(maxed.consumerScore).toBeGreaterThan(50)
  })

  test('missing signals renormalize instead of dragging a component down', () => {
    // Income-only capacity must reach the top of the range; blending against
    // absent property/employment as if they were zero would cap it at 60%.
    const r = score({ 'finance.annual_income_band': fact({ v: '>200k' }) })
    expect(r.breakdown.components.capacity.points).toBeCloseTo(15, 5)
  })

  test('a low-confidence fact is ignored by the fact rules', () => {
    const r = score({
      'finance.annual_income_band': fact({ v: '>200k' }, { confidence: 0.2 }),
    })
    expect(r.breakdown.components.capacity.state).toBe('unknown')
    expect(r.buyScore).toBeNull()
  })

  test('the detailed children array outranks the count band', () => {
    const r = score({
      'family.children_count_band': fact({ v: '0' }),
      'family.children': fact({ v: [{ birth_year_band: '2015-2019' }, { birth_year_band: '2020-2024' }], complete: true }),
    })
    // 2 children ⇒ 0.85, not the band's 0.15.
    expect(r.breakdown.components.family_gap.points).toBeCloseTo(0.85 * 20, 5)
  })
})

describe('config drives weights and grouping (§7.1b)', () => {
  test('maxPoints overrides recalibrate without a deploy', () => {
    const heavier = {
      ...DEFAULT_SCORING_CONFIG,
      components: { ...DEFAULT_SCORING_CONFIG.components, capacity: { maxPoints: 60 } },
    }
    const r = score({ 'finance.annual_income_band': fact({ v: '>200k' }) }, fullTelemetry, heavier)
    expect(r.breakdown.components.capacity.points).toBeCloseTo(60, 5)
  })

  test('regrouping is a config insert — capacity can move into Meet', () => {
    const regrouped = {
      ...DEFAULT_SCORING_CONFIG,
      groups: { meet: ['engagement', 'contactability', 'capacity'], buy: ['life_events', 'family_gap'] },
    }
    const r = score({ 'finance.annual_income_band': fact({ v: '>200k' }) }, fullTelemetry, regrouped)
    expect(r.breakdown.groups.meet.components).toContain('capacity')
    // Buy now has no assessed fact component ⇒ correctly NULL.
    expect(r.buyScore).toBeNull()
  })

  test('a component the config names but this build cannot score stays visible', () => {
    const withGhost = {
      ...DEFAULT_SCORING_CONFIG,
      components: { ...DEFAULT_SCORING_CONFIG.components, future_signal: { maxPoints: 10 } },
    }
    const r = score({}, fullTelemetry, withGhost)
    expect(r.breakdown.components.future_signal.state).toBe('unknown')
    expect(r.breakdown.components.future_signal.note).toMatch(/no rule/)
  })

  test('normalizeConfig fills gaps without discarding overrides', () => {
    const merged = normalizeConfig({ components: { capacity: { maxPoints: 99 } } })
    expect(merged.components.capacity.maxPoints).toBe(99)
    expect(merged.components.engagement.maxPoints).toBe(15)
    expect(merged.decay.lifeEventHalfLifeDays).toBe(365)
    expect(merged.algorithmVersion).toBe(SCORING_ALGORITHM_VERSION)
  })
})

describe('breakdown is explainable', () => {
  test('every assessed fact component cites the observations behind it', () => {
    const r = score({ 'finance.annual_income_band': fact({ v: '40-80k' }, { observationId: 'obs-income' }) })
    expect(r.breakdown.components.capacity.basisObservationIds).toContain('obs-income')
  })

  test('completeness counts what we actually know', () => {
    const r = score({ 'finance.annual_income_band': fact({ v: '40-80k' }) })
    // engagement + contactability + capacity assessed of 7 components.
    expect(r.breakdown.completeness).toEqual({ assessed: 3, total: 7 })
  })
})

describe('the first real consumer through the pipe', () => {
  // Shavon Teo, prod 2026-07-26: the first signup to answer PR 0's profile
  // questions. Her three observations are exactly what the live mapper wrote.
  const shavon = {
    'finance.annual_income_band': fact({ v: '<40k' }, { observationId: 'obs-income' }),
    'family.children_count_band': fact({ v: '0' }, { observationId: 'obs-children' }),
    'identity.birth_year_band': fact({ v: '1995-1999' }, { observationId: 'obs-birth' }),
  }

  test('scores on both halves', () => {
    const r = score(shavon)
    expect(r.meetScore).not.toBeNull()
    expect(r.buyScore).not.toBeNull()
    expect(r.consumerScore).not.toBeNull()
  })

  test('reads as reachable but early-stage — not a false hot lead', () => {
    const r = score(shavon)
    expect(r.meetScore).toBeGreaterThan(r.buyScore)
    expect(r.buyScore).toBeLessThan(25)
  })

  test('market fit stays unknown until a language question is asked', () => {
    // Her campaign enabled annual_income + children only — no language.
    expect(score(shavon).breakdown.components.market_fit.state).toBe('unknown')
  })
})

describe('SGT date helper', () => {
  test('rolls at SGT midnight, not UTC midnight', () => {
    // 2026-07-26 16:30 UTC = 2026-07-27 00:30 SGT.
    expect(sgtDateString(Date.UTC(2026, 6, 26, 16, 30))).toBe('2026-07-27')
    expect(sgtDateString(Date.UTC(2026, 6, 26, 15, 30))).toBe('2026-07-26')
  })
})
