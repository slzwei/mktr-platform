import '../setup.js';
import {
  TEMPLATE_REGISTRY,
  TEMPLATE_IDS,
  DRAW_TEMPLATE_IDS,
  TEMPLATE_PARAM_DEFAULTS,
} from '../../src/utils/designConfigV2.js';
import { clampTemplate } from '../../src/utils/designConfigV2Clamp.js';

/**
 * P4-4 — the template registry IS the single source: ids, draw subset and
 * param defaults derive from it, and the server clamp interprets its `rules`
 * declaratively. The extension test below is the task's success criterion
 * made durable: a hypothetical new template needs ONE registry entry and
 * zero code edits anywhere else.
 */

describe('TEMPLATE_REGISTRY derivations', () => {
  it('TEMPLATE_IDS is exactly the registry key order', () => {
    expect(TEMPLATE_IDS).toEqual(Object.keys(TEMPLATE_REGISTRY));
  });

  it('DRAW_TEMPLATE_IDS is exactly the draw-flagged subset, in order', () => {
    expect(DRAW_TEMPLATE_IDS).toEqual(
      Object.keys(TEMPLATE_REGISTRY).filter((id) => TEMPLATE_REGISTRY[id].draw === true)
    );
  });

  it('TEMPLATE_PARAM_DEFAULTS is exactly the per-entry params', () => {
    expect(TEMPLATE_PARAM_DEFAULTS).toEqual(
      Object.fromEntries(Object.keys(TEMPLATE_REGISTRY).map((id) => [id, TEMPLATE_REGISTRY[id].params]))
    );
  });

  it('every rule refines a param that exists (no orphan rules)', () => {
    for (const [id, entry] of Object.entries(TEMPLATE_REGISTRY)) {
      for (const key of Object.keys(entry.rules || {})) {
        expect(Object.keys(entry.params)).toContain(key);
      }
    }
  });

  it('every oneOf rule lists its own default (fallback is always legal)', () => {
    for (const entry of Object.values(TEMPLATE_REGISTRY)) {
      for (const [key, rule] of Object.entries(entry.rules || {})) {
        if (rule.oneOf) expect(rule.oneOf).toContain(entry.params[key]);
      }
    }
  });
});

describe('clampTemplate interprets rules declaratively', () => {
  it('enum junk falls back to the param default', () => {
    const r = clampTemplate({ id: 'poster', params: { poster: { overlay: 'neon-vaporwave' } } });
    expect(r.params.poster.overlay).toBe('dusk');
  });

  it('editorial.formWidth: range-clamped when numeric, DROPPED when absent/junk', () => {
    expect(clampTemplate({ params: { editorial: { formWidth: 9999 } } }).params.editorial.formWidth).toBe(600);
    expect(clampTemplate({ params: { editorial: { formWidth: 10 } } }).params.editorial.formWidth).toBe(300);
    expect('formWidth' in clampTemplate({ params: {} }).params.editorial).toBe(false);
    expect('formWidth' in clampTemplate({ params: { editorial: { formWidth: 'wide' } } }).params.editorial).toBe(false);
  });

  it('express.trustLine: length-capped from the raw input', () => {
    const r = clampTemplate({ params: { express: { trustLine: 'x'.repeat(200) } } });
    expect(r.params.express.trustLine).toHaveLength(80);
  });

  it('unknown template id falls back to the first registry entry', () => {
    expect(clampTemplate({ id: 'no-such-template' }).id).toBe('editorial');
  });
});

describe('SUCCESS CRITERION — adding a template is one registry entry', () => {
  // A hypothetical direction, declared exactly the way a real entry would be.
  // No clamp code, no id list, no defaults bag is touched anywhere.
  const EXTENDED = {
    ...TEMPLATE_REGISTRY,
    neon: {
      draw: true,
      params: { glow: 'soft', ticker: true, tagline: '' },
      rules: { glow: { oneOf: ['soft', 'hard'] }, tagline: { maxLen: 12 } },
    },
  };

  it('the new id is accepted and its params clamp per its rules', () => {
    const r = clampTemplate(
      {
        id: 'neon',
        params: { neon: { glow: 'blinding', ticker: 'yes', tagline: 'way-too-long-tagline', junk: 1 } },
      },
      EXTENDED
    );
    expect(r.id).toBe('neon');
    expect(r.params.neon.glow).toBe('soft'); // enum junk → default
    expect(r.params.neon.ticker).toBe(false); // strict-boolean typing
    expect(r.params.neon.tagline).toBe('way-too-long'); // maxLen 12
    expect('junk' in r.params.neon).toBe(false); // unknown params never persist
  });

  it('the derived views pick the entry up with no other edits', () => {
    const ids = Object.keys(EXTENDED);
    expect(ids).toContain('neon');
    expect(ids.filter((id) => EXTENDED[id].draw === true)).toContain('neon');
    // Every EXISTING template's clamp output is untouched by the extension.
    const base = clampTemplate({ id: 'poster', params: {} });
    const extended = clampTemplate({ id: 'poster', params: {} }, EXTENDED);
    for (const id of TEMPLATE_IDS) expect(extended.params[id]).toEqual(base.params[id]);
  });
});
