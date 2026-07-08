import { DataTypes } from 'sequelize';
import { sequelize } from '../database/connection.js';

/** Append-only fulfilment history (docs/redeem-ops/ERD.md §3.18). */
const RedemptionEvent = sequelize.define('RedemptionEvent', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  entitlementId: { type: DataTypes.UUID, allowNull: false, references: { model: 'reward_entitlements', key: 'id' } },
  redemptionId: { type: DataTypes.UUID, allowNull: true, references: { model: 'redemptions', key: 'id' } },
  type: {
    type: DataTypes.STRING(24),
    allowNull: false,
    comment: 'reserved|unlocked|claim_viewed|verify_attempt|verified|redeemed|rejected|expired|manual_override|reversed'
  },
  metadata: { type: DataTypes.JSONB, allowNull: true },
  actorType: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'system', comment: 'staff|agent|partner_user|consumer|system' },
  actorUserId: { type: DataTypes.UUID, allowNull: true }
}, {
  tableName: 'redemption_events',
  timestamps: true,
  updatedAt: false,
  indexes: [
    { fields: ['entitlementId', 'createdAt'], name: 'idx_rde_entitlement_created' }
  ]
});

export default RedemptionEvent;
