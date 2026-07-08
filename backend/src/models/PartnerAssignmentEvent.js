import { DataTypes } from 'sequelize';
import { sequelize } from '../database/connection.js';

/** Append-only ownership history (docs/redeem-ops/ERD.md §3.4). Never updated or deleted. */
const PartnerAssignmentEvent = sequelize.define('PartnerAssignmentEvent', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  partnerOrganisationId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: { model: 'partner_organisations', key: 'id' }
  },
  kind: { type: DataTypes.STRING(24), allowNull: false, comment: 'claim|assign|reassign|release|restrict|disqualify|merge' },
  fromUserId: { type: DataTypes.UUID, allowNull: true, references: { model: 'users', key: 'id' } },
  toUserId: { type: DataTypes.UUID, allowNull: true, references: { model: 'users', key: 'id' } },
  actorUserId: { type: DataTypes.UUID, allowNull: true, references: { model: 'users', key: 'id' } },
  reason: { type: DataTypes.STRING(255), allowNull: true }
}, {
  tableName: 'partner_assignment_events',
  timestamps: true,
  updatedAt: false,
  indexes: [
    { fields: ['partnerOrganisationId', 'createdAt'], name: 'idx_pae_partner_created' }
  ]
});

export default PartnerAssignmentEvent;
