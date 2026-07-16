/**
 * Redeem Ops Discover — AI keyword suggestions (no DB, no HTTP: the service
 * factory takes its deps — cfg / getRuntimeAiSettings / requestStructuredJson —
 * as overrides). Covers: flag gating (503, both flags required), staff-facing
 * error translation (409 unconfigured / 502 provider wording), the LLM-output
 * contract enforcement in normalizeTerms (type guards, # strip, comma strip,
 * whitespace, dedupe, length cap, count cap, IG space-join), the <2-survivors
 * 502, prompt payload shape (untrusted-data framing, area default), and the
 * PDPA rule that the description text is never logged.
 */
import { jest } from '@jest/globals';
import { makeDiscoveryAiService, normalizeTerms, normalizeCategories } from '../src/services/redeemOps/discoveryAiService.js';
import { AppError } from '../src/middleware/errorHandler.js';

const flagsOn = () => ({ enabled: true, aiTermsEnabled: true });
const settings = { provider: 'anthropic', apiKey: 'k', model: 'claude-sonnet-4-6' };
const user = { id: 'user-1' };

function makeSvc(over = {}) {
  const deps = {
    cfg: flagsOn,
    getRuntimeAiSettings: jest.fn(async () => settings),
    requestStructuredJson: jest.fn(async () => ({ terms: ['nail salon', 'lash studio', 'brow bar'] })),
    logger: { info: jest.fn(), error: jest.fn() },
    ...over,
  };
  return { svc: makeDiscoveryAiService(deps), deps };
}

describe('normalizeTerms — LLM output → Discover input contract', () => {
  test('trims, strips #, lowercases, dedupes case-insensitively, drops junk', () => {
    const terms = normalizeTerms(
      ['  Nail Salon ', '#nail salon', 'NAIL SALON', 42, null, '', '   ', 'lash studio'],
      { isInstagram: false },
    );
    expect(terms).toEqual(['nail salon', 'lash studio']);
  });

  test('commas become spaces (the UI joins/splits the field on commas)', () => {
    expect(normalizeTerms(['nail,salon', 'a, b'], { isInstagram: false }))
      .toEqual(['nail salon', 'a b']);
  });

  test('caps at 8 terms and drops terms over 64 chars', () => {
    const many = Array.from({ length: 12 }, (_, i) => `term ${i}`);
    expect(normalizeTerms(many, { isInstagram: false })).toHaveLength(8);
    expect(normalizeTerms(['x'.repeat(65), 'ok'], { isInstagram: false })).toEqual(['ok']);
  });

  test('instagram mode joins spaces into a single hashtag token', () => {
    expect(normalizeTerms(['#SG Nails', 'home based bakery sg'], { isInstagram: true }))
      .toEqual(['sgnails', 'homebasedbakerysg']);
  });

  test('non-array input yields []', () => {
    expect(normalizeTerms(undefined, { isInstagram: false })).toEqual([]);
    expect(normalizeTerms({ terms: [] }, { isInstagram: false })).toEqual([]);
  });
});

describe('normalizeCategories — Maps category-filter contract', () => {
  test('trims, dedupes case-insensitively, PRESERVES case, caps at 6', () => {
    expect(normalizeCategories([' Learning center ', 'learning CENTER', 'Nail salon', 42, '']))
      .toEqual(['Learning center', 'Nail salon']);
    expect(normalizeCategories(Array.from({ length: 9 }, (_, i) => `Cat ${i}`))).toHaveLength(6);
  });
  test('non-array input yields []', () => {
    expect(normalizeCategories(undefined)).toEqual([]);
  });
});

