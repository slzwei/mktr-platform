import {
  validateScoringConfig, MAX_COMPONENT_POINTS, MAX_COMPONENT_SHARE, MAX_AGE_CURVE_SLOPE,
} from '../../src/utils/scoringConfigValidation.js'
import {
  DEFAULT_SCORING_CONFIG, DEFAULT_LEAD_COMPONENTS, SCOREABLE_COMPONENTS, scoreConsumer,
} from '../../src/utils/consumerScoring.js'

/**
 * Semantic invariants for a scoring config
 * (docs/plans/per-campaign-lead-scoring.md §8.1, PR C).
 *
 * These are the checks that make "the AI wrote the weights" survivable. The
 * load-bearing property is that a config which PARSES can still be absurd:
 * every case below is JSON-schema-valid and would have been accepted before
 * this validator existed, and several of them fail SILENTLY at read time
 * rather than erroring — which is exactly why they need a gate at save.
 */

const NOW = Date.UTC(2026, 6, 28, 9, 0, 0)

/** The shipped defaults, which must pass unchanged — the validator is a
 *  guard on new configs, not a redesign of the current one. */
const ok = (over = {}) => validateScoringConfig({ ...DEFAULT_SCORING_CONFIG, ...over })

/**
 * A FULL component map. `normalizeConfig` merges the eight shipped components
 * over anything partial, so a fixture that names two components still arrives
 * at the validator with all eight — the dominance arithmetic below is only
 * predictable if every weight is stated.
 *
 * Baseline: 5 each, life_events 10, coverage_headroom −5 → positive total 40,
 * top share 25%. Deliberately legal, so each test's own override is the only
 * thing that can trip a check.
 */
function allComponents(over = {}, base = null) {
  const b = (name, dflt) => (base === null ? dflt : base)
  return {
    engagement: { maxPoints: over.engagement ?? b('engagement', 5) },
    contactability: { maxPoints: over.contactability ?? b('contactability', 5) },
    market_fit: { maxPoints: over.market_fit ?? b('market_fit', 5) },
    life_events: { maxPoints: over.life_events ?? b('life_events', 10) },
    family_gap: { maxPoints: over.family_gap ?? b('family_gap', 5) },
    capacity: { maxPoints: over.capacity ?? b('capacity', 5) },
    age: { maxPoints: over.age ?? b('age', 5) },
    coverage_headroom: { maxPoints: over.coverage_headroom ?? b('coverage_headroom', -5) },
  }
}

describe('the shipped configuration is valid', () => {
  it('accepts DEFAULT_SCORING_CONFIG as-is', () => {
    const r = validateScoringConfig(DEFAULT_SCORING_CONFIG)
    expect(r.ok).toBe(true)
    expect(r.config.components.life_events.maxPoints).toBe(25)
  })

  it('accepts a sparse override — omitted keys inherit and must not trip a check', () => {
    const r = validateScoringConfig({ components: { age: { maxPoints: 12 } } })
    expect(r.ok).toBe(true)
    // decay was never mentioned, so it inherits positive half-lives
    expect(r.config.decay.engagementHalfLifeDays).toBe(180)
  })

  it('accepts a lead-grain recalibration through leadComponents', () => {
    const r = validateScoringConfig({ leadComponents: { response: { maxPoints: 20 } } })
    expect(r.ok).toBe(true)
  })
})

describe('unknown component names are REJECTED, not zeroed (§8.1)', () => {
  it('rejects a typo in components', () => {
    const r = ok({ components: { ...DEFAULT_SCORING_CONFIG.components, capicity: { maxPoints: 15 } } })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/capicity is not a scoreable component/)
  })

  it('rejects an invented component in leadComponents', () => {
    const r = validateScoringConfig({ leadComponents: { vibes: { maxPoints: 10 } } })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/leadComponents\.vibes is not a scoreable component/)
  })

  it('names the closed vocabulary in the error, so the fix is obvious', () => {
    const r = validateScoringConfig({ components: { nope: { maxPoints: 1 } } })
    expect(r.error).toContain(SCOREABLE_COMPONENTS.join(', '))
  })

  it('rejects unknown TOP-LEVEL keys — a misplaced knob is silently ignored otherwise', () => {
    const r = ok({ decayHalfLife: 90 })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/Unknown top-level scoring config keys: decayHalfLife/)
  })

  it('rejects unknown keys inside a component definition', () => {
    const r = ok({ components: { ...DEFAULT_SCORING_CONFIG.components, age: { maxPoints: 10, weight: 3 } } })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/components\.age has unknown keys: weight/)
  })
})

describe('weights are bounded and no component may dominate', () => {
  it('rejects a weight beyond the absolute bound', () => {
    const r = ok({
      components: { ...DEFAULT_SCORING_CONFIG.components, age: { maxPoints: MAX_COMPONENT_POINTS + 1 } },
    })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/within ±50/)
  })

  it('rejects a non-numeric weight', () => {
    const r = ok({ components: { ...DEFAULT_SCORING_CONFIG.components, age: { maxPoints: '10' } } })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/maxPoints must be a finite number/)
  })

  it(`rejects a component carrying more than ${MAX_COMPONENT_SHARE * 100}% of the positive total`, () => {
    // life_events 40 of a positive total of 70 → 57%.
    const r = validateScoringConfig({ components: allComponents({ life_events: 40 }) })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/^The person grain component "life_events" is 57% of the positive total/)
  })

  it('checks BOTH grains — the lead grain adds response+screening to the same arithmetic', () => {
    // Person grain: 40 positive, top component 10 → 25%, legal.
    // Lead grain: 40 + 5 + 50 = 95, screening 50 → 53%, illegal. Only the
    // second check can catch it, which is why both are run.
    const r = validateScoringConfig({
      components: allComponents(),
      leadComponents: { response: { maxPoints: 5 }, screening: { maxPoints: 50 } },
    })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/^The lead grain component "screening" is 53% of the positive total/)
  })

  it('rejects a config where nothing has positive weight', () => {
    const r = validateScoringConfig({ components: allComponents({}, 0) })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/no component with positive weight/)
  })

  it('allows a negative weight — coverage_headroom is a penalty by design', () => {
    expect(ok().ok).toBe(true)
    expect(DEFAULT_SCORING_CONFIG.components.coverage_headroom.maxPoints).toBeLessThan(0)
  })
})

