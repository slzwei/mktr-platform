import { getApp, closeDb, createTestUser } from '../helpers.js';
import { User } from '../../src/models/index.js';
import { sequelize } from '../../src/database/connection.js';
import { adapterRegistry } from '../../src/integrations/AdapterRegistry.js';
import { syncAgentsFromMktrLeads } from '../../src/services/agentSyncService.js';

/**
 * Integration: mirror mktr-leads agents into local `users` (the second agent
 * source). Requires Postgres (advisory lock + CHECK constraint + raw-SQL
 * deactivation) — runs in CI alongside the other integration suites.
 *
 * mktr-leads semantics under test (mirrorsIsActive + authoritativeProfile):
 *   - brand-new active agent            → created with mktrLeadsId
 *   - phone collision with a Lyfe agent → SKIPPED, never merged (one source per user)
 *   - present agent (externalId match)  → kept, profile OVERWRITTEN from upstream
 *   - upstream-DEACTIVATED agent        → mirrored inactive, NOT pending-deleted
 *     (regression: active-only fetch made deactivation look like deletion →
 *      24h hard-delete → CASCADE destroyed lead_package_assignments)
 *   - upstream-reactivated agent        → mirrored back to active
 *   - truly ABSENT agent (deleted)      → deactivated + pending-deleted (two-phase)
 *   - the Lyfe agent                    → untouched by the mktr-leads sync
 */

const RUN = String(Date.now()).slice(-6);
const ID = {
  keep: `M_keep_${RUN}`,
  stale: `M_stale_${RUN}`,
  fresh: `M_new_${RUN}`,
  conflict: `M_conflict_${RUN}`,
  deact: `M_deact_${RUN}`,
  react: `M_react_${RUN}`,
  lyfe: `L_${RUN}`,
};
const PHONE = {
  lyfe: `6591${RUN}`, // the conflict agent reuses this
  keep: `6593${RUN}`,
  stale: `6592${RUN}`,
  fresh: `6594${RUN}`,
  deact: `6595${RUN}`,
  react: `6596${RUN}`,
};

let lyfeAgent, staleAgent, keepAgent, deactAgent, reactAgent;

// Fake adapter: returns exactly the upstream snapshot we want, no network.
// Declares the same semantics as the real MktrLeadsAdapter.
const fakeAdapter = {
  id: 'mktr_leads',
  localIdField: 'mktrLeadsId',
  mirrorsIsActive: true,
  authoritativeProfile: true,
  invalidateCache() {},
  async getAgent() {
    return null;
  },
  async listAgents() {
    return [
      // Present + active, with CHANGED name/agency → authoritative overwrite.
      { externalId: ID.keep, fullName: 'Keep Renamed', email: `keep-${RUN}@ml.test`, phone: PHONE.keep, externalRole: 'agent', isActive: true, agency: 'Acme Advisory' },
      // Brand new.
      { externalId: ID.fresh, fullName: 'Fresh Agent', email: `fresh-${RUN}@ml.test`, phone: PHONE.fresh, externalRole: 'agent', isActive: true, agency: null },
      // Same phone as the Lyfe agent below → must be SKIPPED, not merged.
      { externalId: ID.conflict, fullName: 'Conflict Agent', email: `conflict-${RUN}@ml.test`, phone: PHONE.lyfe, externalRole: 'agent', isActive: true, agency: null },
      // Present but DEACTIVATED upstream → mirror inactive, never pending-delete.
      { externalId: ID.deact, fullName: 'Deact Mktr', email: `deact-${RUN}@ml.test`, phone: PHONE.deact, externalRole: 'agent', isActive: false, agency: null },
      // Present and reactivated upstream (local row starts inactive).
      { externalId: ID.react, fullName: 'React Mktr', email: `react-${RUN}@ml.test`, phone: PHONE.react, externalRole: 'agent', isActive: true, agency: null },
      // ID.stale is intentionally ABSENT — simulates a deleted account.
    ];
  },
};

let result;

