import { jest } from '@jest/globals';
import '../setup.js';
import { makeWalletService } from '../../src/services/walletService.js';

/**
 * Money-path tests for the REAL walletService via the DI factory.
 * Invariants under test:
 *  - every balance mutation = guarded atomic UPDATE + ledger INSERT in ONE tx;
 *    overdraft is a 409 (never a negative balance), missing agent a 404;
 *  - commit debits exactly quantity × leadPriceCents, snapshots unitPriceCents,
 *    and rides the hidden wallet package (kind:'wallet') race-safely;
 *  - takedown refund credits leadsRemaining × unitPriceCents once per assignment
 *    (unique-violation replays are skipped) and only inside the caller's tx;
 *  - adminAdjust demands a non-zero amount + a note and records the actor.
 */

const FAKE_TX = { LOCK: { UPDATE: 'UPDATE' } };

function uniqueViolation() {
  const err = new Error('duplicate key value violates unique constraint');
  err.name = 'SequelizeUniqueConstraintError';
  return err;
}

function build({
  balanceAfter = 900,
  guardedUpdateEmpty = false,
  userCount = 1,
  campaign = null,
  walletPkg = null,
  pkgCreateThrowsUnique = false,
  raceWinner = null,
  refundCandidates = [],
  lockedRows = [],
  catalogRows = [],
  user = { id: 'agent-1', walletBalanceCents: 900 },
  externalTarget = { id: 'agent-1' },
} = {}) {
  const ledgerRows = [];
  const WalletLedger = {
    create: jest.fn(async (attrs) => {
      const row = { id: 'led-' + (ledgerRows.length + 1), ...attrs };
      ledgerRows.push(row);
      return row;
    }),
    findAndCountAll: jest.fn(async () => ({ rows: [], count: 0 })),
  };
  const User = {
    count: jest.fn(async () => userCount),
    findByPk: jest.fn(async () => user),
    findOne: jest.fn(async () => externalTarget),
    findAll: jest.fn(async () => []),
  };
  const Campaign = {
    findByPk: jest.fn(async () => campaign),
    findAll: jest.fn(async () => catalogRows),
  };
  let pkgCreated = false;
  const LeadPackage = {
    findOne: jest.fn(async () => (pkgCreated && raceWinner ? raceWinner : walletPkg)),
    create: jest.fn(async (attrs) => {
      if (pkgCreateThrowsUnique) {
        pkgCreated = true;
        throw uniqueViolation();
      }
      return { id: 'wpkg-1', ...attrs };
    }),
  };
  const createdAssignments = [];
  const LeadPackageAssignment = {
    create: jest.fn(async (attrs) => {
      const row = { id: 'asg-' + (createdAssignments.length + 1), ...attrs };
      createdAssignments.push(row);
      return row;
    }),
    findAll: jest.fn(async (q) => {
      // First call (candidates: attributes ['id']) vs second (locked rows).
      if (q?.lock) return lockedRows;
      if (q?.attributes && q.attributes.length === 1 && q.attributes[0] === 'id') return refundCandidates;
      return [];
    }),
  };
  const sequelize = {
    transaction: jest.fn(async (cb) => cb(FAKE_TX)),
    query: jest.fn(async (sql) => {
      if (String(sql).trim().startsWith('UPDATE users')) {
        return [guardedUpdateEmpty ? [] : [{ walletBalanceCents: balanceAfter }]];
      }
      return [[]];
    }),
  };
  const getSystemAgentId = jest.fn(async () => 'sys-agent');
  const IdempotencyKey = {
    findByPk: jest.fn(async () => null),
    create: jest.fn(async (attrs) => attrs),
    update: jest.fn(async () => [1]),
  };
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const svc = makeWalletService({ User, Campaign, LeadPackage, LeadPackageAssignment, WalletLedger, IdempotencyKey, sequelize, getSystemAgentId, logger });
  return { svc, User, Campaign, LeadPackage, LeadPackageAssignment, WalletLedger, IdempotencyKey, sequelize, logger, ledgerRows, createdAssignments };
}

