/**
 * makeDrawLink override hygiene — regression for the 2026-07-25 outage.
 *
 * entitlementService forwarded `Campaign: d.Campaign` while `Campaign` wasn't
 * in its deps, so the overrides spread clobbered drawLink's own valid model
 * with undefined and EVERY production unlock 500'd at d.Campaign.findByPk.
 * Contract under test: undefined override VALUES fall back to the module's
 * real imports; defined overrides still win; a null overrides bag is
 * tolerated. Deliberate absence in a hermetic test must use a throwing stub
 * or null — never undefined.
 */
import { jest } from '@jest/globals';
import { makeDrawLink } from '../../src/services/redeemOps/drawLink.js';
import { Activation, Campaign } from '../../src/models/index.js';

afterEach(() => jest.restoreAllMocks());

test('undefined override values fall back to the real models (the clobber shape)', async () => {
  jest.spyOn(Activation, 'findByPk').mockResolvedValue({ id: 'act1', campaignId: 'c1' });
  const campaignSpy = jest.spyOn(Campaign, 'findByPk').mockResolvedValue(null);

  const link = makeDrawLink({ Activation: undefined, Campaign: undefined });
  const ctx = await link.drawContextForActivation('act1');

  // Pre-fix this threw "Cannot read properties of undefined (reading 'findByPk')".
  expect(campaignSpy).toHaveBeenCalledWith('c1', expect.anything());
  expect(ctx).toBeNull(); // campaign row absent — clean null, never a TypeError
});

test('a null overrides bag is tolerated', () => {
  expect(() => makeDrawLink(null)).not.toThrow();
});

test('defined overrides still win over the module imports', async () => {
  const fakeActivation = { findByPk: jest.fn(async () => null) };
  const realSpy = jest.spyOn(Activation, 'findByPk').mockResolvedValue({ id: 'x', campaignId: 'c9' });

  const link = makeDrawLink({ Activation: fakeActivation });
  const ctx = await link.drawContextForActivation('missing');

  expect(fakeActivation.findByPk).toHaveBeenCalled();
  expect(realSpy).not.toHaveBeenCalled();
  expect(ctx).toBeNull();
});
