import { DataTypes } from 'sequelize';
import { sequelize } from '../database/connection.js';

/**
 * Outreach touchpoint on a partner (docs/redeem-ops/ERD.md §3.6). No destructive
 * delete — corrections update in place (audited before/after via auditService) and
 * removals set voidedAt. "Meaningful" types (everything except internal_note) bump
 * the partner's lastActivityAt and stamp firstOutreachAt (partnerService.logActivity).
 */
const OutreachActivity = sequelize.define('OutreachActivity', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  partnerOrganisationId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: { model: 'partner_organisations', key: 'id' }
  },
  contactId: { type: DataTypes.UUID, allowNull: true, references: { model: 'partner_contacts', key: 'id' } },
  type: { type: DataTypes.STRING(32), allowNull: false, comment: 'ACTIVITY_TYPES in services/redeemOps/constants.js' },
  direction: { type: DataTypes.STRING(12), allowNull: false, defaultValue: 'outbound', comment: 'outbound|inbound|internal' },
  summary: { type: DataTypes.STRING(255), allowNull: false },
  details: { type: DataTypes.TEXT, allowNull: true },
  outcome: { type: DataTypes.STRING(64), allowNull: true },
  occurredAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  actorUserId: { type: DataTypes.UUID, allowNull: true, references: { model: 'users', key: 'id' } },
  editedAt: { type: DataTypes.DATE, allowNull: true },
  editedBy: { type: DataTypes.UUID, allowNull: true },
  voidedAt: { type: DataTypes.DATE, allowNull: true },
  voidReason: { type: DataTypes.STRING(255), allowNull: true }
}, {
  tableName: 'outreach_activities',
  indexes: [
    { fields: ['partnerOrganisationId', 'occurredAt'], name: 'idx_oa_partner_occurred' },
    { fields: ['actorUserId', 'occurredAt'], name: 'idx_oa_actor_occurred' }
  ]
});

export default OutreachActivity;
