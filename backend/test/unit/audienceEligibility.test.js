/**
 * The audience eligibility engine (ads-centralisation §5.1/§5.2):
 *  1. DIFFERENTIAL HARNESS — the same fixture set through the kept __legacy
 *     select/filter exports vs the engine + per-platform shaping. Outputs are
 *     IDENTICAL, including Meta's REQUIRE_CONSENT=false no-grant-map path,
 *     with exactly ONE intended diff asserted: the engine's explicit Meta
 *     checkErased (legacy Meta only excluded erased rows incidentally via
 *     their missing grant entries, so the consent escape hatch re-admitted
 *     them). Once this harness has pinned parity the __legacy exports die.
 *  2. Engine policy matrix — the fixed filter order, the edit-suppression
 *     anti-join, and the env-driven Meta consent posture.
 */
import '../setup.js';
import {
  AUDIENCE_POLICIES,
  filterEligible,
} from '../../src/services/audienceEligibilityService.js';
import {
  __legacyBuildUserRows,
  shapeMetaAudienceRows,
} from '../../src/services/redeemedAudienceService.js';
import {
  __legacyBuildMemberRows,
  shapeGoogleMemberRows,
} from '../../src/services/googleCustomerMatchService.js';
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

describe('§5.2 differential harness — Meta', () => {
  it('requireConsent=true: legacy and engine produce IDENTICAL rows', () => {
    const ctx = ctxOf({ requireConsent: true });
    const legacy = __legacyBuildUserRows(fixtures(), {
      requireConsent: true,
      suppressedPhones: ctx.suppressedPhones,
      grantMap: ctx.grantMap,
    });
    const policy = { scope: 'global', requireConsent: true, requireVerifiedBinding: false, checkErased: true };
    const engine = shapeMetaAudienceRows(filterEligible(fixtures(), ctx, policy));
    // The grantMap fixture deliberately grants the ERASED row too — in
    // production an erased consumer has no grant entry, which is precisely
    // why legacy Meta's missing erased-check went unnoticed. With the grant
    // present, the single intended diff (engine checkErased) surfaces on the
    // consent path as well: engine ≡ legacy-without-the-erased-row.
    const legacyWithoutErased = __legacyBuildUserRows(
      fixtures().filter((p) => p.sourceMetadata?.erased !== true),
      { requireConsent: true, suppressedPhones: ctx.suppressedPhones, grantMap: ctx.grantMap }
    );
    expect(engine).toEqual(legacyWithoutErased);
    expect(legacy.length).toBe(engine.length + 1); // legacy carried exactly the erased row
  });

  it('REQUIRE_CONSENT=false (no grant map): identical EXCEPT the ONE intended diff — the engine drops erased skeletons', () => {
    const ctx = ctxOf({ requireConsent: false });
    const legacy = __legacyBuildUserRows(fixtures(), {
      requireConsent: false,
      suppressedPhones: ctx.suppressedPhones,
      grantMap: null,
    });
    const policy = { scope: 'global', requireConsent: false, requireVerifiedBinding: false, checkErased: true };
    const engine = shapeMetaAudienceRows(filterEligible(fixtures(), ctx, policy));
    // Legacy re-admits the erased-with-identifiers row on this path; the
    // engine's checkErased is the single intended diff (§5.2).
    const legacyMinusErased = __legacyBuildUserRows(
      fixtures().filter((p) => p.sourceMetadata?.erased !== true),
      { requireConsent: false, suppressedPhones: ctx.suppressedPhones, grantMap: null }
    );
    expect(engine).toEqual(legacyMinusErased);
    expect(legacy.length).toBe(engine.length + 1); // exactly the erased row
  });
});

describe('§5.2 differential harness — Google', () => {
  it('legacy and engine produce IDENTICAL member rows (no intended diff)', () => {
    const ctx = ctxOf({ requireConsent: true });
    const legacy = __legacyBuildMemberRows(fixtures(), {
      suppressedPhones: ctx.suppressedPhones,
      grantMap: ctx.grantMap,
    });
    const engine = shapeGoogleMemberRows(filterEligible(fixtures(), ctx, AUDIENCE_POLICIES.google));
    expect(engine).toEqual(legacy);
    // Sanity: the harness is not vacuous — the eligible + synthetic-email
    // rows survive on both sides.
    expect(engine.length).toBe(2);
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
