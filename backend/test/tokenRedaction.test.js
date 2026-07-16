/**
 * Reward-claim tokens are live bearer credentials that ride in URLs — PR A
 * masks them at every logging/telemetry layer (Codex blocker: the exposure
 * predates PR A; pino-http, errorHandler, Sentry request.url and the frontend
 * client all logged them raw).
 */
import { jest } from '@jest/globals';
import { maskTokenUrl, maskEmail } from '../src/utils/redactTokens.js';
import { scrubEvent, scrubBreadcrumb } from '../src/utils/sentryScrub.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { logger } from '../src/utils/logger.js';

const TOKEN = 'aB3xY9zQ7wK2mN8pL5vC1dF6gH4jR0sT_uEiOa-b';

describe('maskTokenUrl', () => {
  test('masks the reward-claim api path', () => {
    expect(maskTokenUrl(`/api/reward-claim/${TOKEN}`)).toBe('/api/reward-claim/[token]');
  });

  test('masks the consumer /r/ path incl. absolute urls and query strings', () => {
    expect(maskTokenUrl(`https://redeem.sg/r/${TOKEN}?utm_source=x`)).toBe('https://redeem.sg/r/[token]?utm_source=x');
  });

  test('masks every occurrence, leaves other urls alone', () => {
    const s = `GET /api/reward-claim/${TOKEN} then /r/${TOKEN} then /api/redeem-ops/entitlements/123`;
    const masked = maskTokenUrl(s);
    expect(masked).not.toContain(TOKEN);
    expect(masked).toContain('/api/redeem-ops/entitlements/123');
  });

  test('non-string / empty inputs pass through', () => {
    expect(maskTokenUrl(null)).toBeNull();
    expect(maskTokenUrl(undefined)).toBeUndefined();
    expect(maskTokenUrl('')).toBe('');
  });
});

describe('maskEmail', () => {
  test('keeps first char + domain only', () => {
    expect(maskEmail('shawn@gmail.com')).toBe('s•••@gmail.com');
  });
  test('degrades safely on junk', () => {
    expect(maskEmail('')).toBe('');
    expect(maskEmail('nodomain')).toBe('•••');
  });
});

describe('sentry scrubbing', () => {
  test('event.request.url is masked', () => {
    const event = { request: { url: `https://api.mktr.sg/api/reward-claim/${TOKEN}`, data: {} } };
    const out = scrubEvent(event);
    expect(out.request.url).toBe('https://api.mktr.sg/api/reward-claim/[token]');
  });

  test('breadcrumb url + message are masked', () => {
    const crumb = {
      message: `GET /api/reward-claim/${TOKEN} failed`,
      data: { url: `/r/${TOKEN}`, method: 'GET' },
    };
    const out = scrubBreadcrumb(crumb);
    expect(out.data.url).toBe('/r/[token]');
    expect(out.message).not.toContain(TOKEN);
  });
});

describe('errorHandler request logging', () => {
  test('logs the masked url, never the raw token', () => {
    const spy = jest.spyOn(logger, 'error').mockImplementation(() => {});
    const req = { method: 'GET', originalUrl: `/api/reward-claim/${TOKEN}`, id: 'req-1' };
    const res = { status: () => ({ json: () => {} }) };
    errorHandler(new Error('boom'), req, res, () => {});
    const logged = spy.mock.calls.at(-1)[0];
    expect(logged.req.url).toBe('/api/reward-claim/[token]');
    expect(JSON.stringify(logged)).not.toContain(TOKEN);
    spy.mockRestore();
  });
});
