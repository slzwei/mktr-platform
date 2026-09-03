/**
 * rsvp_layout v1 clamp (docs/plans/rsvp-pages.md §4) — pure util, no database.
 * The §4 invariants, the frozen-field rule, and the public rebuild.
 */
import {
  clampLayout, defaultLayout, publicLayout, layoutProblems,
  isValidRsvpSlug, slugProblem,
  LIMITS, LOCKED_FIELD_KEYS, BLOCK_TYPES, FIELD_TYPES, RESERVED_ROOT_SLUGS,
} from '../../src/utils/rsvpLayout.js';

const formBlocks = (doc) => doc.blocks.filter((b) => b.type === 'form');
const field = (doc, key) => doc.fields.find((f) => f.key === key);

describe('defaultLayout', () => {
  test('is a valid, idempotent v1 document with one form and the locked fields', () => {
    const doc = defaultLayout();
    expect(doc.version).toBe(1);
    expect(formBlocks(doc)).toHaveLength(1);
    expect(doc.theme.preset).toBe('warm-cream');
    expect(field(doc, 'name')).toMatchObject({ type: 'text', required: true, locked: true });
    expect(field(doc, 'email')).toMatchObject({ type: 'email', required: true, locked: true });
    expect(field(doc, 'phone')).toMatchObject({ type: 'phone', required: false });
    expect(field(doc, 'phone').locked).toBeUndefined();
    expect(clampLayout(doc)).toEqual(doc);
    expect(layoutProblems(doc)).toEqual([]);
  });
});

describe('clampLayout — garbage in, valid doc out', () => {
  test.each([null, undefined, 'nope', 42, [], { version: 9 }])('input %p', (raw) => {
    const doc = clampLayout(raw);
    expect(doc.version).toBe(1);
    expect(formBlocks(doc)).toHaveLength(1);
    expect(doc.fields.map((f) => f.key)).toEqual(LOCKED_FIELD_KEYS);
    expect(doc.confirmation).toEqual({ headline: "You're in", body: '', emailEnabled: true });
  });

  test('drops unknown keys at every level', () => {
    const doc = clampLayout({
      internal: 'secret',
      theme: { preset: 'kopi', secret: 1 },
      blocks: [{ id: 'b_hero', type: 'hero', headline: 'Hi', secret: 1 }],
      fields: [{ key: 'name', type: 'text', label: 'Name', secret: 1 }],
      confirmation: { headline: 'Done', secret: 1 },
    });
    expect(doc.internal).toBeUndefined();
    expect(doc.theme).toEqual({ preset: 'kopi', accent: '', font: '', radius: '' });
    expect(doc.blocks[0]).toEqual({ id: 'b_hero', type: 'hero', headline: 'Hi', subheadline: '', mediaUrl: '', mediaAlt: '' });
    expect(Object.keys(field(doc, 'name')).sort()).toEqual(['help', 'key', 'label', 'locked', 'required', 'type']);
    expect(doc.confirmation.secret).toBeUndefined();
  });

  test('theme: unknown preset/font/radius fall back; accent must be #rrggbb', () => {
    expect(clampLayout({ theme: { preset: 'neon', accent: 'red', font: 'comic', radius: 'huge' } }).theme)
      .toEqual({ preset: 'warm-cream', accent: '', font: '', radius: '' });
    expect(clampLayout({ theme: { preset: 'graphite', accent: '#AbCdEf', font: 'inter', radius: 'round' } }).theme)
      .toEqual({ preset: 'graphite', accent: '#AbCdEf', font: 'inter', radius: 'round' });
  });
});

