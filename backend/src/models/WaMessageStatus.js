import { DataTypes } from 'sequelize';
import { sequelize } from '../database/connection.js';

/**
 * Durable inbox for Meta WhatsApp status callbacks (migration 090,
 * docs/plans/wa-delivery-truth.md). One row per wamid, holding the FURTHEST
 * delivery state Meta has reported (sent < delivered < read; failed terminal)
 * — the webhook upserts with a rank guard in raw SQL so out-of-order and
 * cross-instance callbacks can never downgrade a row. Receipts join this at
 * read time via redemption_events metadata.messageId; receipt rows are never
 * mutated. recipientHash is the erasure key (sha256 of the E.164 recipient,
 * same recipe as consumers.phoneHash) — no raw phone is stored here.
 */
const WaMessageStatus = sequelize.define('WaMessageStatus', {
  wamid: { type: DataTypes.STRING(128), primaryKey: true },
  status: {
    type: DataTypes.STRING(16),
    allowNull: false,
    comment: 'sent|delivered|read|failed — rank-guarded, never downgraded',
  },
  errorCode: { type: DataTypes.STRING(16), allowNull: true },
  errorTitle: { type: DataTypes.STRING(200), allowNull: true },
  recipientHash: {
    type: DataTypes.STRING(64),
    allowNull: true,
    comment: 'sha256 hex of the E.164 recipient — PDPA erasure key, no raw phone',
  },
  occurredAt: { type: DataTypes.DATE, allowNull: true },
}, {
  tableName: 'wa_message_statuses',
  timestamps: true,
  indexes: [
    { fields: ['recipientHash'], name: 'idx_wms_recipient_hash' },
  ],
});

export default WaMessageStatus;
