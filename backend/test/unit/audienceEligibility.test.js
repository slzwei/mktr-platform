/**
 * The audience eligibility engine (ads-centralisation §5.1/§5.2): policy
 * matrix, the fixed filter order, the edit-suppression anti-join, the
 * env-driven Meta consent posture, and shaping smoke over engine output.
 * The §5.2 DIFFERENTIAL HARNESS — engine ≡ legacy with the single intended
 * diff (Meta checkErased) — ran against the since-deleted __legacy exports
 * in the previous commit; the PR's history carries the pinned parity proof.
 */
import '../setup.js';
import {
  AUDIENCE_POLICIES,
  filterEligible,
} from '../../src/services/audienceEligibilityService.js';
import { shapeMetaAudienceRows } from '../../src/services/redeemedAudienceService.js';
import { shapeGoogleMemberRows } from '../../src/services/googleCustomerMatchService.js';
import { phoneHashOf } from '../../src/services/consumerService.js';

const CID = '22222222-2222-4222-8222-222222222222';

/** A verified-binding stamp for `phone` (phoneVerificationIsCurrent === true). */
const verifiedSm = (phone) => ({
  phoneVerifiedAt: '2026-08-01T00:00:00.000Z',
  phoneVerifiedFor: phoneHashOf(phone),
});

function fixtures() {
  return [
    // 1. fully eligible everywhere
    { id: 'p-ok', email: 'ok@example.com', phone: '+6590000001', campaignId: CID, sourceMetadata: verifiedSm('+6590000001') },
    // 2. granted but SUPPRESSED
    { id: 'p-sup', email: 'sup@example.com', phone: '+6590000002', campaignId: CID, sourceMetadata: verifiedSm('+6590000002') },
    // 3. no grant entry (ungranted)
    { id: 'p-nogrant', email: 'no@example.com', phone: '+6590000003', campaignId: CID, sourceMetadata: verifiedSm('+6590000003') },
    // 4. ERASED skeleton that still carries identifiers (the intended-diff probe)
    { id: 'p-erased', email: 'erased@example.com', phone: '+6590000004', campaignId: CID, sourceMetadata: { ...verifiedSm('+6590000004'), erased: true } },
    // 5. UNVERIFIED binding (stale stamp for a different number)
    { id: 'p-unver', email: 'unver@example.com', phone: '+6590000005', campaignId: CID, sourceMetadata: { phoneVerifiedAt: '2026-08-01T00:00:00.000Z', phoneVerifiedFor: phoneHashOf('+6599999999') } },
    // 6. synthetic Retell email, granted (email dropped at shaping, phone rides)
    { id: 'p-synth', email: 'call-1@calls.mktr.sg', phone: '+6590000006', campaignId: CID, sourceMetadata: verifiedSm('+6590000006') },
    // 7. neither identifier usable
    { id: 'p-empty', email: null, phone: null, campaignId: CID, sourceMetadata: verifiedSm('') },
  ];
}

const grantMapFor = (...phones) => new Map(phones.map((p) => [p, new Map([[CID, true]])]));

function ctxOf({ requireConsent }) {
  return {
    suppressedPhones: new Set(['+6590000002']),
    grantMap: requireConsent
      ? grantMapFor('+6590000001', '+6590000002', '+6590000004', '+6590000005', '+6590000006')
      : null,
    editSuppressedProspectIds: new Set(),
  };
}

afterEach(() => {
  delete process.env.REDEEMED_AUDIENCE_REQUIRE_CONSENT;
});
describe('shaping over engine output (§5.2 split of duties)', () => {
  it('Meta shaping: synthetic email dropped, hashes only, empty-identifier rows removed', () => {
    const ctx = ctxOf({ requireConsent: false });
    const policy = { scope: 'global', requireConsent: false, requireVerifiedBinding: false, checkErased: true };
    const rows = shapeMetaAudienceRows(filterEligible(fixtures(), ctx, policy));
    // Eligible on this path: p-ok, p-nogrant (no consent required), p-unver
    // (meta has no binding requirement), p-synth (email dropped, phone
    // rides); p-erased and p-sup filtered; p-empty dropped at shaping.
    expect(rows).toHaveLength(4);
    for (const [em, ph] of rows) {
      expect(em).toMatch(/^$|^[a-f0-9]{64}$/);
      expect(ph).toMatch(/^$|^[a-f0-9]{64}$/);
    }
    expect(rows.some(([em, ph]) => em === '' && ph !== '')).toBe(true); // the synthetic-email person kept phone-only
  });

  it('Google shaping: identifier objects, synthetic email dropped, empty rows removed', () => {
    const ctx = ctxOf({ requireConsent: true });
    const rows = shapeGoogleMemberRows(filterEligible(fixtures(), ctx, AUDIENCE_POLICIES.google));
    expect(rows).toHaveLength(2); // p-ok (em+ph) and p-synth (ph only)
    expect(rows.every((r) => r.userIdentifiers.length >= 1)).toBe(true);
  });
});

describe('engine policy matrix (§5.1)', () => {
  it('AUDIENCE_POLICIES.meta reads the consent env at ACCESS time', () => {
    expect(AUDIENCE_POLICIES.meta.requireConsent).toBe(true);
    process.env.REDEEMED_AUDIENCE_REQUIRE_CONSENT = 'false';
    expect(AUDIENCE_POLICIES.meta.requireConsent).toBe(false);
    expect(AUDIENCE_POLICIES.meta.checkErased).toBe(true);
    expect(AUDIENCE_POLICIES.google).toMatchObject({ scope: 'campaign', requireVerifiedBinding: true });
    expect(AUDIENCE_POLICIES.tiktok).toMatchObject({ scope: 'global', requireConsent: true });
  });

  it('edit-suppression removes the subject from additive selection (§5.1 identifier-edit convergence)', () => {
    const ctx = { ...ctxOf({ requireConsent: true }), editSuppressedProspectIds: new Set(['p-ok']) };
    const engine = filterEligible(fixtures(), ctx, AUDIENCE_POLICIES.google);
    expect(engine.find((p) => p.id === 'p-ok')).toBeUndefined();
    // …and comes back once the removal settles (empty set).
    const after = filterEligible(fixtures(), ctxOf({ requireConsent: true }), AUDIENCE_POLICIES.google);
    expect(after.find((p) => p.id === 'p-ok')).toBeTruthy();
  });

  it('applies the fixed §5.1 order: erased wins over every later gate', () => {
    const erasedButOtherwisePerfect = [{
      id: 'p-x', email: 'x@example.com', phone: '+6590000009', campaignId: CID,
      sourceMetadata: { ...verifiedSm('+6590000009'), erased: true },
    }];
    const ctx = { suppressedPhones: new Set(), grantMap: grantMapFor('+6590000009'), editSuppressedProspectIds: new Set() };
    expect(filterEligible(erasedButOtherwisePerfect, ctx, AUDIENCE_POLICIES.google)).toHaveLength(0);
  });
});
