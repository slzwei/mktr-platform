/**
 * M9 (review round 3): the per-campaign round-robin queue map drains.
 *
 * enqueueCampaign's cleanup ran `if (rrQueues.get(id) === chain) delete` —
 * but the map stored `chain.catch(...)`, a DIFFERENT Promise object, so the
 * identity check was always false. Every distinct campaign ever routed left a
 * settled promise in the process-global Map forever: campaign churn grew the
 * heap until restart.
 *
 * Post-fix the map stores the exact object the cleanup compares (rejection
 * swallowing is attached WITHOUT replacing the stored identity), so the last
 * settled task removes its entry.
 */
import { enqueueCampaign, rrQueueSize } from '../../src/services/systemAgent.js';

const drainMicrotasks = () => new Promise((resolve) => setImmediate(resolve));

describe('enqueueCampaign map hygiene', () => {
  it('a successful task removes its campaign entry once settled', async () => {
    const before = rrQueueSize();
    await expect(enqueueCampaign('m9-camp-ok', async () => 42)).resolves.toBe(42);
    await drainMicrotasks();
    // Pre-fix this stayed at before+1 forever — the leak.
    expect(rrQueueSize()).toBe(before);
  });

  it('a FAILED task still rejects to the caller AND removes its entry', async () => {
    const before = rrQueueSize();
    await expect(
      enqueueCampaign('m9-camp-fail', async () => { throw new Error('routing blew up'); })
    ).rejects.toThrow('routing blew up');
    await drainMicrotasks();
    expect(rrQueueSize()).toBe(before);
  });

  it('serialization survives: same-campaign tasks run strictly in order, then drain', async () => {
    const order = [];
    const slow = enqueueCampaign('m9-camp-serial', async () => {
      await new Promise((r) => setTimeout(r, 30));
      order.push('first');
    });
    const fast = enqueueCampaign('m9-camp-serial', async () => {
      order.push('second');
    });
    await Promise.all([slow, fast]);
    expect(order).toEqual(['first', 'second']);
    await drainMicrotasks();
    expect(rrQueueSize()).toBe(0);
  });

  it('a task enqueued after a failure still runs (the stored tail swallows rejections)', async () => {
    await expect(
      enqueueCampaign('m9-camp-recover', async () => { throw new Error('boom'); })
    ).rejects.toThrow('boom');
    await expect(enqueueCampaign('m9-camp-recover', async () => 'recovered')).resolves.toBe('recovered');
    await drainMicrotasks();
    expect(rrQueueSize()).toBe(0);
  });
});
