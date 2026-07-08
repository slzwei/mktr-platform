import { DataTypes } from 'sequelize';
import { sequelize } from '../database/connection.js';

/** Append-only pipeline-stage history (docs/redeem-ops/ERD.md §3.5). */
const PartnerStageEvent = sequelize.define('PartnerStageEvent', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  partnerOrganisationId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: { model: 'partner_organisations', key: 'id' }
  },
  fromStage: { type: DataTypes.STRING(32), allowNull: true },
  toStage: { type: DataTypes.STRING(32), allowNull: false },
  actorUserId: { type: DataTypes.UUID, allowNull: true, references: { model: 'users', key: 'id' } },
  reason: { type: DataTypes.STRING(255), allowNull: true }
}, {
  tableName: 'partner_stage_events',
  timestamps: true,
  updatedAt: false,
  indexes: [
    { fields: ['partnerOrganisationId', 'createdAt'], name: 'idx_pse_partner_created' }
  ]
});

export default PartnerStageEvent;