describe('suggestTerms', () => {
  test('503 when the AI flag is off, and when Discover itself is off', async () => {
    for (const flags of [{ enabled: true, aiTermsEnabled: false }, { enabled: false, aiTermsEnabled: true }]) {
      const { svc, deps } = makeSvc({ cfg: () => flags });
      await expect(svc.suggestTerms({ description: 'kids martial arts' }, user))
        .rejects.toMatchObject({ statusCode: 503 });
      expect(deps.getRuntimeAiSettings).not.toHaveBeenCalled();
    }
  });

  test('returns normalized terms and passes the untrusted-data prompt payload', async () => {
    const { svc, deps } = makeSvc();
    const { terms, categories } = await svc.suggestTerms(
      { description: 'kids martial arts', provider: 'google_maps', area: 'Tampines' }, user, 'req-1',
    );
    expect(terms).toEqual(['nail salon', 'lash studio', 'brow bar']);
    expect(categories).toEqual([]); // default mock returns no categories → []

    const call = deps.requestStructuredJson.mock.calls[0][0];
    expect(call).toMatchObject({
      provider: 'anthropic', apiKey: 'k', model: 'claude-sonnet-4-6',
      schemaName: 'discovery_term_suggestions', maxOutputTokens: 8000,
    });
    expect(call.user).toContain('Untrusted input');
    expect(JSON.parse(call.user.slice(call.user.indexOf('\n') + 1))).toEqual({
      mode: 'google_maps', area: 'Tampines', description: 'kids martial arts',
    });
    expect(call.schema.properties.terms.items.type).toBe('string');
  });

  test('maps mode returns normalized categories alongside terms', async () => {
    const { svc } = makeSvc({
      requestStructuredJson: jest.fn(async () => ({
        terms: ['nail salon', 'lash studio'],
        categories: ['Nail salon', 'nail salon', 'Beauty salon'],
      })),
    });
    const { terms, categories } = await svc.suggestTerms({ description: 'nails', provider: 'google_maps' }, user);
    expect(terms).toEqual(['nail salon', 'lash studio']);
    expect(categories).toEqual(['Nail salon', 'Beauty salon']); // case preserved, deduped
  });

  test('instagram mode never returns categories', async () => {
    const { svc } = makeSvc({
      requestStructuredJson: jest.fn(async () => ({ terms: ['sgnails', 'biabsg'], categories: ['Nail salon'] })),
    });
    const { categories } = await svc.suggestTerms({ description: 'home nails', provider: 'instagram_hashtag' }, user);
    expect(categories).toEqual([]);
  });

  test('area defaults to All Singapore; IG mode is passed through', async () => {
    const { svc, deps } = makeSvc({
      requestStructuredJson: jest.fn(async () => ({ terms: ['sgnails', 'biabsg'] })),
    });
    await svc.suggestTerms({ description: 'home nail artists', provider: 'instagram_hashtag' }, user);
    const call = deps.requestStructuredJson.mock.calls[0][0];
    expect(JSON.parse(call.user.slice(call.user.indexOf('\n') + 1)))
      .toMatchObject({ mode: 'instagram_hashtag', area: 'All Singapore' });
  });

  test('translates the admin-only 409 into staff-facing copy (status preserved)', async () => {
    const { svc } = makeSvc({
      getRuntimeAiSettings: jest.fn(async () => {
        throw new AppError('Claude is not configured. Add a credential in AI Settings.', 409);
      }),
    });
    await expect(svc.suggestTerms({ description: 'kids martial arts' }, user))
      .rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining('ask an admin') });
  });

  test('rewrites guided-review 502 wording; 429 passes through untouched', async () => {
    const draftErr = new AppError('Claude could not generate the draft. Try again shortly.', 502);
    const { svc } = makeSvc({ requestStructuredJson: jest.fn(async () => { throw draftErr; }) });
    await expect(svc.suggestTerms({ description: 'kids martial arts' }, user))
      .rejects.toMatchObject({ statusCode: 502, message: expect.not.stringContaining('draft') });

    const rateErr = new AppError('Claude rate limit or spending limit reached.', 429);
    const { svc: svc429 } = makeSvc({ requestStructuredJson: jest.fn(async () => { throw rateErr; }) });
    await expect(svc429.suggestTerms({ description: 'kids martial arts' }, user))
      .rejects.toMatchObject({ statusCode: 429, message: rateErr.message });
  });

  test('502 when fewer than 2 usable terms survive normalization', async () => {
    const { svc } = makeSvc({
      requestStructuredJson: jest.fn(async () => ({ terms: ['only-one', 'ONLY-ONE', 42] })),
    });
    await expect(svc.suggestTerms({ description: 'kids martial arts' }, user))
      .rejects.toMatchObject({ statusCode: 502 });
  });

  test('logs metadata but never the description text', async () => {
    const { svc, deps } = makeSvc();
    await svc.suggestTerms({ description: 'SECRET-PII-TEXT here', provider: 'google_maps' }, user, 'req-9');
    expect(deps.logger.info).toHaveBeenCalledTimes(1);
    // Pino-style: metadata object FIRST, message second (a trailing object
    // would be silently dropped by raw pino).
    const [meta, msg] = deps.logger.info.mock.calls[0];
    expect(msg).toBe('discovery.ai_terms.suggested');
    expect(meta).toMatchObject({ userId: 'user-1', requestId: 'req-9', mode: 'google_maps', count: 3 });
    expect(JSON.stringify(deps.logger.info.mock.calls[0])).not.toContain('SECRET-PII-TEXT');
  });
});
