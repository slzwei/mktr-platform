import { DataTypes } from 'sequelize';
import { sequelize } from '../database/connection.js';

/** Templated onboarding checklist item (docs/redeem-ops/ERD.md §3.10, brief §22). */
const PartnerOnboardingItem = sequelize.define('PartnerOnboardingItem', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  partnerOrganisationId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: { model: 'partner_organisations', key: 'id' }
  },
  itemKey: { type: DataTypes.STRING(48), allowNull: false },
  label: { type: DataTypes.STRING(160), allowNull: false },
  sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'pending', comment: 'pending|in_progress|done|na' },
  assigneeUserId: { type: DataTypes.UUID, allowNull: true, references: { model: 'users', key: 'id' } },
  completedAt: { type: DataTypes.DATE, allowNull: true },
  notes: { type: DataTypes.TEXT, allowNull: true }
}, {
  tableName: 'partner_onboarding_items',
  indexes: [
    { unique: true, fields: ['partnerOrganisationId', 'itemKey'], name: 'uq_poi_partner_key' }
  ]
});

export default PartnerOnboardingItem;
