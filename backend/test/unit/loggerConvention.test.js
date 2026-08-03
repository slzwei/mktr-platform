/**
 * The house logging convention — logger.warn('message', { meta }) — versus
 * raw pino, whose contract is (mergingObject, message) and which silently
 * DROPS extra args after a placeholder-less string. Pre-adapter, every
 * structured field attached to a production log line was missing from the
 * JSON output while dev's pino-pretty rendered it, masking the loss.
 * adaptHouseConvention reorders the house call into pino's contract; these
 * tests pin every calling shape against a capture stream.
 */
import pino from 'pino';
import { adaptHouseConvention } from '../../src/utils/logger.js';

function capture() {
  const lines = [];
  const base = pino({ base: null, timestamp: false }, { write: (s) => lines.push(JSON.parse(s)) });
  return { log: adaptHouseConvention(base), lines };
}

describe('adaptHouseConvention', () => {
  it("house convention ('msg', {meta}) lands the meta as JSON fields", () => {
    const { log, lines } = capture();
    log.warn('lead held', { campaignId: 'c-123', reason: 'no_funded_agent' });
    expect(lines[0]).toMatchObject({ msg: 'lead held', campaignId: 'c-123', reason: 'no_funded_agent' });
  });

  it('raw pino DROPS the house-convention meta — the loss this adapter exists for', () => {
    const lines = [];
    const raw = pino({ base: null, timestamp: false }, { write: (s) => lines.push(JSON.parse(s)) });
    raw.warn('lead held', { campaignId: 'c-123' });
    expect(lines[0].campaignId).toBeUndefined(); // documents the underlying behaviour
  });

  it("('msg', Error) serializes through the err serializer", () => {
    const { log, lines } = capture();
    log.error('boom happened', new Error('kaboom'));
    expect(lines[0].msg).toBe('boom happened');
    expect(lines[0].err?.message).toBe('kaboom');
    expect(lines[0].err?.stack).toContain('kaboom');
  });

  it("pino-native (obj, 'msg') passes through untouched", () => {
    const { log, lines } = capture();
    log.info({ deliveryId: 'd-1' }, 'delivered');
    expect(lines[0]).toMatchObject({ msg: 'delivered', deliveryId: 'd-1' });
  });

  it('single-string and printf-style calls pass through', () => {
    const { log, lines } = capture();
    log.info('plain message');
    log.info('value is %d', 42);
    expect(lines[0].msg).toBe('plain message');
    expect(lines[1].msg).toBe('value is 42');
  });

  it('child loggers keep both the bindings and the house convention', () => {
    const { log, lines } = capture();
    const child = log.child({ component: 'webhook' });
    child.warn('retrying', { deliveryId: 'd-9' });
    expect(lines[0]).toMatchObject({ msg: 'retrying', component: 'webhook', deliveryId: 'd-9' });
  });
});
