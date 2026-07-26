/**
 * adminV2 data-layer envelope contracts — the fetchers normalize each
 * endpoint's REAL envelope so table components never learn per-endpoint
 * shapes. fetchConsumers is the People directory's door (R2 #5: these
 * assertions need a home that actually executes).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/api/client', () => ({ apiClient: { get: vi.fn() } }));

import { apiClient } from '@/api/client';
import { fetchConsumers } from '../adminV2.js';

beforeEach(() => vi.clearAllMocks());

describe('fetchConsumers', () => {
  it('builds the querystring from non-empty params only and normalizes the envelope', async () => {
    apiClient.get.mockResolvedValue({
      data: { total: 5, page: 2, limit: 25, rows: [{ id: 'c1', latestProspectId: 'p1' }] },
    });
    const out = await fetchConsumers({ q: 'shawn lee', page: 2, limit: 25, sort: '-name', empty: '' });
    expect(apiClient.get).toHaveBeenCalledTimes(1);
    const url = apiClient.get.mock.calls[0][0];
    expect(url.startsWith('/consumers?')).toBe(true);
    const qs = new URLSearchParams(url.split('?')[1]);
    expect(qs.get('q')).toBe('shawn lee');
    expect(qs.get('page')).toBe('2');
    expect(qs.get('sort')).toBe('-name');
    expect(qs.has('empty')).toBe(false);
    expect(out).toEqual({ total: 5, page: 2, limit: 25, rows: [{ id: 'c1', latestProspectId: 'p1' }] });
  });

  it('degrades to safe defaults on a malformed envelope', async () => {
    apiClient.get.mockResolvedValue({});
    const out = await fetchConsumers();
    expect(out).toEqual({ rows: [], total: 0, page: 1, limit: 25 });
  });
});
