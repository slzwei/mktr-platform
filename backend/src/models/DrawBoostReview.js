import { DataTypes } from 'sequelize';
import { sequelize } from '../database/connection.js';

/**
 * Ops review of a virtual-meeting (agent_button) unlock for draw weighting
 * (docs/plans/lucky-draw-10x.md §4.2/§8.1). agent_scan unlocks boost
 * automatically; agent_button unlocks are assertion-only, so each one must be
 * approved/rejected here before the draw can seal. The voucher itself is
 * untouched either way — this decides only the ×N draw weight.
 */
const DrawBoostReview = sequelize.define('DrawBoostReview', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  drawId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: { model: 'draws', key: 'id' }
  },
  entitlementId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: { model: 'reward_entitlements', key: 'id' }
  },
  prospectId: { type: DataTypes.UUID, allowNull: true, comment: 'Denormalized join aid — no FK, evidence survives lead erasure' },
  decision: { type: DataTypes.STRING(16), allowNull: false, comment: 'approved|rejected' },
  reviewedByUserId: { type: DataTypes.UUID, allowNull: false, references: { model: 'users', key: 'id' } },
  reason: { type: DataTypes.TEXT, allowNull: true }
}, {
  tableName: 'draw_boost_reviews',
  timestamps: true,
  indexes: [
    { unique: true, fields: ['drawId', 'entitlementId'], name: 'uq_dbr_draw_entitlement' }
  ]
});

export default DrawBoostReview;