beforeAll(async () => {
  process.env.WEBHOOK_ENABLED = 'false';
  await getApp();

  // A Lyfe-owned agent — the conflict agent shares its phone.
  ({ user: lyfeAgent } = await createTestUser({ role: 'agent', lyfeId: ID.lyfe, phone: PHONE.lyfe, firstName: 'Lyfe', lastName: 'Owned' }));
  // An mktr-leads agent upstream no longer returns AT ALL → absent → two-phase delete path.
  ({ user: staleAgent } = await createTestUser({ role: 'agent', mktrLeadsId: ID.stale, phone: PHONE.stale, firstName: 'Stale', lastName: 'Mktr' }));
  // An mktr-leads agent the snapshot still returns (externalId match) with changed profile.
  ({ user: keepAgent } = await createTestUser({ role: 'agent', mktrLeadsId: ID.keep, phone: PHONE.keep, firstName: 'Keep', lastName: 'Mktr', fullName: 'Keep Mktr' }));
  // Active locally, deactivated upstream.
  ({ user: deactAgent } = await createTestUser({ role: 'agent', mktrLeadsId: ID.deact, phone: PHONE.deact, firstName: 'Deact', lastName: 'Mktr' }));
  // Inactive locally, reactivated upstream.
  ({ user: reactAgent } = await createTestUser({ role: 'agent', mktrLeadsId: ID.react, phone: PHONE.react, firstName: 'React', lastName: 'Mktr', isActive: false }));

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
    const lyfe = await User.findByPk(lyfeAgent.id);
    expect(lyfe.lyfeId).toBe(ID.lyfe);
    expect(lyfe.mktrLeadsId).toBeNull();
    const conflictRow = await User.findOne({ where: { mktrLeadsId: ID.conflict } });
    expect(conflictRow).toBeNull();
  });

  it('authoritatively overwrites profile fields from upstream (name + derived parts + agency→companyName)', async () => {
    const rows = await User.findAll({ where: { mktrLeadsId: ID.keep } });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(keepAgent.id);
    expect(rows[0].fullName).toBe('Keep Renamed');
    expect(rows[0].firstName).toBe('Keep');
    expect(rows[0].lastName).toBe('Renamed');
    expect(rows[0].companyName).toBe('Acme Advisory');
    expect(rows[0].isActive).toBe(true);
  });

  it('mirrors an upstream-DEACTIVATED agent inactive WITHOUT marking it for deletion (regression)', async () => {
    const deact = await User.findByPk(deactAgent.id);
    expect(deact.isActive).toBe(false);
    // The old active-only fetch made this row look DELETED upstream →
    // pending_deletion → 24h hard-delete → CASCADE wiped its lead-package
    // assignments. Present-but-inactive must never enter the deletion path.
    expect(deact.pending_deletion_at).toBeNull();
  });

  it('mirrors an upstream-reactivated agent back to active', async () => {
    const react = await User.findByPk(reactAgent.id);
    expect(react.isActive).toBe(true);
  });

  it('still deactivates + pending-deletes an agent that is truly ABSENT upstream', async () => {
    const stale = await User.findByPk(staleAgent.id);
    expect(stale.isActive).toBe(false);
    expect(stale.pending_deletion_at).not.toBeNull();
  });

  it('does NOT touch the Lyfe agent (cross-source isolation)', async () => {
    const lyfe = await User.findByPk(lyfeAgent.id);
    expect(lyfe.isActive).toBe(true);
  });

  it('reports the conflict skip in its result counts', () => {
    expect(result.locked).not.toBe(false);
    expect(result.skipped).toBeGreaterThanOrEqual(1);
  });

  it('try-lock skips while held; {wait:true} blocks behind the holder and then runs', async () => {
    // Hold the shared advisory lock from a separate transaction.
    const holder = await sequelize.transaction();
    await sequelize.query(`SELECT pg_advisory_xact_lock(hashtext('agent_sync'))`, { transaction: holder });

    // Cron semantics: try-lock → clean skip.
    const skippedRun = await syncAgentsFromMktrLeads();
    expect(skippedRun.locked).toBe(false);

    // Management semantics: wait for the lock instead of skipping.
    const waiting = syncAgentsFromMktrLeads({ wait: true });
    await new Promise((r) => setTimeout(r, 300));
    await holder.commit(); // releases the xact lock
    const res = await waiting;
    expect(res.locked).not.toBe(false);
  }, 20000);
});
