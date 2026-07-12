import { DataTypes } from 'sequelize';
import { sequelize } from '../database/connection.js';

/**
 * Versioned lucky-draw T&Cs (docs/plans/lucky-draw-10x.md §4.6) — append-only,
 * mirroring RewardTermsVersion. A bare hash of the mutable
 * design_config.termsContent can only detect change; the version row stores
 * the canonical content so the historical terms are recoverable and each
 * entrant's consentMetadata.drawTerms can pin exactly what they accepted.
 */
const DrawTermsVersion = sequelize.define('DrawTermsVersion', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  campaignId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: { model: 'campaigns', key: 'id' }
  },
  version: { type: DataTypes.INTEGER, allowNull: false },
  content: {
    type: DataTypes.TEXT,
    allowNull: false,
    comment: 'Raw stored designer HTML (design_config.termsContent) at version time — the canonical bytes contentSha256 covers'
  },
  contentSha256: { type: DataTypes.STRING(64), allowNull: false },
  createdBy: { type: DataTypes.UUID, allowNull: false, references: { model: 'users', key: 'id' } }
}, {
  tableName: 'draw_terms_versions',
  timestamps: true,
  updatedAt: false,
  indexes: [
    { unique: true, fields: ['campaignId', 'version'], name: 'uq_dtv_campaign_version' },
    { fields: ['campaignId', 'contentSha256'], name: 'idx_dtv_campaign_hash' }
  ]
});

export default DrawTermsVersion;