describe('walletService credit/debit (applyLedgerEntry)', () => {
  test('credit writes ledger row with the RETURNING balance, inside the caller tx', async () => {
    const { svc, WalletLedger, sequelize } = build({ balanceAfter: 12345 });
    const entry = await svc.credit('agent-1', 500, { type: 'topup', paymentId: 'pay-9', transaction: FAKE_TX });
    expect(entry.balanceAfterCents).toBe(12345);
    expect(WalletLedger.create).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'agent-1', type: 'topup', amountCents: 500, balanceAfterCents: 12345, paymentId: 'pay-9' }),
      { transaction: FAKE_TX }
    );
    // caller tx → no NEW transaction opened
    expect(sequelize.transaction).not.toHaveBeenCalled();
  });

  test('debit overdraft → 409, no ledger row', async () => {
    const { svc, WalletLedger } = build({ guardedUpdateEmpty: true, userCount: 1 });
    await expect(svc.debit('agent-1', 999999, { type: 'commit', transaction: FAKE_TX }))
      .rejects.toMatchObject({ statusCode: 409 });
    expect(WalletLedger.create).not.toHaveBeenCalled();
  });

  test('missing agent → 404 (distinguished from overdraft)', async () => {
    const { svc } = build({ guardedUpdateEmpty: true, userCount: 0 });
    await expect(svc.credit('ghost', 100, { type: 'topup', transaction: FAKE_TX }))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  test('zero / negative / non-integer amounts are rejected up front (sync throw)', () => {
    const { svc } = build();
    expect(() => svc.credit('a', 0, { type: 'topup' })).toThrow('Credit amount must be a positive integer');
    expect(() => svc.credit('a', -5, { type: 'topup' })).toThrow('Credit amount must be a positive integer');
    expect(() => svc.debit('a', 1.5, { type: 'commit' })).toThrow('Debit amount must be a positive integer');
  });

  test('opens its own transaction when the caller has none', async () => {
    const { svc, sequelize } = build();
    await svc.credit('agent-1', 100, { type: 'adjustment', note: 'x' });
    expect(sequelize.transaction).toHaveBeenCalledTimes(1);
  });
});

const activeCampaign = (over = {}) => ({
  id: 'c-1', name: 'Tokyo Draw', status: 'active', is_active: true, leadPriceCents: 800, ...over,
});

