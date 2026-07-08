import { DataTypes } from 'sequelize';
import { sequelize } from '../database/connection.js';

/** Versioned reward terms (docs/redeem-ops/ERD.md §3.12) — append-only. */
const RewardTermsVersion = sequelize.define('RewardTermsVersion', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  rewardOfferId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: { model: 'reward_offers', key: 'id' }
  },
  version: { type: DataTypes.INTEGER, allowNull: false },
  structured: {
    type: DataTypes.JSONB,
    allowNull: false,
    defaultValue: {},
    comment: 'Open shape: {firstTimeOnly, minAge, appointmentRequired, validDays[], …} — never boolean-per-condition'
  },
  freeText: { type: DataTypes.TEXT, allowNull: true },
  createdBy: { type: DataTypes.UUID, allowNull: false, references: { model: 'users', key: 'id' } }
}, {
  tableName: 'reward_terms_versions',
  timestamps: true,
  updatedAt: false,
  indexes: [
    { unique: true, fields: ['rewardOfferId', 'version'], name: 'uq_rtv_offer_version' }
  ]
});

export default RewardTermsVersion;
