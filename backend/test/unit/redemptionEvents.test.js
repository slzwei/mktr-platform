/**
 * P3-2: the shared redemption_events writer.
 *
 * entitlementService and redemptionService each carried a private copy of this
 * function, byte-identical apart from the default actorType — and that default
 * is the whole point of an audit row. 'system' means a sweep, hook or cascade
 * did it; 'staff' means a human at the counter did. Getting it backwards
 * mis-attributes history silently: nothing fails, the row is just wrong.
 *
 * Two copies is exactly how that drifts, so the copies are now one function
 * with the default as a parameter — and this pins both.
 */
import { jest } from '@jest/globals';
import '../setup.js';
import { makeRedemptionEventWriter } from '../../src/services/redeemOps/redemptionEvents.js';

const deps = () => {
  const create = jest.fn().mockResolvedValue({ id: 'ev-1' });
  return { d: { RedemptionEvent: { create } }, create };
};

const attrsOf = (create) => create.mock.calls[0][0];

describe('makeRedemptionEventWriter', () => {
  it('attributes the entitlement engine to the system', async () => {
    const { d, create } = deps();
    await makeRedemptionEventWriter(d, 'system')(null, { entitlementId: 'e-1', type: 'reserved' });

    expect(attrsOf(create)).toMatchObject({ entitlementId: 'e-1', type: 'reserved', actorType: 'system' });
  });

  it('attributes the redemption counter to staff', async () => {
    const { d, create } = deps();
    await makeRedemptionEventWriter(d, 'staff')(null, { entitlementId: 'e-1', type: 'verify_attempt' });

    expect(attrsOf(create).actorType).toBe('staff');
  });

  it('defaults to system when no default is named', async () => {
    const { d, create } = deps();
    await makeRedemptionEventWriter(d)(null, { entitlementId: 'e-1', type: 'reserved' });

    expect(attrsOf(create).actorType).toBe('system');
  });

  it('lets an explicit actor on the event win over the default', async () => {
    const { d, create } = deps();
    await makeRedemptionEventWriter(d, 'system')(null, {
      entitlementId: 'e-1', type: 'unlocked', actorType: 'staff', actorUserId: 'u-9',
    });

    expect(attrsOf(create)).toMatchObject({ actorType: 'staff', actorUserId: 'u-9' });
  });

  it('nulls the optional fields rather than leaving them undefined', async () => {
    const { d, create } = deps();
    await makeRedemptionEventWriter(d, 'system')(null, { entitlementId: 'e-1', type: 'reserved' });

    expect(attrsOf(create)).toMatchObject({ redemptionId: null, metadata: null, actorUserId: null });
  });

  it('passes the transaction straight through', async () => {
    const { d, create } = deps();
    const t = { fake: 'txn' };
    await makeRedemptionEventWriter(d, 'system')(t, { entitlementId: 'e-1', type: 'reserved' });

    expect(create.mock.calls[0][1]).toEqual({ transaction: t });
  });

  it('reads the model at CALL time, so a late dependency override still applies', async () => {
    // Both services build their writer once at factory time but let tests swap
    // d.RedemptionEvent afterwards. Binding the model early would break that.
    const { d } = deps();
    const writeEvent = makeRedemptionEventWriter(d, 'system');

    const swapped = jest.fn().mockResolvedValue({ id: 'ev-2' });
    d.RedemptionEvent = { create: swapped };
    await writeEvent(null, { entitlementId: 'e-1', type: 'reserved' });

    expect(swapped).toHaveBeenCalled();
  });
});
