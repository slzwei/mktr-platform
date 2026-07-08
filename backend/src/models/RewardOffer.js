import { DataTypes } from 'sequelize';
import { sequelize } from '../database/connection.js';

/**
 * A partner-funded reward (docs/redeem-ops/ERD.md §3.11). Quantity counters are
 * GUARDED — mutated only via inventoryService's conditional UPDATEs, each paired
 * with an append-only reward_inventory_events ledger row in the same transaction.
 * Invariants: committed ≥ allocated ≥ issued ≥ redeemed.
 */
const RewardOffer = sequelize.define('RewardOffer', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  partnerOrganisationId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: { model: 'partner_organisations', key: 'id' }
  },
  title: { type: DataTypes.STRING(160), allowNull: false },
  publicTitle: { type: DataTypes.STRING(160), allowNull: true, comment: 'Consumer-facing name; falls back to title' },
  internalRef: { type: DataTypes.STRING(64), allowNull: true },
  description: { type: DataTypes.TEXT, allowNull: true },
  category: { type: DataTypes.STRING(64), allowNull: true },
  rewardType: {
    type: DataTypes.STRING(24),
    allowNull: false,
    defaultValue: 'free_service',
    comment: 'REWARD_TYPES in services/redeemOps/constants.js'
  },
  retailValue: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
  fulfilmentCost: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
  currency: { type: DataTypes.STRING(3), allowNull: false, defaultValue: 'SGD' },
  fundingSource: { type: DataTypes.STRING(24), allowNull: false, defaultValue: 'partner', comment: 'partner|mktr|shared' },

  committedQuantity: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  allocatedQuantity: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  issuedQuantity: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  redeemedQuantity: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },

  validityStart: { type: DataTypes.DATE, allowNull: true },
  validityEnd: { type: DataTypes.DATE, allowNull: true },
  claimExpiryDays: { type: DataTypes.INTEGER, allowNull: true, comment: 'Reservation window: attend the review within N days' },
  redemptionExpiryDays: { type: DataTypes.INTEGER, allowNull: true, comment: 'Redeem-at-partner window, from unlock' },

  fulfilmentMethod: {
    type: DataTypes.STRING(24),
    allowNull: false,
    defaultValue: 'partner_verification',
    comment: 'unique_code|qr|partner_verification|manual_booking|external_link|physical_voucher'
  },
  externalBookingUrl: { type: DataTypes.STRING(255), allowNull: true },
  status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'draft', comment: 'draft|active|paused|ended' },
  currentTermsVersion: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  createdBy: { type: DataTypes.UUID, allowNull: false, references: { model: 'users', key: 'id' } }
}, {
  tableName: 'reward_offers',
  indexes: [
    { fields: ['partnerOrganisationId', 'status'], name: 'idx_ro_partner_status' }
  ]
});

export default RewardOffer;
