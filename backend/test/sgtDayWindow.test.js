import { sgtDayWindow } from '../src/services/redeemOps/taskService.js';

describe('sgtDayWindow', () => {
  test('flips the current Singapore calendar day at 16:00 UTC', () => {
    const beforeBoundary = sgtDayWindow(new Date('2026-07-14T15:59:00.000Z'));
    const afterBoundary = sgtDayWindow(new Date('2026-07-14T16:01:00.000Z'));

    expect(beforeBoundary.start.toISOString()).toBe('2026-07-13T16:00:00.000Z');
    expect(beforeBoundary.end.toISOString()).toBe('2026-07-14T16:00:00.000Z');
    expect(afterBoundary.start.toISOString()).toBe('2026-07-14T16:00:00.000Z');
    expect(afterBoundary.end.toISOString()).toBe('2026-07-15T16:00:00.000Z');
  });
});
