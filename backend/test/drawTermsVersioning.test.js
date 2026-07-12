/**
 * Draw-terms versioning (campaignService.ensureDrawTermsVersion, DI seam) —
 * docs/plans/lucky-draw-10x.md §4.6. Pins: enabling a draw without T&C content
 * 422s; new content mints version N+1; unchanged content is idempotent (reuses
 * the row); the result stamps termsVersionId + termsHash into luckyDraw.
 */
import crypto from 'crypto';
import { jest } from '@jest/globals';
import { ensureDrawTermsVersion } from '../src/services/campaignService.js';

const CAMPAIGN_ID = 'camp-1';
const USER_ID = 'admin-1';

function fakeModel({ existing = null, latestVersion = null } = {}) {
  const created = [];
  return {
    created,
    findOne: jest.fn().mockResolvedValue(existing),
    max: jest.fn().mockResolvedValue(latestVersion),
    create: jest.fn().mockImplementation((fields) => {
      const row = { id: `dtv-${created.length + 1}`, ...fields };
      created.push(row);
      return Promise.resolve(row);
    }),
  };
}

describe('ensureDrawTermsVersion', () => {
  it('passes through untouched when luckyDraw is absent or disabled', async () => {
    const DrawTermsVersion = fakeModel();
    const plain = { termsContent: 'x' };
    expect(await ensureDrawTermsVersion(plain, CAMPAIGN_ID, USER_ID, { DrawTermsVersion })).toBe(plain);
    const off = { luckyDraw: { enabled: false } };
    expect(await ensureDrawTermsVersion(off, CAMPAIGN_ID, USER_ID, { DrawTermsVersion })).toBe(off);
    expect(DrawTermsVersion.findOne).not.toHaveBeenCalled();
  });

  it('422s when an enabled draw has no closesAt', async () => {
    const DrawTermsVersion = fakeModel();
    await expect(
      ensureDrawTermsVersion({ luckyDraw: { enabled: true }, termsContent: '<p>Rules</p>' }, CAMPAIGN_ID, USER_ID, { DrawTermsVersion })
    ).rejects.toMatchObject({ statusCode: 422 });
  });

  it('422s when an enabled draw has no T&C content', async () => {
    const DrawTermsVersion = fakeModel();
    await expect(
      ensureDrawTermsVersion({ luckyDraw: { enabled: true, closesAt: '2026-08-31' }, termsContent: '   ' }, CAMPAIGN_ID, USER_ID, { DrawTermsVersion })
    ).rejects.toMatchObject({ statusCode: 422 });
    expect(DrawTermsVersion.create).not.toHaveBeenCalled();
  });

  it('mints version N+1 for new content and stamps id + hash into luckyDraw', async () => {
    const DrawTermsVersion = fakeModel({ latestVersion: 3 });
    const designConfig = { luckyDraw: { enabled: true, closesAt: '2026-08-31', prize: 'Luggage' }, termsContent: '  <p>Draw rules v4</p> ' };
    const out = await ensureDrawTermsVersion(designConfig, CAMPAIGN_ID, USER_ID, { DrawTermsVersion });

    const expectedHash = crypto.createHash('sha256').update('<p>Draw rules v4</p>').digest('hex');
    expect(DrawTermsVersion.create).toHaveBeenCalledWith(expect.objectContaining({
      campaignId: CAMPAIGN_ID,
      version: 4,
      content: '<p>Draw rules v4</p>',
      contentSha256: expectedHash,
      createdBy: USER_ID,
    }));
    expect(out.luckyDraw).toMatchObject({ enabled: true, prize: 'Luggage', termsVersionId: 'dtv-1', termsHash: expectedHash });
    // Input is not mutated — a fresh object is returned.
    expect(designConfig.luckyDraw.termsVersionId).toBeUndefined();
  });

  it('is idempotent: unchanged content reuses the existing version row', async () => {
    const hash = crypto.createHash('sha256').update('<p>Rules</p>').digest('hex');
    const DrawTermsVersion = fakeModel({ existing: { id: 'dtv-existing', version: 2, contentSha256: hash } });
    const out = await ensureDrawTermsVersion(
      { luckyDraw: { enabled: true, closesAt: '2026-08-31' }, termsContent: '<p>Rules</p>' },
      CAMPAIGN_ID, USER_ID, { DrawTermsVersion }
    );
    expect(DrawTermsVersion.create).not.toHaveBeenCalled();
    expect(out.luckyDraw.termsVersionId).toBe('dtv-existing');
    expect(out.luckyDraw.termsHash).toBe(hash);
  });

  it('recovers when a concurrent save minted the version first', async () => {
    const hash = crypto.createHash('sha256').update('<p>Rules</p>').digest('hex');
    const winner = { id: 'dtv-winner', version: 1, contentSha256: hash };
    const DrawTermsVersion = fakeModel();
    DrawTermsVersion.findOne
      .mockResolvedValueOnce(null)       // pre-create lookup: not there yet
      .mockResolvedValueOnce(winner);    // post-conflict retry finds the winner
    DrawTermsVersion.create.mockRejectedValueOnce(new Error('unique violation'));

    const out = await ensureDrawTermsVersion(
      { luckyDraw: { enabled: true, closesAt: '2026-08-31' }, termsContent: '<p>Rules</p>' },
      CAMPAIGN_ID, USER_ID, { DrawTermsVersion }
    );
    expect(out.luckyDraw.termsVersionId).toBe('dtv-winner');
  });
});
