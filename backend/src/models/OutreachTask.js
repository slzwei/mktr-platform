import { DataTypes, Op } from 'sequelize';
import { sequelize } from '../database/connection.js';

/** Structured follow-up/task (docs/redeem-ops/ERD.md §3.7) — never just a note. */
const OutreachTask = sequelize.define('OutreachTask', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  title: { type: DataTypes.STRING(160), allowNull: false },
  partnerOrganisationId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: { model: 'partner_organisations', key: 'id' }
  },
  contactId: { type: DataTypes.UUID, allowNull: true, references: { model: 'partner_contacts', key: 'id' } },
  assigneeUserId: { type: DataTypes.UUID, allowNull: false, references: { model: 'users', key: 'id' } },
  createdBy: { type: DataTypes.UUID, allowNull: false, references: { model: 'users', key: 'id' } },
  dueAt: { type: DataTypes.DATE, allowNull: false },
  hasTime: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, comment: 'false = date-only rendering' },
  priority: { type: DataTypes.STRING(12), allowNull: false, defaultValue: 'medium', comment: 'low|medium|high' },
  type: { type: DataTypes.STRING(24), allowNull: false, defaultValue: 'follow_up', comment: 'follow_up|call|meeting|proposal|admin|other' },
  status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'open', comment: 'open|in_progress|completed|cancelled' },
  description: { type: DataTypes.TEXT, allowNull: true },
  completedAt: { type: DataTypes.DATE, allowNull: true },
  completedBy: { type: DataTypes.UUID, allowNull: true }
}, {
  tableName: 'outreach_tasks',
  indexes: [
    { fields: ['assigneeUserId', 'status', 'dueAt'], name: 'idx_ot_assignee_status_due' },
    { fields: ['partnerOrganisationId', 'status'], name: 'idx_ot_partner_status' },
    { fields: ['dueAt'], name: 'idx_ot_due_open', where: { status: { [Op.in]: ['open', 'in_progress'] } } }
  ]
});

export default OutreachTask;
