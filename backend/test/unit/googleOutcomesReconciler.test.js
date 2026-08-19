/**
 * Lyfe outcome reconciler gating (ads-centralisation §3.5): CREDENTIALS-based,
 * NOT Google-flag-based — its first-wins facts feed the Google worker AND the
 * Meta delivery ledger's invariant sweep, so Meta outcome durability must
 * never hang off GOOGLE_ADS_UPLOADS_ENABLED. Runs the reconciler through its
 * DI seam with the Google flag explicitly OFF and observes the fact write.
 */
import { jest } from '@jest/globals';
import '../setup.js';
import { reconcilerConfigured, reconcileLyfeOutcomes } from '../../src/services/googleOutcomesReconciler.js';

const CREDS = {
  LYFE_SUPABASE_URL: 'https://example.supabase.co',
  LYFE_SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
};

afterEach(() => {
  delete process.env.LYFE_SUPABASE_URL;
  delete process.env.LYFE_SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.GOOGLE_ADS_UPLOADS_ENABLED;
});

describe('reconcilerConfigured', () => {
  it('is TRUE with credentials even when the Google flag is off/unset', () => {
    process.env.GOOGLE_ADS_UPLOADS_ENABLED = 'false';
    Object.assign(process.env, CREDS);
    expect(reconcilerConfigured()).toBe(true);
  });

  it('is FALSE without either credential', () => {
    process.env.LYFE_SUPABASE_URL = CREDS.LYFE_SUPABASE_URL;
    expect(reconcilerConfigured()).toBe(false);
    delete process.env.LYFE_SUPABASE_URL;
    process.env.LYFE_SUPABASE_SERVICE_ROLE_KEY = CREDS.LYFE_SUPABASE_SERVICE_ROLE_KEY;
    expect(reconcilerConfigured()).toBe(false);
  });
});

describe('reconcileLyfeOutcomes with the Google flag OFF', () => {
  it('runs end-to-end and writes the outcome fact (first-wins merge observed)', async () => {
    process.env.GOOGLE_ADS_UPLOADS_ENABLED = 'false';
    Object.assign(process.env, CREDS);

    const lead = { id: 'l-1', external_id: 'p-1', status: 'qualified', updated_at: '2026-08-10T00:00:00Z' };
    const fetch = jest.fn(async (url) => ({
      ok: true,
      json: async () => (String(url).includes('/leads') ? [lead] : []),
    }));
    const Prospect = { findAll: jest.fn().mockResolvedValue([{ id: 'p-1', sourceMetadata: {} }]) };
    const mergeFirstWins = jest.fn().mockResolvedValue(1);

    const summary = await reconcileLyfeOutcomes({ fetch, Prospect, mergeFirstWins });

    expect(summary.ran).toBe(true);
    expect(mergeFirstWins).toHaveBeenCalledTimes(1);
    const [prospectId, path, patch] = mergeFirstWins.mock.calls[0];
    expect(prospectId).toBe('p-1');
    expect(path).toEqual(['outcomes']);
    expect(Object.keys(patch)).toEqual(['confirmed_resident']);
    expect(summary.factsWritten).toBe(1);
  });

  it('still guards on missing credentials', async () => {
    const summary = await reconcileLyfeOutcomes({ fetch: jest.fn() });
    expect(summary).toEqual({ ran: false, reason: 'guarded' });
  });
});
