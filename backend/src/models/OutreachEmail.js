import { DataTypes, Op } from 'sequelize';
import { sequelize } from '../database/connection.js';

/**
 * The auto-send outbox (plan §3) — webhook_deliveries' durable-retry shape:
 * queued|needs_approval → (atomic claim) sending → sent|failed|cancelled.
 * Routing + idempotency ONLY: what actually sends is read from the TASK at
 * send time; sentSubject/sentBody are the post-send record. One live row per
 * task (partial unique). wireMessageId is the REAL on-the-wire Message-ID
 * fetched after send (plan F4 — minted IDs are presumed rewritten).
 */
const OutreachEmail = sequelize.define('OutreachEmail', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  taskId: { type: DataTypes.UUID, allowNull: false, references: { model: 'outreach_tasks', key: 'id' } },
  cadenceEnrollmentId: { type: DataTypes.UUID, allowNull: false, references: { model: 'outreach_cadence_enrollments', key: 'id' } },
  partnerOrganisationId: { type: DataTypes.UUID, allowNull: false, references: { model: 'partner_organisations', key: 'id' } },
  contactId: { type: DataTypes.UUID, allowNull: true },
  personaId: { type: DataTypes.UUID, allowNull: true, references: { model: 'outreach_personas', key: 'id' } },
  accountId: { type: DataTypes.UUID, allowNull: true, references: { model: 'outreach_accounts', key: 'id' } },
  toAddress: { type: DataTypes.STRING(160), allowNull: false },
  status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'queued', comment: 'queued|needs_approval|sending|sent|failed|cancelled' },
  attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  nextAttemptAt: { type: DataTypes.DATE, allowNull: true },
  approvedBy: { type: DataTypes.UUID, allowNull: true },
  approvedAt: { type: DataTypes.DATE, allowNull: true },
  holdReason: { type: DataTypes.STRING(64), allowNull: true, comment: 'why needs_approval: ramp|lint_<rule>' },
  wireMessageId: { type: DataTypes.STRING(320), allowNull: true },
  gmailMessageId: { type: DataTypes.STRING(32), allowNull: true },
  gmailThreadId: { type: DataTypes.STRING(32), allowNull: true },
  sentSubject: { type: DataTypes.STRING(220), allowNull: true },
  sentBody: { type: DataTypes.TEXT, allowNull: true },
  lastError: { type: DataTypes.TEXT, allowNull: true },
  sentAt: { type: DataTypes.DATE, allowNull: true },
}, {
  tableName: 'outreach_emails',
  indexes: [
    { fields: ['taskId'], unique: true, name: 'uq_oe_live_task', where: { status: { [Op.in]: ['queued', 'needs_approval', 'sending'] } } },
    { fields: ['status', 'nextAttemptAt'], name: 'idx_oe_status_next' },
  ],
});

export default OutreachEmail;
