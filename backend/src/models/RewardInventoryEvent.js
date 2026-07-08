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
  activationId: { type: DataTypes.UUID, allowNull: true },
  entitlementId: { type: DataTypes.UUID, allowNull: true },
  redemptionId: { type: DataTypes.UUID, allowNull: true },
  type: {
    type: DataTypes.STRING(24),
    allowNull: false,
    comment: 'committed|increased|decreased|allocated|deallocated|issued|issue_reversed|redeemed|expired|cancelled|manual_adjustment'
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
