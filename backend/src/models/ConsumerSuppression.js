import { DataTypes } from 'sequelize';
import { sequelize } from '../database/connection.js';

/**
 * The consumer exit door (PR B, plan §3.1) — deliberately SEPARATE from the
 * partner-side OutreachSuppression.
 *
 * Semantics (enforced by consentService, not here):
 *  - reason 'erasure' blocks EVERY send including transactional (PR C writes it);
 *  - every other reason blocks MARKETING only — voucher/pass delivery for a
 *    reward the person claimed keeps flowing (service communication);
 *  - channel 'all' covers every channel; channel rows allow future granularity
 *    (the unsubscribe endpoint writes 'all' in v1).
 */
const ConsumerSuppression = sequelize.define('ConsumerSuppression', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  consumerId: { type: DataTypes.UUID, allowNull: false, references: { model: 'consumers', key: 'id' } },
  channel: {
    type: DataTypes.STRING(16),
    allowNull: false,
    defaultValue: 'all',
    validate: { isIn: [['all', 'email', 'whatsapp', 'sms', 'voice']] },
  },
  reason: {
    type: DataTypes.STRING(32),
    allowNull: false,
    validate: { isIn: [['unsubscribe', 'complaint', 'admin', 'erasure']] },
  },
  source: { type: DataTypes.STRING(255), allowNull: true, comment: 'breadcrumb: unsubscribe_link, admin ui, …' },
  actorUserId: { type: DataTypes.UUID, allowNull: true },
}, {
  tableName: 'consumer_suppressions',
  indexes: [
    // Mirrored on the model (sync-built test schemas).
    { unique: true, fields: ['consumerId', 'channel'], name: 'uq_cs_consumer_channel' },
  ],
});

export default ConsumerSuppression;
