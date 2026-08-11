import { DataTypes, Op } from 'sequelize';
import { sequelize } from '../database/connection.js';

/**
 * A sending alias (emily@redeem.sg) tied to the CRM rep it belongs to
 * (docs/plans/redeem-ops-cadence-email-autosend.md §3). Personas without a
 * rep never send; reps without a persona get manual tasks instead of a
 * borrowed identity. isAccountAlias records the plan-F2 parentage check:
 * the address must be an alias OF THE ACCOUNT ROW, or its replies land in
 * somebody else's mailbox.
 */
const OutreachPersona = sequelize.define('OutreachPersona', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  accountId: { type: DataTypes.UUID, allowNull: false, references: { model: 'outreach_accounts', key: 'id' } },
  address: { type: DataTypes.STRING(160), allowNull: false, unique: true },
  displayName: { type: DataTypes.STRING(120), allowNull: false },
  assignedUserId: { type: DataTypes.UUID, allowNull: true, references: { model: 'users', key: 'id' } },
  sendAsRegistered: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  sendAsVerified: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  isAccountAlias: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  dailySendCap: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 30 },
  sentToday: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  sentTodayDate: { type: DataTypes.STRING(10), allowNull: true },
  consecutiveFailures: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  lastError: { type: DataTypes.TEXT, allowNull: true },
  createdBy: { type: DataTypes.UUID, allowNull: true, references: { model: 'users', key: 'id' } },
}, {
  tableName: 'outreach_personas',
  indexes: [
    { fields: ['assignedUserId'], unique: true, name: 'uq_op_assigned_user', where: { assignedUserId: { [Op.ne]: null } } },
  ],
});

export default OutreachPersona;
