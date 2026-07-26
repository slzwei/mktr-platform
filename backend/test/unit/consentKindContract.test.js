import { MARKETING_CONSENT_KIND } from '../../src/services/consumerScoringService.js'
import ConsentEvent from '../../src/models/ConsentEvent.js'

/**
 * The consent kind the scorer queries must be a kind that can actually exist.
 *
 * This guards a bug that shipped to production: `loadTelemetry` filtered on
 * `ce.kind = 'marketing'`, which is not in ConsentEvent's enum and never has
 * been. The query was valid SQL, returned no rows, and silently made
 * marketingConsent FALSE for every consumer — docking 0.45 of contactability
 * from the 128 of 130 people who HAD granted consent. Nothing failed; the
 * scores were just quietly wrong.
 *
 * The literal lived inside a SQL string, so no unit test could see it and only
 * an integration test with exactly the right fixture would have caught it.
 * Hence the exported constant: the contract between the scorer and the ledger
 * is now a value two modules can be compared on.
 */

/** Pull the allowed values straight off the model — never restate them here. */
function allowedConsentKinds() {
  const validate = ConsentEvent.rawAttributes.kind.validate
  const isIn = validate?.isIn
  // Sequelize accepts both `isIn: [[…]]` and `isIn: { args: [[…]] }`.
  const list = Array.isArray(isIn) ? isIn[0] : isIn?.args?.[0]
  return list
}

describe('marketing consent kind contract', () => {
  test('the model actually declares an allowlist we can check against', () => {
    const kinds = allowedConsentKinds()
    expect(Array.isArray(kinds)).toBe(true)
    expect(kinds.length).toBeGreaterThan(0)
  })

  test('the kind the scorer queries is one the ledger can store', () => {
    expect(allowedConsentKinds()).toContain(MARKETING_CONSENT_KIND)
  })

  test("'marketing' is NOT a storable kind — the exact bug that shipped", () => {
    // If someone ever adds a 'marketing' kind this test should be deleted,
    // not silenced: the scorer would then need to decide which kind it means.
    expect(allowedConsentKinds()).not.toContain('marketing')
  })

  test('the kind is `contact`, which the UI labels "marketing"', () => {
    // The mismatch between the stored name and the displayed name is how the
    // wrong literal got written in the first place. Pinned so the next person
    // reads this instead of guessing.
    expect(MARKETING_CONSENT_KIND).toBe('contact')
  })
})