describe('clampLayout — blocks', () => {
  test('unknown types dropped, second form dropped, missing form appended', () => {
    const doc = clampLayout({ blocks: [{ type: 'carousel' }, { id: 'b_ab01', type: 'form' }, { id: 'b_ab02', type: 'form', headline: 'dup' }] });
    expect(doc.blocks).toEqual([{ id: 'b_ab01', type: 'form', headline: '', submitLabel: 'RSVP' }]);
    const noForm = clampLayout({ blocks: [{ type: 'text', body: 'x' }] });
    expect(noForm.blocks.map((b) => b.type)).toEqual(['text', 'form']);
  });

  test('the form survives the block cap wherever it sits', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ id: `b_t${i}`, type: 'text', body: String(i) }));
    const doc = clampLayout({ blocks: [...many, { id: 'b_form', type: 'form', headline: 'Keep me' }] });
    expect(doc.blocks).toHaveLength(LIMITS.blocks);
    expect(formBlocks(doc)).toEqual([{ id: 'b_form', type: 'form', headline: 'Keep me', submitLabel: 'RSVP' }]);
    expect(doc.blocks.filter((b) => b.type === 'text')).toHaveLength(LIMITS.blocks - 1);
  });

  test('ids are validated, deduplicated and minted deterministically', () => {
    const doc = clampLayout({ blocks: [{ id: 'BAD ID', type: 'text' }, { id: 'b_same', type: 'text' }, { id: 'b_same', type: 'image' }, { type: 'form' }] });
    expect(doc.blocks.map((b) => b.id)).toEqual(['b_0001', 'b_same', 'b_0002', 'b_0003']);
    expect(clampLayout(doc)).toEqual(doc);
  });

  test('block copy is capped and urls are https or /uploads only', () => {
    const doc = clampLayout({
      blocks: [
        { id: 'b_h', type: 'hero', headline: 'x'.repeat(500), mediaUrl: 'http://insecure.example/a.png' },
        { id: 'b_i', type: 'image', url: 'javascript:alert(1)', alt: 'a' },
        { id: 'b_j', type: 'image', url: '/uploads/campaigns/abc/pic.jpg' },
        { id: 'b_k', type: 'image', url: 'https://cdn.example.com/x.png?v=1' },
        { id: 'b_d', type: 'details', rows: [{ label: '', value: '' }, { label: 'When', value: 'Sat' }, 'junk', ...Array.from({ length: 20 }, (_, i) => ({ label: `L${i}`, value: 'v' }))] },
        { id: 'b_f', type: 'form', submitLabel: '' },
      ],
    });
    expect(doc.blocks[0].headline).toHaveLength(LIMITS.headline);
    expect(doc.blocks[0].mediaUrl).toBe('');
    expect(doc.blocks[1].url).toBe('');
    expect(doc.blocks[2].url).toBe('/uploads/campaigns/abc/pic.jpg');
    expect(doc.blocks[3].url).toBe('https://cdn.example.com/x.png?v=1');
    expect(doc.blocks[4].rows).toHaveLength(LIMITS.detailsRows);
    expect(doc.blocks[4].rows[0]).toEqual({ label: 'When', value: 'Sat' });
    expect(doc.blocks[5].submitLabel).toBe('RSVP');
  });

  test('vocabulary is exactly the plan', () => {
    expect(BLOCK_TYPES).toEqual(['hero', 'text', 'details', 'image', 'form']);
    expect(FIELD_TYPES).toEqual(['text', 'textarea', 'email', 'phone', 'number', 'date', 'select', 'multiselect', 'checkbox']);
  });
});

describe('clampLayout — fields', () => {
  test('locked fields are forced (type, required, locked) and inserted at the front when missing', () => {
    const doc = clampLayout({ fields: [{ key: 'f_abcd', type: 'text', label: 'Q' }, { key: 'name', type: 'select', required: false, options: ['x'] }] });
    // A present locked field keeps the admin's position; a missing one goes to the front.
    expect(doc.fields.map((f) => f.key)).toEqual(['email', 'f_abcd', 'name']);
    expect(field(doc, 'name')).toEqual({ key: 'name', type: 'text', label: 'Full name', help: '', required: true, locked: true });
    expect(field(doc, 'email')).toMatchObject({ type: 'email', required: true, locked: true });
  });

  test('invalid custom keys and duplicates are dropped; phone is forced to type phone', () => {
    const doc = clampLayout({
      fields: [
        { key: 'name' }, { key: 'email' },
        { key: 'foo', type: 'text' }, { key: 'f_x', type: 'text' }, { key: 'F_ABCD', type: 'text' }, { key: 'f_toolongkey123', type: 'text' },
        { key: 'f_ok01', type: 'text', label: 'First' }, { key: 'f_ok01', type: 'text', label: 'Dup' },
        { key: 'phone', type: 'number' },
        { key: 'f_weird', type: 'hologram' },
      ],
    });
    expect(doc.fields.map((f) => f.key)).toEqual(['name', 'email', 'f_ok01', 'phone', 'f_weird']);
    expect(field(doc, 'f_ok01').label).toBe('First');
    expect(field(doc, 'phone').type).toBe('phone');
    expect(field(doc, 'f_weird').type).toBe('text');
  });

  test('options: only for select/multiselect, deduped, capped, non-strings dropped', () => {
    const doc = clampLayout({
      fields: [
        { key: 'f_sel1', type: 'select', options: ['A', 'A', ' B ', 7, null, '', ...Array.from({ length: 20 }, (_, i) => `O${i}`)] },
        { key: 'f_txt1', type: 'text', options: ['should', 'vanish'] },
      ],
    });
    const sel = field(doc, 'f_sel1');
    expect(sel.options).toHaveLength(LIMITS.options);
    expect(sel.options.slice(0, 2)).toEqual(['A', 'B']);
    expect(field(doc, 'f_txt1').options).toBeUndefined();
  });

  test('field count is capped', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ key: `f_k${String(i).padStart(4, '0')}`, type: 'text' }));
    const doc = clampLayout({ fields: [{ key: 'name' }, { key: 'email' }, ...many] });
    expect(doc.fields).toHaveLength(LIMITS.fields);
    expect(doc.fields.slice(0, 2).map((f) => f.key)).toEqual(['name', 'email']);
  });

  test('control and bidi characters are stripped from owner copy', () => {
    const doc = clampLayout({ fields: [{ key: 'f_ctrl', type: 'text', label: 'Name\u202E!', help: '\u200Ftip' }] });
    expect(field(doc, 'f_ctrl')).toMatchObject({ label: 'Name!', help: 'tip' });
  });
});

