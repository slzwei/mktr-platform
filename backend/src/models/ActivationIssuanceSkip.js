import { DataTypes } from 'sequelize';
import { sequelize } from '../database/connection.js';

/**
 * One row per SKIPPED reward issuance (migration 076) — the funnel's
 * "why didn't they get a reward?" ledger. Written fire-and-forget from
 * entitlementService.issueForProspect (the single issuance choke point, so
 * hook, sweep and manual skips all land here); read as a last-24h reason
 * breakdown on the activation detail; purged after 30 days by the fulfilment
 * sweep. Plain UUID references by design — a skip must survive its subjects.
 */
const ActivationIssuanceSkip = sequelize.define('ActivationIssuanceSkip', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  campaignId: { type: DataTypes.UUID, allowNull: true },
  activationId: { type: DataTypes.UUID, allowNull: true },
  reason: {
    type: DataTypes.STRING(32),
    allowNull: false,
    comment: 'no_active_activation|activation_not_active|allocation_exhausted|offer_not_active|activation_ended|quarantined|phone_not_verified|no_phone|duplicate_phone'
  },
  via: { type: DataTypes.STRING(16), allowNull: true, comment: 'hook|sweep|manual' }
}, {
  tableName: 'activation_issuance_skips',
  timestamps: true,
  updatedAt: false,
  indexes: [
    { fields: ['activationId', 'createdAt'], name: 'idx_ais_activation_created' },
    { fields: ['campaignId', 'createdAt'], name: 'idx_ais_campaign_created' }
  ]
});

export default ActivationIssuanceSkip;
