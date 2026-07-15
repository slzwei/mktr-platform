import { DataTypes } from 'sequelize';
import { sequelize } from '../database/connection.js';

/**
 * Append-only agent-wallet ledger (migration 070) — the audit truth behind
 * users.walletBalanceCents. Rows are only ever INSERTed, in the same
 * transaction as the balance update (walletService.applyLedgerEntry).
 * No updatedAt by design; agentId RESTRICTs user hard-deletion.
 */
const WALLET_LEDGER_TYPES = ['topup', 'commit', 'takedown_refund', 'adjustment'];

const WalletLedger = sequelize.define('WalletLedger', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  agentId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: { model: 'users', key: 'id' }
  },
  type: {
    type: DataTypes.STRING(24),
    allowNull: false,
    validate: { isIn: [WALLET_LEDGER_TYPES] }
  },
  amountCents: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'Signed: credits positive, debits negative'
  },
  balanceAfterCents: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  paymentId: {
    type: DataTypes.UUID,
    allowNull: true,
    references: { model: 'payments', key: 'id' }
  },
  assignmentId: {
    type: DataTypes.UUID,
    allowNull: true,
    references: { model: 'lead_package_assignments', key: 'id' }
  },
  campaignId: {
    type: DataTypes.UUID,
    allowNull: true,
    references: { model: 'campaigns', key: 'id' }
  },
  note: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  createdBy: {
    type: DataTypes.UUID,
    allowNull: true,
    comment: 'Acting admin for adjustments; null = system',
    references: { model: 'users', key: 'id' }
  },
  createdAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'wallet_ledger',
  timestamps: false, // append-only: explicit createdAt, no updatedAt (070)
  indexes: [
    { fields: ['agentId', 'createdAt'], name: 'idx_wallet_ledger_agent_created' },
    {
      unique: true,
      fields: ['assignmentId'],
      where: { type: 'takedown_refund' },
      name: 'uq_wallet_ledger_refund_assignment'
    },
    {
      unique: true,
      fields: ['paymentId'],
      where: { type: 'topup' },
      name: 'uq_wallet_ledger_topup_payment'
    }
  ]
});

export { WALLET_LEDGER_TYPES };
export default WalletLedger;