describe('walletService.commit', () => {
  test('quantity must be an integer in [1, 10000]', async () => {
    const { svc } = build({ campaign: activeCampaign() });
    for (const q of [0, -1, 1.5, 10001, NaN, undefined]) {
      await expect(svc.commit('agent-1', 'c-1', q)).rejects.toMatchObject({ statusCode: 400 });
    }
  });

  test('campaign missing → 404; paused/unpriced → 409', async () => {
    await expect(build({ campaign: null }).svc.commit('a', 'c-x', 5)).rejects.toMatchObject({ statusCode: 404 });
    await expect(build({ campaign: activeCampaign({ status: 'paused', is_active: false }) }).svc.commit('a', 'c-1', 5)).rejects.toMatchObject({ statusCode: 409 });
    await expect(build({ campaign: activeCampaign({ leadPriceCents: null }) }).svc.commit('a', 'c-1', 5)).rejects.toMatchObject({ statusCode: 409 });
  });

  test('happy path: assignment snapshots + ledger debit of quantity × price', async () => {
    const { svc, LeadPackage, LeadPackageAssignment, WalletLedger } = build({ campaign: activeCampaign(), balanceAfter: 200 });
    const r = await svc.commit('agent-1', 'c-1', 12);

    // Hidden wallet package created with complete NOT NULL values — OUTSIDE the
    // money tx (unique-violation retry can't live inside an open pg transaction)
    expect(LeadPackage.create).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'wallet', campaignId: 'c-1', isPublic: false, status: 'active', price: 0, leadCount: 0, createdBy: 'sys-agent' })
    );
    // Assignment: source wallet + per-lead snapshot + dollars priceSnapshot
    expect(LeadPackageAssignment.create).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'agent-1', source: 'wallet', unitPriceCents: 800, leadsTotal: 12, leadsRemaining: 12, priceSnapshot: '96.00', status: 'active' }),
      expect.anything()
    );
    // Ledger: commit debit of -9600 with refs
    expect(WalletLedger.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'commit', amountCents: -9600, campaignId: 'c-1', assignmentId: 'asg-1' }),
      expect.anything()
    );
    expect(r).toMatchObject({ quantity: 12, unitPriceCents: 800, totalCents: 9600, balanceCents: 200, campaignId: 'c-1' });
  });

  test('reuses the existing wallet package (no second create)', async () => {
    const { svc, LeadPackage } = build({ campaign: activeCampaign(), walletPkg: { id: 'wpkg-existing' } });
    await svc.commit('agent-1', 'c-1', 1);
    expect(LeadPackage.create).not.toHaveBeenCalled();
  });

  test('find-or-create race: unique violation re-reads the winner row', async () => {
    const { svc, LeadPackageAssignment } = build({
      campaign: activeCampaign(),
      walletPkg: null,
      pkgCreateThrowsUnique: true,
      raceWinner: { id: 'wpkg-winner' },
    });
    await svc.commit('agent-1', 'c-1', 2);
    expect(LeadPackageAssignment.create).toHaveBeenCalledWith(
      expect.objectContaining({ leadPackageId: 'wpkg-winner' }),
      expect.anything()
    );
  });

  test('insufficient balance rolls the whole commit back (debit throws inside tx)', async () => {
    const { svc } = build({ campaign: activeCampaign(), guardedUpdateEmpty: true, userCount: 1 });
    await expect(svc.commit('agent-1', 'c-1', 5)).rejects.toMatchObject({ statusCode: 409 });
  });

  test('rejects when the agent is no longer an active external agent (in-tx revalidation)', async () => {
    const { svc, WalletLedger } = build({ campaign: activeCampaign(), externalTarget: null });
    await expect(svc.commit('agent-1', 'c-1', 5)).rejects.toMatchObject({ statusCode: 409 });
    expect(WalletLedger.create).not.toHaveBeenCalled();
  });

  test('idempotent commit: the key row is written FIRST inside the tx and the response stored', async () => {
    const { svc, IdempotencyKey } = build({ campaign: activeCampaign() });
    const r = await svc.commit('agent-1', 'c-1', 2, { requestId: 'req-abc-12345' });
    expect(r.replayed).toBeUndefined();
    expect(IdempotencyKey.create).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'wallet:commit:agent-1:req-abc-12345', scope: 'wallet:commit' }),
      { transaction: FAKE_TX }
    );
    expect(IdempotencyKey.update).toHaveBeenCalledWith(
      expect.objectContaining({ responseBody: expect.objectContaining({ totalCents: 1600 }), responseCode: 201 }),
      expect.objectContaining({ where: { key: 'wallet:commit:agent-1:req-abc-12345' } })
    );
  });

  test('idempotent commit replay: stored response returned, no money moves', async () => {
    const { svc, IdempotencyKey, WalletLedger, sequelize } = build({ campaign: activeCampaign() });
    IdempotencyKey.findByPk.mockResolvedValueOnce({ responseBody: { assignmentId: 'asg-prior', totalCents: 1600 } });
    const r = await svc.commit('agent-1', 'c-1', 2, { requestId: 'req-abc-12345' });
    expect(r).toEqual({ assignmentId: 'asg-prior', totalCents: 1600, replayed: true });
    expect(sequelize.transaction).not.toHaveBeenCalled();
    expect(WalletLedger.create).not.toHaveBeenCalled();
  });

  test('concurrent duplicate: PK collision aborts the duplicate tx and returns the winner', async () => {
    const { svc, IdempotencyKey } = build({ campaign: activeCampaign() });
    IdempotencyKey.create.mockRejectedValueOnce(uniqueViolation());
    IdempotencyKey.findByPk
      .mockResolvedValueOnce(null) // pre-check: not yet written
      .mockResolvedValueOnce({ responseBody: { assignmentId: 'asg-winner' } }); // after collision
    const r = await svc.commit('agent-1', 'c-1', 2, { requestId: 'req-abc-12345' });
    expect(r).toEqual({ assignmentId: 'asg-winner', replayed: true });
  });

  test('malformed requestId is rejected before any read', async () => {
    const { svc } = build({ campaign: activeCampaign() });
    await expect(svc.commit('agent-1', 'c-1', 2, { requestId: 'no spaces!' })).rejects.toMatchObject({ statusCode: 400 });
  });
});

