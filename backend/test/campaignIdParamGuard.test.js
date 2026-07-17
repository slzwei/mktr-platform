/**
 * Malformed-:id 404 guard (teardown PR) — a truncated/garbage campaign id must
 * 404 cleanly instead of leaking a Postgres uuid-cast 500 (the "Database
 * Error" panel paper cut found during the rollout).
 */
import { jest } from '@jest/globals';
import './setup.js';
import { campaignIdParamGuard, UUID_PARAM_RE } from '../src/routes/campaigns.js';

const run = (id) => {
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
  const next = jest.fn();
  campaignIdParamGuard({}, res, next, id);
  return { res, next };
};

describe('campaignIdParamGuard', () => {
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

  it('accepts uppercase hex (case-insensitive)', () => {
    expect(UUID_PARAM_RE.test('0718BA3C-36A1-4A8D-928E-F02C03F4EEF1')).toBe(true);
  });
});
