import { DataTypes } from 'sequelize';
import { sequelize } from '../database/connection.js';

/** Participating outlets for a reward (docs/redeem-ops/ERD.md §3.13). */
const RewardOfferLocation = sequelize.define('RewardOfferLocation', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  rewardOfferId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: { model: 'reward_offers', key: 'id' }
  },
  partnerLocationId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: { model: 'partner_locations', key: 'id' }
  }
}, {
  tableName: 'reward_offer_locations',
  indexes: [
    { unique: true, fields: ['rewardOfferId', 'partnerLocationId'], name: 'uq_rol_offer_location' }
  ]
});

export default RewardOfferLocation;
