/**
 * Real-DB smoke test for the lead-quota raw SQL.
 *
 * The unit suite mocks the database, so the actual SQL (migration 034, the
 * chargeLeadCredit CTE `FOR UPDATE OF a SKIP LOCKED`, and the auto-release claim
 * UPDATE) has never executed against Postgres. This script does exactly that:
 * runs migrations, seeds a quota campaign + agent + funded package, then exercises
 * the real functions and asserts behaviour. It cleans up after itself.
 *
 * Run (point DB_* at a real/test Postgres — defaults match test/setup.js):
 *   cd backend && JWT_SECRET=smoke \
 *     DB_HOST=localhost DB_PORT=5433 DB_NAME=mktr_test DB_USER=mktr_local DB_PASSWORD= \
 *     node scripts/lead-quota-smoke.js
 *
 * Exit 0 = all checks passed; 1 = a check failed; 2 = error (e.g. no DB).
 */
import { Op } from 'sequelize';
import { sequelize, Campaign, User, LeadPackage, LeadPackageAssignment, Prospect } from '../src/models/index.js';
import { runMigrations } from '../src/database/runMigrations.js';
import { chargeLeadCredit } from '../src/services/leadCredits.js';
import { makeReleaseSweep } from '../src/services/releaseSweep.js';

const TAG = '[quota-smoke]';
let failures = 0;
const check = (name, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${TAG} ${name}`); if (!ok) failures++; };

async function main() {
  await sequelize.authenticate();
  console.log(`${TAG} connected — running migrations (validates migration 034 + chain)…`);
  await runMigrations();

  const stamp = Date.now();
  const admin = await User.create({
    email: `smoke-admin-${stamp}@quota.local`, firstName: 'Smoke', lastName: 'Admin',
    fullName: 'Smoke Admin', role: 'admin', isActive: true, emailVerified: true,
  });
  const agent = await User.create({
    email: `smoke-agent-${stamp}@quota.local`, firstName: 'Smoke', lastName: 'Agent',
    fullName: 'Smoke Agent', role: 'agent', isActive: true, emailVerified: true,
    phone: `65${String(stamp).slice(-8)}`,
  });
  const campaign = await Campaign.create({
    name: `[smoke] quota ${stamp}`, createdBy: admin.id, enforceLeadQuota: true,
    is_active: true, status: 'active',
  });
  const pkg = await LeadPackage.create({
    name: `smoke pkg ${stamp}`, price: 0, leadCount: 2, campaignId: campaign.id,
    type: 'basic', status: 'active', createdBy: admin.id,
  });
  const assignment = await LeadPackageAssignment.create({
    agentId: agent.id, leadPackageId: pkg.id, leadsTotal: 2, leadsRemaining: 2,
    priceSnapshot: 0, status: 'active', purchaseDate: new Date(),
  });

  try {
    // ── 1) chargeLeadCredit — the campaign-scoped atomic CTE ─────────────────
    check('charge #1 succeeds', (await chargeLeadCredit(agent.id, campaign.id)) === true);
    check('charge #2 succeeds', (await chargeLeadCredit(agent.id, campaign.id)) === true);
    check('charge #3 fails (credits exhausted)', (await chargeLeadCredit(agent.id, campaign.id)) === false);
    await assignment.reload();
    check('leadsRemaining drawn down to 0', assignment.leadsRemaining === 0);
    check("assignment marked 'completed' at 0", assignment.status === 'completed');
    check('charge for a DIFFERENT campaign does not draw this package',
      (await chargeLeadCredit(agent.id, '00000000-0000-0000-0000-000000000000')) === false);

    // ── 2) auto-release sweep — the atomic claim UPDATE ──────────────────────
    await assignment.update({ leadsRemaining: 1, status: 'active' });
    const held = await Prospect.create({
      firstName: 'Held', leadSource: 'website', leadStatus: 'new', priority: 'medium',
      campaignId: campaign.id, assignedAgentId: null,
      quarantinedAt: new Date(), quarantineReason: 'no_funded_agent',
    });
    const sweep = makeReleaseSweep({ dispatchEvent: async () => {} }); // no real webhooks
    const released = await sweep.sweepCampaign(campaign.id);
    check('sweep releases exactly 1 held lead', released === 1);
    await held.reload();
    check('released lead is now assigned to the funded agent', held.assignedAgentId === agent.id);
    check('released lead quarantinedAt cleared', held.quarantinedAt === null);
    await assignment.reload();
    check('sweep charged the credit (leadsRemaining 0)', assignment.leadsRemaining === 0);

    // ── 3) sweep stops when credits run out (re-hold) ────────────────────────
    const held2 = await Prospect.create({
      firstName: 'Held2', leadSource: 'website', leadStatus: 'new', priority: 'medium',
      campaignId: campaign.id, assignedAgentId: null,
      quarantinedAt: new Date(), quarantineReason: 'no_funded_agent',
    });
    const released2 = await sweep.sweepCampaign(campaign.id); // no credits left
    check('sweep releases nothing when unfunded', released2 === 0);
    await held2.reload();
    check('unfunded held lead stays held', held2.quarantinedAt !== null && held2.assignedAgentId === null);

    // ── 4) held-leads query (the GET endpoint's filter) ──────────────────────
    const { count } = await Prospect.findAndCountAll({
      where: { campaignId: campaign.id, quarantinedAt: { [Op.ne]: null } },
      order: [['quarantinedAt', 'ASC']],
    });
    check('held-leads query finds the still-held lead', count === 1);
  } finally {
    await Prospect.destroy({ where: { campaignId: campaign.id } }).catch(() => {});
    await LeadPackageAssignment.destroy({ where: { id: assignment.id } }).catch(() => {});
    await LeadPackage.destroy({ where: { id: pkg.id } }).catch(() => {});
    await Campaign.destroy({ where: { id: campaign.id } }).catch(() => {});
    await User.destroy({ where: { id: [admin.id, agent.id] } }).catch(() => {});
    console.log(`${TAG} cleaned up seeded rows`);
  }

  console.log(`\n${TAG} ${failures === 0 ? '✅ ALL CHECKS PASSED' : `❌ ${failures} CHECK(S) FAILED`}`);
  await sequelize.close();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error(`${TAG} ERROR:`, err?.message || err);
  try { await sequelize.close(); } catch { /* ignore */ }
  process.exit(2);
});
