import { getApp, closeDb, createTestUser } from '../helpers.js';
import { User } from '../../src/models/index.js';
import { adapterRegistry } from '../../src/integrations/AdapterRegistry.js';
import { syncAgentsFromMktrLeads } from '../../src/services/agentSyncService.js';

/**
 * Integration: mirror mktr-leads agents into local `users` (the second agent
 * source). Requires Postgres (advisory lock + CHECK constraint + raw-SQL
 * deactivation) — runs in CI alongside the other integration suites.
 *
 * One snapshot exercises every branch of the one-source-per-user sync:
 *   - brand-new mktr-leads agent          → created with mktrLeadsId
 *   - phone collision with a Lyfe agent    → SKIPPED, never merged (the flagged
 *                                            safety: no dual-source row)
 *   - already-mirrored agent (id match)    → kept active, not duplicated
 *   - mirrored agent gone from upstream    → deactivated (only its own source)
 *   - the Lyfe agent                       → untouched by the mktr-leads sync
 */

const RUN = String(Date.now()).slice(-6);
const ID = {
  keep: `M_keep_${RUN}`,
  stale: `M_stale_${RUN}`,
  fresh: `M_new_${RUN}`,
  conflict: `M_conflict_${RUN}`,
  lyfe: `L_${RUN}`,
};
const PHONE = {
  lyfe: `6591${RUN}`, // the conflict agent reuses this
  keep: `6593${RUN}`,
  stale: `6592${RUN}`,
  fresh: `6594${RUN}`,
};

let lyfeAgent, staleAgent, keepAgent;

// Fake adapter: returns exactly the upstream snapshot we want, no network.
const fakeAdapter = {
  id: 'mktr_leads',
  localIdField: 'mktrLeadsId',
  invalidateCache() {},
  async getAgent() {
    return null;
  },
  async listAgents() {
    return [
      { externalId: ID.keep, fullName: 'Keep Agent', email: `keep-${RUN}@ml.test`, phone: PHONE.keep, externalRole: 'agent', isActive: true },
      { externalId: ID.fresh, fullName: 'Fresh Agent', email: `fresh-${RUN}@ml.test`, phone: PHONE.fresh, externalRole: 'agent', isActive: true },
      // Same phone as the Lyfe agent below → must be SKIPPED, not merged.
      { externalId: ID.conflict, fullName: 'Conflict Agent', email: `conflict-${RUN}@ml.test`, phone: PHONE.lyfe, externalRole: 'agent', isActive: true },
    ];
  },
};

let result;

beforeAll(async () => {
  process.env.WEBHOOK_ENABLED = 'false';
  await getApp();

  // A Lyfe-owned agent — the conflict agent shares its phone.
  ({ user: lyfeAgent } = await createTestUser({ role: 'agent', lyfeId: ID.lyfe, phone: PHONE.lyfe, firstName: 'Lyfe', lastName: 'Owned' }));
  // An mktr-leads agent that upstream no longer returns → should deactivate.
  ({ user: staleAgent } = await createTestUser({ role: 'agent', mktrLeadsId: ID.stale, phone: PHONE.stale, firstName: 'Stale', lastName: 'Mktr' }));
  // An mktr-leads agent the snapshot still returns (externalId match).
  ({ user: keepAgent } = await createTestUser({ role: 'agent', mktrLeadsId: ID.keep, phone: PHONE.keep, firstName: 'Keep', lastName: 'Mktr' }));

  adapterRegistry.replace(fakeAdapter);
  result = await syncAgentsFromMktrLeads();
}, 30000);

afterAll(async () => {
  await closeDb();
});

describe('syncAgentsFromMktrLeads', () => {
  it('creates a brand-new mktr-leads agent with mktrLeadsId set (and no lyfeId)', async () => {
    const row = await User.findOne({ where: { mktrLeadsId: ID.fresh } });
    expect(row).not.toBeNull();
    expect(row.role).toBe('agent');
    expect(row.lyfeId).toBeNull();
    expect(row.isActive).toBe(true);
  });

  it('SKIPS a phone collision with a Lyfe agent — never merges (one source per user)', async () => {
    // The Lyfe row keeps its provenance and gains NO mktrLeadsId.
    const lyfe = await User.findByPk(lyfeAgent.id);
    expect(lyfe.lyfeId).toBe(ID.lyfe);
    expect(lyfe.mktrLeadsId).toBeNull();
    // And no separate row was created for the conflicting upstream id.
    const conflictRow = await User.findOne({ where: { mktrLeadsId: ID.conflict } });
    expect(conflictRow).toBeNull();
  });

  it('keeps an already-mirrored agent active and does not duplicate it', async () => {
    const rows = await User.findAll({ where: { mktrLeadsId: ID.keep } });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(keepAgent.id);
    expect(rows[0].isActive).toBe(true);
  });

  it('deactivates an mktr-leads agent that vanished upstream', async () => {
    const stale = await User.findByPk(staleAgent.id);
    expect(stale.isActive).toBe(false);
  });

  it('does NOT deactivate the Lyfe agent (cross-source isolation)', async () => {
    const lyfe = await User.findByPk(lyfeAgent.id);
    expect(lyfe.isActive).toBe(true);
  });

  it('reports the skip in its result counts', () => {
    expect(result.locked).not.toBe(false);
    expect(result.skipped).toBeGreaterThanOrEqual(1);
  });
});
