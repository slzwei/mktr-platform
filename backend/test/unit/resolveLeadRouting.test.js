import { jest } from '@jest/globals';
import '../setup.js';

// Mock the models + logger imports so resolveLeadRouting runs with no real DB.
const User = { findOne: jest.fn(), findAll: jest.fn() };
const QrTag = { findByPk: jest.fn() };
const RoundRobinCursor = { findOne: jest.fn(), create: jest.fn(), findOrCreate: jest.fn(), update: jest.fn() };
const LeadPackageAssignment = { findAll: jest.fn() };
const LeadPackage = {};
// systemAgent.js now also imports these (resolveLeadAssignment + the external
// MKTR-Leads pool). resolveLeadRouting itself doesn't use them, but the ESM
// linker requires every named import the module declares to exist on the mock.
const ExternalAgent = { findOne: jest.fn(), findAll: jest.fn() };
const ExternalCampaignAgent = { findOne: jest.fn(), findAll: jest.fn() };
const sequelize = { transaction: jest.fn(), literal: jest.fn((sql) => sql) };

jest.unstable_mockModule('../../src/models/index.js', () => ({
  User, QrTag, RoundRobinCursor, LeadPackageAssignment, LeadPackage,
  ExternalAgent, ExternalCampaignAgent, sequelize,
}));
jest.unstable_mockModule('../../src/utils/logger.js', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const { resolveLeadRouting } = await import('../../src/services/systemAgent.js');

describe('resolveLeadRouting (unit) — route labelling for quota gating', () => {
  beforeEach(() => jest.clearAllMocks());

  it('tier 1 — requester is an agent → via:self (no DB lookups)', async () => {
    const r = await resolveLeadRouting({ reqUser: { id: 'me-agent', role: 'agent' } });
    expect(r).toEqual({ agentId: 'me-agent', via: 'self' });
    expect(User.findOne).not.toHaveBeenCalled();
  });

  it('tier 2 — admin with a valid explicit agent → via:admin', async () => {
    User.findOne.mockResolvedValue({ id: 'target-agent' });
    const r = await resolveLeadRouting({ reqUser: { role: 'admin' }, requestedAgentId: 'target-agent' });
    expect(r).toEqual({ agentId: 'target-agent', via: 'admin' });
  });

  it('tier 3 — QR-owner agent → via:qr', async () => {
    QrTag.findByPk.mockResolvedValue({ assignedAgentId: 'qr-owner' });
    User.findOne.mockResolvedValue({ id: 'qr-owner' });
    const r = await resolveLeadRouting({ qrTagId: 'qr-1' });
    expect(r).toEqual({ agentId: 'qr-owner', via: 'qr' });
  });

  it('tier 3 — legacy QR ownerUserId is honoured → via:qr', async () => {
    QrTag.findByPk.mockResolvedValue({ assignedAgentId: null, ownerUserId: 'legacy-owner' });
    User.findOne.mockResolvedValue({ id: 'legacy-owner' });
    const r = await resolveLeadRouting({ qrTagId: 'qr-legacy' });
    expect(r).toEqual({ agentId: 'legacy-owner', via: 'qr' });
  });

  it('tier 4 — lead-package round-robin → via:package, and advances the cursor', async () => {
    LeadPackageAssignment.findAll.mockResolvedValue([{ agentId: 'pkg-agent' }]);
    User.findAll.mockResolvedValue([{ id: 'pkg-agent' }]);
    // Merged cursor mechanics (PR branch's race-safe path): findOrCreate seeds the
    // row, then a single atomic monotonic `UPDATE ... RETURNING` advances it,
    // resolving to [affectedCount, [updatedRow]]. Modulo is applied at read time.
    RoundRobinCursor.findOrCreate.mockResolvedValue([{ campaignId: 'camp-1', cursor: 0 }, false]);
    RoundRobinCursor.update.mockResolvedValue([1, [{ cursor: 1 }]]);

    const r = await resolveLeadRouting({ campaignId: 'camp-1' });

    expect(r).toEqual({ agentId: 'pkg-agent', via: 'package' }); // (1-1) % 1 → pkg-agent
    expect(RoundRobinCursor.update).toHaveBeenCalled(); // cursor advanced atomically
  });

  it('tier 4 falls through when the campaign has no funded package agents (→ not package)', async () => {
    // No package assignments ⇒ tier 4 yields nothing; with no qr/admin it would reach
    // the System-Agent fallback. We assert it did NOT label this as a package route.
    LeadPackageAssignment.findAll.mockResolvedValue([]);
    // getSystemAgentId path: a DEFAULT_AGENT_ID short-circuit keeps it DB-light.
    process.env.DEFAULT_AGENT_ID = '';
    User.findOne.mockResolvedValue({ id: 'system', email: 'system@mktr.local', role: 'agent', isActive: true });
    const r = await resolveLeadRouting({ campaignId: 'camp-empty' });
    expect(r.via).toBe('fallback');
  });
});