describe('clampLayout — frozen fields (event has responses)', () => {
  const stored = clampLayout({
    fields: [
      { key: 'name' }, { key: 'email' },
      { key: 'f_diet', type: 'select', label: 'Diet', options: ['Veg', 'Halal'] },
      { key: 'f_note', type: 'textarea', label: 'Note', required: false },
    ],
  });
  const frozen = stored.fields;

  test('type and options are immutable; label/help/required/order stay editable', () => {
    const doc = clampLayout({
      fields: [
        { key: 'name' }, { key: 'email' },
        { key: 'f_note', type: 'text', label: 'Anything else?', help: 'Optional', required: true },
        { key: 'f_diet', type: 'checkbox', label: 'Dietary needs', options: ['Fish'] },
      ],
    }, { frozen });
    expect(doc.fields.map((f) => f.key)).toEqual(['name', 'email', 'f_note', 'f_diet']);
    expect(field(doc, 'f_note')).toEqual({ key: 'f_note', type: 'textarea', label: 'Anything else?', help: 'Optional', required: true });
    expect(field(doc, 'f_diet')).toEqual({ key: 'f_diet', type: 'select', label: 'Dietary needs', help: '', required: false, options: ['Veg', 'Halal'] });
  });

  test('a deleted frozen field comes back; new fields can still be added', () => {
    const doc = clampLayout({ fields: [{ key: 'name' }, { key: 'email' }, { key: 'f_new1', type: 'date', label: 'Arrival' }] }, { frozen });
    expect(doc.fields.map((f) => f.key)).toEqual(['name', 'email', 'f_new1', 'f_diet', 'f_note']);
    expect(field(doc, 'f_diet')).toEqual(field(stored, 'f_diet'));
  });

  test('at the cap, the newest non-frozen field is evicted to make room for a frozen one', () => {
    const fill = Array.from({ length: LIMITS.fields - 2 }, (_, i) => ({ key: `f_n${String(i).padStart(4, '0')}`, type: 'text' }));
    const doc = clampLayout({ fields: [{ key: 'name' }, { key: 'email' }, ...fill] }, { frozen });
    expect(doc.fields).toHaveLength(LIMITS.fields);
    expect(field(doc, 'f_diet')).toBeDefined();
    expect(field(doc, 'f_note')).toBeDefined();
    expect(field(doc, fill[fill.length - 1].key)).toBeUndefined();
    expect(field(doc, fill[0].key)).toBeDefined();
  });

  test('without the frozen option the same edits are honoured (draft events)', () => {
    const doc = clampLayout({ fields: [{ key: 'name' }, { key: 'email' }, { key: 'f_diet', type: 'checkbox' }] });
    expect(field(doc, 'f_diet').type).toBe('checkbox');
    expect(field(doc, 'f_note')).toBeUndefined();
  });
});

describe('publicLayout', () => {
  test('rebuilds from known keys and never leaks an injected internal key', () => {
    const stored = { ...defaultLayout(), internal: { activationId: 'x' } };
    stored.blocks[0].secret = 'y';
    const pub = publicLayout(stored);
    expect(pub.internal).toBeUndefined();
    expect(pub.blocks[0].secret).toBeUndefined();
    expect(pub).toEqual(clampLayout(stored));
    expect(stored.internal).toBeDefined(); // input untouched
  });
});

describe('layoutProblems', () => {
  test('codes for the publish guard', () => {
    expect(layoutProblems(defaultLayout())).toEqual([]);
    const few = clampLayout({ blocks: [{ type: 'text', body: 'x' }], fields: [{ key: 'f_sel1', type: 'select', options: ['only'] }, { key: 'f_mul1', type: 'multiselect', options: [] }] });
    expect(layoutProblems(few)).toEqual(['options_too_few:f_sel1', 'options_too_few:f_mul1']);
    expect(layoutProblems(clampLayout({ blocks: [] }))).toEqual(['no_content']);
    expect(layoutProblems({ version: 1, blocks: [{ type: 'text' }], fields: [{ key: 'f_a', type: 'text' }, { key: 'f_a', type: 'text' }] }))
      .toEqual(['form_block_missing', 'duplicate_key:f_a', 'locked_field_missing:name', 'locked_field_missing:email']);
  });
});

describe('slug rules', () => {
  test('shape, reserved roots, and the twin helper agree', () => {
    expect(isValidRsvpSlug('launch-2026')).toBe(true);
    expect(slugProblem('launch-2026')).toBeNull();
    for (const bad of ['ab', 'Launch', 'a'.repeat(41), 'has.dot', 'has space', '', null, 42]) {
      expect(isValidRsvpSlug(bad)).toBe(false);
      expect(slugProblem(bad)).toBe('invalid');
    }
    for (const reserved of ['api', 'assets', 'uploads', 'admin', 'rsvp']) {
      expect(RESERVED_ROOT_SLUGS).toContain(reserved);
      expect(isValidRsvpSlug(reserved)).toBe(false);
      expect(slugProblem(reserved)).toBe('reserved');
    }
  });
});
