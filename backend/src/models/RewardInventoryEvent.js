import { DataTypes } from 'sequelize';
import { sequelize } from '../database/connection.js';

/**
 * Append-only inventory ledger (docs/redeem-ops/ERD.md §3.14). Quantities are
 * always POSITIVE — direction lives in `type`. Counters on reward_offers /
 * activations are the fast path; this ledger is the auditable truth. The two are
 * written in the SAME transaction by inventoryService.
 */
const RewardInventoryEvent = sequelize.define('RewardInventoryEvent', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  rewardOfferId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: { model: 'reward_offers', key: 'id' }
  },
  // Real references, not bare UUIDs (P1-8, migration 102): this ledger is the
  // reconciliation source of truth, so a dangling pointer is an audit trail
  // that cannot be re-walked. Mirrored here because test boot builds the schema
  // from the MODELS via sync({force:true}) before migrations run.
  activationId: {
    type: DataTypes.UUID,
    allowNull: true,
    references: { model: 'activations', key: 'id' }
  },
  entitlementId: {
    type: DataTypes.UUID,
    allowNull: true,
    references: { model: 'reward_entitlements', key: 'id' }
  },
  redemptionId: {
    type: DataTypes.UUID,
    allowNull: true,
    references: { model: 'redemptions', key: 'id' }
  },
  type: {
    type: DataTypes.STRING(24),
    allowNull: false,
    comment: 'committed|increased|decreased|allocated|deallocated|issued|issue_reversed|redeemed|redeem_reversed|expired|cancelled|manual_adjustment'
  },
  quantity: {
    type: DataTypes.INTEGER,
    allowNull: false,
    validate: { min: 1 }
  },
  actorType: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'staff' },
  actorUserId: { type: DataTypes.UUID, allowNull: true, references: { model: 'users', key: 'id' } },
  reason: { type: DataTypes.STRING(255), allowNull: true }
}, {
  tableName: 'reward_inventory_events',
  timestamps: true,
  updatedAt: false,
  indexes: [
    { fields: ['rewardOfferId', 'createdAt'], name: 'idx_rie_offer_created' },
    { fields: ['activationId'], name: 'idx_rie_activation' }
  ]
});

export default RewardInventoryEvent;
