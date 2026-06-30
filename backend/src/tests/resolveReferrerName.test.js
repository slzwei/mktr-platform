import { resolveReferrerName } from '../services/prospectService.js';

// Input-guard coverage for the public "Referred by …" resolver. These cases must return
// null WITHOUT a DB lookup (the UUID gate is what stops the public endpoint from being
// used to probe prospects). The same-campaign name guard itself mirrors the already-tested
// createProspect referral logic and needs a DB, so it is exercised via integration.

describe('resolveReferrerName — input guards (DB-free)', () => {
  it('returns null for the anonymous legacy ref (1)', async () => {
    expect(await resolveReferrerName({ ref: '1', campaignId: 'camp-1' })).toBeNull();
  });

  it('returns null for a non-UUID ref (no DB probe)', async () => {
    expect(await resolveReferrerName({ ref: 'not-a-uuid', campaignId: 'camp-1' })).toBeNull();
    expect(await resolveReferrerName({ ref: "'; DROP TABLE prospects; --", campaignId: 'camp-1' })).toBeNull();
  });

  it('returns null when campaignId is missing (same-campaign guard needs it)', async () => {
    expect(await resolveReferrerName({ ref: '5f1e9c1a-2222-4444-8888-aaaaaaaaaaaa' })).toBeNull();
  });

  it('returns null for empty / missing input', async () => {
    expect(await resolveReferrerName({})).toBeNull();
    expect(await resolveReferrerName()).toBeNull();
  });
});
