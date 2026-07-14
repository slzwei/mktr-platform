/**
 * Cadences — AI draft service (no DB, no HTTP: the factory takes its deps as
 * overrides). Covers: flag gating (503), staff-facing error translation
 * (409/502, 429 pass-through), normalizeCadenceDraft clamping to the engine's
 * real vocab (channel/priority/window fallbacks, delayDays semantics incl.
 * non-finite values, per-channel continueOn incl. terminals, last-step '*'
 * canonicalization after truncation, stepCount enforcement both directions),
 * merge-token sanitization mirroring renderTemplate's blocker regex, and the
 * PDPA rule that the brief text is never logged.
 */
import { jest } from '@jest/globals';
import {
  makeCadenceAiService, normalizeCadenceDraft, sanitizeScript, cadenceAiEnabled,
} from '../src/services/redeemOps/cadenceAiService.js';
import { AppError } from '../src/middleware/errorHandler.js';

const settings = { provider: 'openai', apiKey: 'k', model: 'gpt-5.6-terra' };
const user = { id: 'user-1' };

const step = (over = {}) => ({
  channel: 'call', title: 'Intro call', script: 'Hi {{contact_name}}',
  priority: 'medium', delayDays: 0, timeWindow: 'any', continueOn: 'no_answer', ...over,
});
const draft = (steps, over = {}) => ({ name: 'Café chase', description: 'gentle', steps, ...over });

function makeSvc(over = {}) {
  const deps = {
    isEnabled: () => true,
    getRuntimeAiSettings: jest.fn(async () => settings),
    requestStructuredJson: jest.fn(async () => draft([step(), step({ channel: 'whatsapp', continueOn: 'sent', delayDays: 2 })])),
    logger: { info: jest.fn(), error: jest.fn() },
    ...over,
  };
  return { svc: makeCadenceAiService(deps), deps };
}

describe('sanitizeScript — merge tokens mirror renderTemplate', () => {
  test('canonicalizes allowlisted fields (case/padding) and keeps them', () => {
    expect(sanitizeScript('Hi {{ Contact_Name }}, about {{PARTNER_NAME}} ({{category}})'))
      .toBe('Hi {{contact_name}}, about {{partner_name}} ({{category}})');
    expect(sanitizeScript('This is {{ Rep_Name }} from Redeem'))
      .toBe('This is {{rep_name}} from Redeem');
  });

  test('bracketed self-introduction fill-ins become {{rep_name}}', () => {
    expect(sanitizeScript("Hi, this is [Your Name] from Redeem")).toBe('Hi, this is {{rep_name}} from Redeem');
    expect(sanitizeScript('— [ my name ], Redeem')).toBe('— {{rep_name}}, Redeem');
    expect(sanitizeScript("[Rep's Name] here, [Agent name] and [SENDER NAME] too"))
      .toBe('{{rep_name}} here, {{rep_name}} and {{rep_name}} too');
    // unrelated brackets are content, not fill-ins
    expect(sanitizeScript('offer [20% off] ends [soon]')).toBe('offer [20% off] ends [soon]');
  });

  test('strips every blocker-shaped token the live regex would trip on', () => {
    const out = sanitizeScript('Hey {{lead-name}}, {{first name}} from {{foo1}} says {{unknown_field}} hi');
    expect(out).toBe('Hey lead-name, first name from foo1 says unknown_field hi');
    expect(/{{[^}]+}}/.test(out)).toBe(false); // renderTemplate's blocker test
  });

  test('non-string input becomes empty string', () => {
    expect(sanitizeScript(null)).toBe('');
    expect(sanitizeScript(42)).toBe('');
  });
});

describe('normalizeCadenceDraft — clamp to the engine vocab', () => {
  test('invalid channel/priority/window fall back; unknown continueOn becomes *', () => {
    const out = normalizeCadenceDraft(draft([
      step({ channel: 'fax', priority: 'urgent', timeWindow: 'midnight', continueOn: 'sent' }),
      step(),
    ]));
    expect(out.steps[0]).toMatchObject({
      channel: 'custom', priority: 'medium', timeWindow: 'any', continueOn: '*',
    });
  });

  test('terminal dispositions are never valid continueOn values', () => {
    const out = normalizeCadenceDraft(draft([
      step({ continueOn: 'replied' }),
      step({ channel: 'whatsapp', continueOn: 'not_interested' }),
      step(),
    ]));
    expect(out.steps[0].continueOn).toBe('*');
    expect(out.steps[1].continueOn).toBe('*');
  });

  test('delayDays: rounds and clamps finite values; non-finite falls back 0/2 by position', () => {
    const out = normalizeCadenceDraft(draft([
      step({ delayDays: 'nonsense' }),
      step({ delayDays: null }),
      step({ delayDays: 2.6 }),
      step({ delayDays: 999 }),
      step({ delayDays: -5 }),
    ]));
    expect(out.steps.map((s) => s.delayDays)).toEqual([0, 2, 3, 60, 0]);
  });

  test('last step continueOn is canonicalized to * — including after truncation', () => {
    const out = normalizeCadenceDraft(
      draft([step(), step(), step({ channel: 'visit', continueOn: 'met' })]),
      { stepCount: 2 },
    );
    expect(out.steps).toHaveLength(2);
    expect(out.steps[1].continueOn).toBe('*');
  });

  test('stepCount: fewer steps than requested is a 502; extra steps are truncated', () => {
    expect(() => normalizeCadenceDraft(draft([step(), step()]), { stepCount: 5 }))
      .toThrow(/returned 2 steps instead of 5/);
    const out = normalizeCadenceDraft(draft([step(), step(), step(), step()]), { stepCount: 3 });
    expect(out.steps).toHaveLength(3);
  });

  test('missing/empty steps → 502; title and name fallbacks + slicing apply', () => {
    expect(() => normalizeCadenceDraft(draft([]))).toThrow(AppError);
    expect(() => normalizeCadenceDraft({})).toThrow(AppError);
    const out = normalizeCadenceDraft({
      name: `  ${'n'.repeat(150)}`,
      description: 42,
      steps: [step({ title: '   ' })],
    });
    expect(out.name).toHaveLength(120);
    expect(out.description).toBe('');
    expect(out.steps[0].title).toBe('Call 1');
  });
});

