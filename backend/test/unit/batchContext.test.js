/**
 * parseBatchContext / withBatchContext — the bulk-op batch plumbing
 * (prospectHelpers). The batch context is a delivery-UX hint the mktr-leads
 * admin app threads through per-lead calls so the receiver can coalesce N
 * pushes into one summary; these pin the validation envelope and the payload
 * echo (data.batch) without disturbing the rest of the payload.
 */
import '../setup.js';
import { parseBatchContext, withBatchContext } from '../../src/services/prospectHelpers.js';

describe('parseBatchContext', () => {
  const valid = { id: 'b'.repeat(12), size: 30 };

  it('accepts a well-formed { id, size }', () => {
    expect(parseBatchContext(valid)).toEqual(valid);
  });

  it('rejects malformed shapes with null (never throws)', () => {
    expect(parseBatchContext(undefined)).toBeNull();
    expect(parseBatchContext(null)).toBeNull();
    expect(parseBatchContext('batch')).toBeNull();
    expect(parseBatchContext({})).toBeNull();
    expect(parseBatchContext({ id: 'short', size: 3 })).toBeNull(); // id < 8 chars
    expect(parseBatchContext({ id: 'x'.repeat(65), size: 3 })).toBeNull(); // id > 64 chars
    expect(parseBatchContext({ id: valid.id, size: 0 })).toBeNull();
    expect(parseBatchContext({ id: valid.id, size: 501 })).toBeNull();
    expect(parseBatchContext({ id: valid.id, size: 2.5 })).toBeNull();
    expect(parseBatchContext({ id: valid.id, size: '3' })).toBeNull();
  });
});

describe('withBatchContext', () => {
  const payload = { event: 'lead.assigned', timestamp: 't', data: { lead: { externalId: 'p1' } } };

  it('echoes the batch into data.batch without touching anything else', () => {
    const batch = { id: 'b'.repeat(12), size: 4 };
    const out = withBatchContext(payload, batch);
    expect(out.data.batch).toEqual(batch);
    expect(out.data.lead).toEqual(payload.data.lead);
    expect(out.event).toBe('lead.assigned');
    // Original payload is not mutated.
    expect(payload.data.batch).toBeUndefined();
  });

  it('is a no-op passthrough when batch is null', () => {
    expect(withBatchContext(payload, null)).toBe(payload);
  });
});
