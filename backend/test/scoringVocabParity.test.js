import { LANGUAGES, ETHNICITIES } from '../src/utils/factTaxonomy.js'
import {
  SEGMENT_LANGUAGES, SEGMENT_ETHNICITIES, buildAgeCurveFromBands,
} from '../../src/lib/adminV2/scoringLabels.js'
import { validateScoringConfig } from '../src/utils/scoringConfigValidation.js'
import { DEFAULT_SCORING_CONFIG } from '../src/utils/consumerScoring.js'

/**
 * The editor's vocabulary mirrors the taxonomy's (campaign-scoring-editor
 * §3.1, round-2 B4): factTaxonomy owns the enums; the frontend module carries
 * a labelled copy for its pickers. This pin is what makes the copy safe — an
 * enum added or renamed on either side fails here, not in a 422 an admin
 * meets mid-edit.
 *
 * The age-preset builder is pinned against the REAL validator for every band
 * combination (round-3 M3): presets must be slope-legal by construction, and
 * this proves it against the rule itself, not a copied constant.
 */

test('the editor language and ethnicity pickers mirror the taxonomy exactly', () => {
  expect(SEGMENT_LANGUAGES.map((l) => l.id)).toEqual(LANGUAGES)
  expect(SEGMENT_ETHNICITIES.map((e) => e.id)).toEqual(ETHNICITIES)
})

test('every band-preset combination builds a curve the validator accepts', () => {
  const bands = ['18-29', '30-44', '45-59', '60+']
  // All 15 non-empty subsets.
  for (let mask = 1; mask < 16; mask += 1) {
    const picked = bands.filter((_, i) => mask & (1 << i))
    const curve = buildAgeCurveFromBands(picked)
    expect(curve[curve.length - 1].upTo).toBeNull()
    const check = validateScoringConfig({ ...DEFAULT_SCORING_CONFIG, ageCurve: curve })
    if (!check.ok) throw new Error(`bands ${picked.join('+')} built an invalid curve: ${check.error}`)
  }
})

test('nothing selected builds nothing — the caller keeps its curve', () => {
  expect(buildAgeCurveFromBands([])).toBeNull()
  expect(buildAgeCurveFromBands(undefined)).toBeNull()
})
