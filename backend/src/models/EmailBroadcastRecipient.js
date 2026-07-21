import { DataTypes } from 'sequelize';
import { sequelize } from '../database/connection.js';

/**
 * Per-recipient send log AND at-most-once claim for an email broadcast
 * (tracker "emailpush"). The unique (broadcastId, consumerId) pair is the
 * double-send fence; the pending→attempting CAS marks the transport attempt
 * BEFORE SMTP so a crash in the gap leaves an `attempting` row that resume
 * marks failed/ambiguous_crash and NEVER retries (at-most-once, chosen
 * deliberately: a missed marketing mail is recoverable, a double send isn't).
 *
 * Erasure contract (erasureService matrix): `email` and `error` are CONTENT
 * about the person and get nulled; status/reason/sentAt are delivery facts on
 * the retained skeleton and stay (same stance as redemptions/commissions).
 */
export const EMAIL_RECIPIENT_STATUSES = ['pending', 'attempting', 'sent', 'skipped', 'failed'];

/** Skip/fail vocabulary: consent-gate codes verbatim + sender-side codes. */
export const EMAIL_RECIPIENT_REASONS = [
  'erased', 'suppressed', 'not_consented', 'not_verified', 'not_found',
  'missing_email', 'duplicate_email', 'address_suppressed',
  'unsub_token_error', 'send_error', 'ambiguous_crash', 'cancelled',
];

const EmailBroadcastRecipient = sequelize.define('EmailBroadcastRecipient', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  broadcastId: { type: DataTypes.UUID, allowNull: false, references: { model: 'email_broadcasts', key: 'id' } },
  consumerId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: { model: 'consumers', key: 'id' },
    comment: 'Erasure keeps an anonymized consumer husk, so this FK never dangles'
  },
  email: { type: DataTypes.STRING(320), allowNull: true, comment: 'Address actually attempted (refreshed at send time); nulled by erasure' },
  status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'pending' },
  reason: { type: DataTypes.STRING(64), allowNull: true },
  error: { type: DataTypes.TEXT, allowNull: true, comment: 'Transport error message; nulled by erasure' },
  sentAt: { type: DataTypes.DATE, allowNull: true },
}, {
  tableName: 'email_broadcast_recipients',
  indexes: [
    // Mirrored on the model (sync({force:true}) test boot — Cohort.js lesson).
    { unique: true, fields: ['broadcastId', 'consumerId'], name: 'uq_ebr_broadcast_consumer' },
    { fields: ['broadcastId', 'status'], name: 'idx_ebr_broadcast_status' },
  ]
});

export default EmailBroadcastRecipient;