describe('a non-positive half-life silently disables decay, so it is rejected', () => {
  it.each(['lifeEventHalfLifeDays', 'engagementHalfLifeDays'])('rejects %s = 0', (knob) => {
    const r = ok({ decay: { ...DEFAULT_SCORING_CONFIG.decay, [knob]: 0 } })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(new RegExp(`decay\\.${knob} must be a positive number`))
  })

  it('rejects a negative half-life', () => {
    const r = ok({ decay: { ...DEFAULT_SCORING_CONFIG.decay, engagementHalfLifeDays: -30 } })
    expect(r.ok).toBe(false)
  })

  it('rejects an explicit null, which merges over the default', () => {
    const r = ok({ decay: { ...DEFAULT_SCORING_CONFIG.decay, lifeEventHalfLifeDays: null } })
    expect(r.ok).toBe(false)
  })

  it('the rejection is real: a zeroed half-life does NOT throw at read time, it flattens decay', () => {
    // This is the behaviour the validator exists to prevent reaching the table.
    const facts = {}
    const stale = { signupCount: 1, verifiedSignupCount: 1, hasEmail: true, whatsappReachable: true, marketingConsent: true,
      newestSignupAt: new Date(NOW - 400 * 86_400_000).toISOString() }
    const decayed = scoreConsumer({ facts, telemetry: stale, config: DEFAULT_SCORING_CONFIG, now: NOW })
    const flat = scoreConsumer({
      facts,
      telemetry: stale,
      config: { ...DEFAULT_SCORING_CONFIG, decay: { ...DEFAULT_SCORING_CONFIG.decay, engagementHalfLifeDays: 0 } },
      now: NOW,
    })
    expect(flat.meetScore).toBeGreaterThan(decayed.meetScore)
  })
})

describe('the age curve is bounded in value, order and slope', () => {
  const curve = (segs) => ok({ ageCurve: segs })

  it('rejects a value outside 0..1', () => {
    const r = curve([{ upTo: 40, value: 1.5 }, { upTo: null, value: 1 }])
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/must be a fraction in 0\.\.1/)
  })

  it('rejects a non-ascending upTo', () => {
    const r = curve([{ upTo: 40, value: 0.5 }, { upTo: 30, value: 0.6 }, { upTo: null, value: 0.7 }])
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/must increase/)
  })

  it('requires an open tail — a closed curve leaves the oldest ages undefined', () => {
    const r = curve([{ upTo: 40, value: 0.5 }, { upTo: 80, value: 0.6 }])
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/must end with an open tail segment/)
  })

  it('rejects an interior open tail, which would make later segments unreachable', () => {
    const r = curve([{ upTo: null, value: 0.5 }, { upTo: null, value: 0.6 }])
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/is null but is not the last segment/)
  })

  it(`rejects a cliff steeper than ${MAX_AGE_CURVE_SLOPE} between adjacent segments`, () => {
    const r = curve([{ upTo: 39, value: 0 }, { upTo: null, value: 1 }])
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/jumps 1\.00 from the previous segment/)
  })

  it('accepts the shipped curve', () => {
    expect(curve(DEFAULT_SCORING_CONFIG.ageCurve).ok).toBe(true)
  })
})

describe('groups must actually group the components', () => {
  it('rejects a group naming an unknown component', () => {
    const r = ok({ groups: { meet: ['engagement', 'charisma'], buy: DEFAULT_SCORING_CONFIG.groups.buy } })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/groups\.meet names an unknown component: charisma/)
  })

  it('rejects a component in BOTH groups — it would land in two denominators', () => {
    const r = ok({
      groups: { meet: [...DEFAULT_SCORING_CONFIG.groups.meet, 'age'], buy: DEFAULT_SCORING_CONFIG.groups.buy },
    })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/component "age" is in both groups/)
  })

  it('rejects a weighted component that is in no group — it would score nothing', () => {
    const r = ok({
      groups: { meet: DEFAULT_SCORING_CONFIG.groups.meet, buy: ['life_events', 'family_gap', 'capacity', 'age'] },
    })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/component "coverage_headroom" has a weight but is in no group/)
  })

  it('does NOT require leadComponents in groups — normalizeLeadConfig folds them into meet at read', () => {
    expect(Object.keys(DEFAULT_LEAD_COMPONENTS)).toEqual(['response', 'screening'])
    expect(validateScoringConfig({ leadComponents: DEFAULT_LEAD_COMPONENTS }).ok).toBe(true)
  })
})

describe('assorted shape checks', () => {
  it.each([null, 'a config', 42, []])('rejects %p as a config', (bad) => {
    expect(validateScoringConfig(bad).ok).toBe(false)
  })

  it('rejects minFactConfidence outside 0..1', () => {
    expect(ok({ minFactConfidence: 1.4 }).ok).toBe(false)
  })

  it('rejects a targetSegment weight outside 0..1', () => {
    expect(ok({ targetSegments: [{ language: 'zh', weight: 5 }] }).ok).toBe(false)
  })

  it('rejects a blank algorithmVersion', () => {
    expect(ok({ algorithmVersion: '   ' }).ok).toBe(false)
  })
})