function refundableRow(over = {}) {
  const row = {
    id: 'asg-1', agentId: 'agent-1', source: 'wallet', status: 'active',
    leadsRemaining: 7, unitPriceCents: 800, ...over,
  };
  row.update = jest.fn(async (u) => Object.assign(row, u));
  return row;
}

describe('walletService.refundCampaignCommitments', () => {
  test('requires the caller transaction', async () => {
    const { svc } = build();
    await expect(svc.refundCampaignCommitments('c-1', {})).rejects.toMatchObject({ statusCode: 500 });
  });

  test('no open commitments → zero result, no writes', async () => {
    const { svc, WalletLedger } = build({ refundCandidates: [] });
    const r = await svc.refundCampaignCommitments('c-1', { transaction: FAKE_TX });
    expect(r).toEqual({ refunded: 0, totalCents: 0 });
    expect(WalletLedger.create).not.toHaveBeenCalled();
  });

  test('refunds leadsRemaining × unitPriceCents, zeroes and completes the row', async () => {
    const row = refundableRow();
    const { svc, WalletLedger } = build({ refundCandidates: [{ id: 'asg-1' }], lockedRows: [row] });
    const r = await svc.refundCampaignCommitments('c-1', { transaction: FAKE_TX, reason: 'campaign_archived' });
    expect(WalletLedger.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'takedown_refund', amountCents: 5600, assignmentId: 'asg-1', campaignId: 'c-1', note: 'campaign_archived' }),
      expect.anything()
    );
    expect(row.update).toHaveBeenCalledWith({ leadsRemaining: 0, status: 'completed' }, { transaction: FAKE_TX });
    expect(r).toEqual({ refunded: 1, totalCents: 5600 });
  });

  test('re-check under lock: a row completed by a concurrent archive is skipped', async () => {
    const row = refundableRow({ status: 'completed' });
    const { svc, WalletLedger } = build({ refundCandidates: [{ id: 'asg-1' }], lockedRows: [row] });
    const r = await svc.refundCampaignCommitments('c-1', { transaction: FAKE_TX });
    expect(r.refunded).toBe(0);
    expect(WalletLedger.create).not.toHaveBeenCalled();
  });

  test('a unique violation on the refund ledger aborts loudly (code-bug signal, whole archive rolls back)', async () => {
    const rowA = refundableRow({ id: 'asg-1' });
    const { svc, WalletLedger } = build({
      refundCandidates: [{ id: 'asg-1' }],
      lockedRows: [rowA],
    });
    // The unique partial index fires only on a genuine double-refund bug —
    // swallowing it inside the open transaction would poison it (pg 25P02),
    // so it must PROPAGATE and take the archive down with it.
    WalletLedger.create.mockImplementationOnce(async () => { throw uniqueViolation(); });
    await expect(svc.refundCampaignCommitments('c-1', { transaction: FAKE_TX })).rejects.toMatchObject({ name: 'SequelizeUniqueConstraintError' });
    expect(rowA.update).not.toHaveBeenCalled();
  });

  test('wallet assignment without unitPriceCents ABORTS the archive (data corruption, never strand)', async () => {
    const row = refundableRow({ unitPriceCents: null });
    const { svc, logger, WalletLedger } = build({ refundCandidates: [{ id: 'asg-1' }], lockedRows: [row] });
    await expect(svc.refundCampaignCommitments('c-1', { transaction: FAKE_TX })).rejects.toMatchObject({ statusCode: 500 });
    expect(WalletLedger.create).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
    expect(row.update).not.toHaveBeenCalled();
  });
});

