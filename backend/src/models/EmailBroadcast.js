import { DataTypes } from 'sequelize';
import { sequelize } from '../database/connection.js';

/**
 * An email broadcast push (tracker "emailpush",
 * docs/plans/email-broadcast-push.md): admin-composed subject/body/CTA about
 * ONE campaign, aimed at ONE saved cohort.
 *
 * Lifecycle (every transition a conditional UPDATE — CAS, no two processes
 * can both win one):
 *   draft → preparing → sending → completed
 *   preparing/sending → cancelling → cancelled;  crash → interrupted (boot
 *   sweep / stale heartbeat);  loop error → failed.
 *
 * The send-context snapshot (definitionSnapshot/hostChoice/emailContext/
 * ctaUrl) is frozen at `preparing` — the worker and any resume read ONLY the
 * snapshot, so cohort edits or config drift can never change what an
 * in-flight broadcast sends. `completed` means the worker finished; the
 * OUTCOME (all sent / partial / nothing) is derived from counts — delivery
 * beyond SMTP acceptance is never claimed.
 */
export const EMAIL_BROADCAST_STATUSES = [
  'draft', 'preparing', 'sending', 'cancelling',
  'completed', 'interrupted', 'failed', 'cancelled',
];

const EmailBroadcast = sequelize.define('EmailBroadcast', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  cohortId: { type: DataTypes.UUID, allowNull: false, references: { model: 'cohorts', key: 'id' } },
  campaignId: {
    type: DataTypes.UUID,
    allowNull: true,
    references: { model: 'campaigns', key: 'id' },
    comment: 'The campaign the email is ABOUT — gate scope + CTA target. SET NULL survives campaign hard-delete; a null campaign fails resume preflight.'
  },
  subject: { type: DataTypes.STRING(200), allowNull: false },
  bodyText: { type: DataTypes.TEXT, allowNull: false },
  ctaLabel: { type: DataTypes.STRING(80), allowNull: false, defaultValue: 'Learn more' },
  definitionSnapshot: {
    type: DataTypes.JSONB,
    allowNull: true,
    comment: 'Normalized cohort definition with marketingContext.campaignId overridden to campaignId, frozen at preparing'
  },
  hostChoice: { type: DataTypes.STRING(8), allowNull: true, comment: "'redeem'|'mktr' — clamped customer-host enum at preparing" },
  emailContext: { type: DataTypes.STRING(8), allowNull: true, comment: "mailer from-context ('redeem'|'mktr') at preparing" },
  ctaUrl: { type: DataTypes.TEXT, allowNull: true, comment: 'Frozen CTA link incl. utm — what actually went out' },
  status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'draft' },
  totalRecipients: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  sentCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  skippedCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  failedCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  workerHeartbeatAt: { type: DataTypes.DATE, allowNull: true, comment: 'Worker liveness; stale ≥120s ⇒ resumable/boot-sweepable' },
  startedAt: { type: DataTypes.DATE, allowNull: true },
  completedAt: { type: DataTypes.DATE, allowNull: true },
  lastError: { type: DataTypes.TEXT, allowNull: true },
  createdBy: { type: DataTypes.UUID, allowNull: true, references: { model: 'users', key: 'id' } },
}, {
  tableName: 'email_broadcasts',
  indexes: [
    // Mirrored on the model because test boot builds schema via
    // sync({force:true}) BEFORE migrations (the Cohort.js lesson).
    { fields: ['status', 'createdAt'], name: 'idx_eb_status_created' },
  ]
});

export default EmailBroadcast;
