import { DataTypes } from 'sequelize';
import { sequelize } from '../database/connection.js';

/**
 * A completed redemption (docs/redeem-ops/ERD.md §3.17). UNIQUE entitlementId =
 * double redemption impossible at the schema level. Reversal is TERMINAL for
 * the entitlement — re-fulfilment means cancelling and manually issuing a new
 * entitlement (documented escape hatch: partial unique over active states).
 */
const Redemption = sequelize.define('Redemption', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  entitlementId: {
    type: DataTypes.UUID,
    allowNull: false,
    unique: true,
    references: { model: 'reward_entitlements', key: 'id' }
  },
  rewardOfferId: { type: DataTypes.UUID, allowNull: false, references: { model: 'reward_offers', key: 'id' } },
  activationId: { type: DataTypes.UUID, allowNull: false, references: { model: 'activations', key: 'id' } },
  partnerOrganisationId: { type: DataTypes.UUID, allowNull: false, references: { model: 'partner_organisations', key: 'id' } },
  locationId: { type: DataTypes.UUID, allowNull: true, references: { model: 'partner_locations', key: 'id' } },
  redeemedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  method: { type: DataTypes.STRING(24), allowNull: false, defaultValue: 'code', comment: 'code|qr|partner_verification|manual_override' },
  status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'completed', comment: 'completed|reversed|flagged' },
  actorType: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'staff' },
  actorUserId: { type: DataTypes.UUID, allowNull: true, references: { model: 'users', key: 'id' } },
  notes: { type: DataTypes.TEXT, allowNull: true }
}, {
  tableName: 'redemptions',
  indexes: [
    { fields: ['partnerOrganisationId', 'redeemedAt'], name: 'idx_red_partner_redeemed' }
  ]
});

export default Redemption;
