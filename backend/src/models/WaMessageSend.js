import { DataTypes } from 'sequelize';
import { sequelize } from '../database/connection.js';

/**
 * WhatsApp message OWNERSHIP, stamped at send time (migration 096,
 * docs/plans/per-campaign-lead-scoring.md §5).
 *
 * The twin of WaMessageStatus: that table records what HAPPENED to a wamid
 * (Meta's frontier — sent < delivered < read, failed terminal); this one
 * records who it was FOR. Phase 3 scores a `read` as a response to one lead's
 * pitch, and the two facts only combine over a wamid join.
 *
 * IMMUTABLE BY CONTRACT. Every column is a snapshot of the send, not a live
 * pointer: rows are written once and never updated, so a later relink, a
 * campaign delete, or an owner move cannot retroactively re-attribute a
 * message that was already sent. That is the whole point — §5 rejected
 * derived ownership because derivation gives a DIFFERENT answer later.
 *
 * NO FOREIGN KEYS, for the same reason (see the migration).
 *
 * campaignId is NULLABLE, deviating from the plan's sketch. A lead can
 * legitimately carry no campaign at send time — the capture API treats
 * campaignId as optional (validation.js:219, passed through as
 * `campaignId || null` at prospectService.js:1066-1069) and a permanent
 * campaign delete nulls it on surviving prospects
 * (014-add-cascade-rules.js:87). NOT NULL would force the writer to drop the
 * ownership row exactly when a campaignless lead is messaged, which loses the
 * lead attribution (prospectId) to protect a snapshot that is only ever
 * supporting evidence. prospectId is the ownership; campaignId is what keeps
 * the row interpretable after the lead's own campaignId has moved on.
 */
const WaMessageSend = sequelize.define('WaMessageSend', {
  wamid: {
    type: DataTypes.STRING(128),
    primaryKey: true,
    comment: 'Meta message id — joins wa_message_statuses',
  },
  prospectId: {
    type: DataTypes.UUID,
    allowNull: false,
    comment: 'The lead this message was sent for — immutable, never derived',
  },
  campaignId: {
    type: DataTypes.UUID,
    allowNull: true,
    comment: "Campaign as of the send. NULL = the lead carried none; NOT a live lookup",
  },
  consumerId: {
    type: DataTypes.UUID,
    allowNull: true,
    comment: 'Person as of the send — the PDPA erasure key for this table',
  },
  kind: {
    type: DataTypes.STRING(24),
    allowNull: false,
    comment: 'pass | draw_pass | voucher | boost_receipt | screening_callback',
  },
  sentAt: { type: DataTypes.DATE, allowNull: false },
}, {
  tableName: 'wa_message_sends',
  timestamps: true,
  indexes: [
    { fields: ['prospectId'], name: 'idx_wa_sends_prospect' },
    { fields: ['consumerId'], name: 'idx_wa_sends_consumer' },
  ],
});

export default WaMessageSend;
