/**
 * Malformed-:id 404 guard (teardown PR) — a truncated/garbage campaign id must
 * 404 cleanly instead of leaking a Postgres uuid-cast 500 (the "Database
 * Error" panel paper cut found during the rollout). Shared middleware,
 * attached to the campaigns, adminCampaigns and campaignPreviews routers.
 */
import { jest } from '@jest/globals';
import './setup.js';
import { uuidParamGuard, UUID_PARAM_RE } from '../src/middleware/uuidParam.js';

const run = (id, label = 'Campaign') => {
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
  const next = jest.fn();
  uuidParamGuard(label)({}, res, next, id);
  return { res, next };
};

describe('uuidParamGuard', () => {
  it('passes a well-formed uuid through', () => {
    const { res, next } = run('0718ba3c-36a1-4a8d-928e-f02c03f4eef1');
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it.each([
    ['0718ba3c-36a1-4a8d-928e-f02c03f4eef'], // the real incident: one char short
    ['not-a-uuid'],
    ['0718ba3c-36a1-4a8d-928e-f02c03f4eef11'], // one char long
    [''],
    ['0718BA3C-36A1-4A8D-928E-F02C03F4EEF1Z'],
  ])('404s the malformed id %s without touching the DB', (id) => {
    const { res, next } = run(id);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Campaign not found' });
  });

  it('labels the 404 by entity', () => {
    const { res } = run('junk', 'Preview');
    expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Preview not found' });
  });

  it('accepts uppercase hex (case-insensitive)', () => {
    expect(UUID_PARAM_RE.test('0718BA3C-36A1-4A8D-928E-F02C03F4EEF1')).toBe(true);
  });

  it('is attached to all three campaign routers (source pin — jest ESM cannot dynamic-import the full route graph)', async () => {
    const { readFileSync } = await import('node:fs');
    for (const file of ['campaigns.js', 'adminCampaigns.js', 'campaignPreviews.js']) {
      const src = readFileSync(new URL(`../src/routes/${file}`, import.meta.url), 'utf8');
      expect(src).toMatch(/router\.param\('id', uuidParamGuard\('Campaign'\)\)/);
    }
  });
});