describe('cadenceAiEnabled', () => {
  const before = process.env.REDEEM_OPS_CADENCES_AI_ENABLED;
  afterEach(() => {
    if (before === undefined) delete process.env.REDEEM_OPS_CADENCES_AI_ENABLED;
    else process.env.REDEEM_OPS_CADENCES_AI_ENABLED = before;
  });
  test('reads the env at call time', () => {
    delete process.env.REDEEM_OPS_CADENCES_AI_ENABLED;
    expect(cadenceAiEnabled()).toBe(false);
    process.env.REDEEM_OPS_CADENCES_AI_ENABLED = 'true';
    expect(cadenceAiEnabled()).toBe(true);
  });
});

describe('suggestCadence', () => {
  test('503 when the flag is off — before any provider work', async () => {
    const { svc, deps } = makeSvc({ isEnabled: () => false });
    await expect(svc.suggestCadence({ prompt: 'cafés chase' }, user))
      .rejects.toMatchObject({ statusCode: 503 });
    expect(deps.getRuntimeAiSettings).not.toHaveBeenCalled();
  });

  test('translates 409 (no key) and 502 (provider) into staff-facing copy; 429 passes', async () => {
    const { svc } = makeSvc({
      getRuntimeAiSettings: jest.fn(async () => {
        throw new AppError('OpenAI is not configured. Add a credential in AI Settings.', 409);
      }),
    });
    await expect(svc.suggestCadence({ prompt: 'cafés chase' }, user))
      .rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining('ask an admin') });

    const { svc: svc502 } = makeSvc({
      requestStructuredJson: jest.fn(async () => {
        throw new AppError('OpenAI could not generate the draft. Try again shortly.', 502);
      }),
    });
    await expect(svc502.suggestCadence({ prompt: 'cafés chase' }, user))
      .rejects.toMatchObject({ statusCode: 502, message: expect.not.stringContaining('AI Settings') });

    const rateErr = new AppError('OpenAI rate limit or spending limit reached.', 429);
    const { svc: svc429 } = makeSvc({ requestStructuredJson: jest.fn(async () => { throw rateErr; }) });
    await expect(svc429.suggestCadence({ prompt: 'cafés chase' }, user))
      .rejects.toMatchObject({ statusCode: 429, message: rateErr.message });
  });

  test('passes the untrusted-data payload + schema and returns the normalized draft', async () => {
    const { svc, deps } = makeSvc();
    const out = await svc.suggestCadence({ prompt: 'cafés chase', stepCount: 2 }, user, 'req-1');
    expect(out.steps).toHaveLength(2);

    const call = deps.requestStructuredJson.mock.calls[0][0];
    expect(call).toMatchObject({
      provider: 'openai', apiKey: 'k', model: 'gpt-5.6-terra',
      schemaName: 'cadence_draft', maxOutputTokens: 4000,
    });
    expect(call.user).toContain('Untrusted input');
    expect(JSON.parse(call.user.slice(call.user.indexOf('\n') + 1)))
      .toEqual({ brief: 'cafés chase', requestedSteps: 2 });
    expect(call.schema.properties.steps.items.properties.channel.enum).toContain('instagram_dm');
  });

  test('logs pino-style (meta first) without the brief text', async () => {
    const { svc, deps } = makeSvc();
    await svc.suggestCadence({ prompt: 'SECRET-BRIEF-TEXT here' }, user, 'req-9');
    expect(deps.logger.info).toHaveBeenCalledTimes(1);
    const [meta, msg] = deps.logger.info.mock.calls[0];
    expect(msg).toBe('cadence.ai_draft.suggested');
    expect(meta).toMatchObject({ userId: 'user-1', requestId: 'req-9', steps: 2, requestedSteps: null });
    expect(JSON.stringify(deps.logger.info.mock.calls[0])).not.toContain('SECRET-BRIEF-TEXT');
  });
});
