import { DataTypes, Op } from 'sequelize';
import { sequelize } from '../database/connection.js';

/**
 * A partner working through a cadence version (docs/plans/
 * redeem-ops-cadences.md §4.4). At most ONE live (active|paused) enrollment
 * per partner — enforced by the partial unique index.
 */
const OutreachCadenceEnrollment = sequelize.define('OutreachCadenceEnrollment', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  cadenceId: { type: DataTypes.UUID, allowNull: false, references: { model: 'outreach_cadences', key: 'id' } },
  partnerOrganisationId: { type: DataTypes.UUID, allowNull: false, references: { model: 'partner_organisations', key: 'id' } },
  state: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'active', comment: 'active|paused|completed|exited' },
  currentStepId: { type: DataTypes.UUID, allowNull: true, references: { model: 'outreach_cadence_steps', key: 'id' } },
  lastDisposition: { type: DataTypes.STRING(24), allowNull: true },
  exitReason: { type: DataTypes.STRING(32), allowNull: true },
  enrolledBy: { type: DataTypes.UUID, allowNull: false, references: { model: 'users', key: 'id' } },
  pausedAt: { type: DataTypes.DATE, allowNull: true },
  endedAt: { type: DataTypes.DATE, allowNull: true },
}, {
  tableName: 'outreach_cadence_enrollments',
  indexes: [
    { fields: ['partnerOrganisationId'], unique: true, name: 'uq_oce_live_partner', where: { state: { [Op.in]: ['active', 'paused'] } } },
    { fields: ['state', 'updatedAt'], name: 'idx_oce_state_updated' },
  ],
});

export default OutreachCadenceEnrollment;
