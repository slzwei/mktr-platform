import { DataTypes } from 'sequelize';
import { sequelize } from '../database/connection.js';

/**
 * Meta instant form → delivery routing
 * (docs/plans/meta-lead-ads-native-pipe.md §3.2).
 *
 * campaignId decides the ring (funded package agents / quota). qrTagId is the
 * optional direct-to-agent route: v1 accepts ONLY QRs with a direct
 * assignedAgentId/ownerUserId on the same campaign (group/phone QR variants
 * live in the web funnel's pre-resolver and are rejected at CRUD time rather
 * than silently misrouting). Leads for forms with no active mapping fall to
 * the [Meta] Unmapped held pool — never the System Agent.
 */
const MetaFormMapping = sequelize.define('MetaFormMapping', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  formId: { type: DataTypes.STRING(64), allowNull: false, comment: 'Meta leadgen form id' },
  formName: { type: DataTypes.STRING(160), allowNull: true },
  campaignId: { type: DataTypes.UUID, allowNull: false, references: { model: 'campaigns', key: 'id' } },
  qrTagId: { type: DataTypes.UUID, allowNull: true, references: { model: 'qr_tags', key: 'id' } },
  isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
}, {
  tableName: 'meta_form_mappings',
  indexes: [
    { unique: true, fields: ['formId'], name: 'uq_meta_form_mappings_form_id' },
    { fields: ['campaignId'], name: 'idx_mfm_campaign' },
  ],
});

export default MetaFormMapping;