describe('walletService.adminAdjust', () => {
  test('rejects zero amount and missing note', async () => {
    const { svc } = build();
    await expect(svc.adminAdjust('agent-1', 0, 'note', 'admin-1')).rejects.toMatchObject({ statusCode: 400 });
    await expect(svc.adminAdjust('agent-1', 500, '', 'admin-1')).rejects.toMatchObject({ statusCode: 400 });
    await expect(svc.adminAdjust('agent-1', 500, '   ', 'admin-1')).rejects.toMatchObject({ statusCode: 400 });
  });

  test('rejects non-external targets (no mktrLeadsId) with 404', async () => {
    const { svc } = build({ externalTarget: null });
    await expect(svc.adminAdjust('internal-agent', 500, 'goodwill', 'admin-1')).rejects.toMatchObject({ statusCode: 404 });
  });

  test('applies a signed adjustment with the actor recorded', async () => {
    const { svc, WalletLedger } = build({ balanceAfter: 4200 });
    const r = await svc.adminAdjust('agent-1', -300, ' duplicate delivery credit-back ', 'admin-7');
    expect(WalletLedger.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'adjustment', amountCents: -300, note: 'duplicate delivery credit-back', createdBy: 'admin-7' }),
      expect.anything()
    );
    expect(r.balanceCents).toBe(4200);
  });
});

describe('walletService.getCatalog', () => {
  test('returns whitelisted fields and drops non-positive prices defensively', async () => {
    const { svc } = build({
      catalogRows: [
        { id: 'c-1', name: 'A', description: '  Great campaign  ', leadPriceCents: 800, start_date: 's', end_date: 'e' },
        { id: 'c-2', name: 'B', description: null, leadPriceCents: 0, start_date: null, end_date: null },
      ],
    });
    const rows = await svc.getCatalog();
    expect(rows).toEqual([
      { id: 'c-1', name: 'A', description: 'Great campaign', leadPriceCents: 800, startDate: 's', endDate: 'e' },
    ]);
  });
});

describe('walletService.getSummary', () => {
  test('404 for an unknown agent', async () => {
    const { svc } = build({ user: null });
    await expect(svc.getSummary('ghost')).rejects.toMatchObject({ statusCode: 404 });
  });

  test('returns balance + open commitments without leaking agentId per row', async () => {
    const { svc, LeadPackageAssignment } = build({ user: { id: 'agent-1', walletBalanceCents: 777 } });
    LeadPackageAssignment.findAll.mockResolvedValueOnce([
      {
        id: 'asg-1', agentId: 'agent-1', leadsRemaining: 4, unitPriceCents: 800,
        package: { campaignId: 'c-1', campaign: { id: 'c-1', name: 'Tokyo Draw' } },
      },
    ]);
    const s = await svc.getSummary('agent-1');
    expect(s.balanceCents).toBe(777);
    expect(s.openCommitments).toEqual([
      expect.objectContaining({ assignmentId: 'asg-1', campaign: 'Tokyo Draw', remaining: 4, unitPriceCents: 800, committedValueCents: 3200 }),
    ]);
    expect(s.openCommitments[0].agentId).toBeUndefined();
  });
});
