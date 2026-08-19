import { DataTypes } from 'sequelize';
import { sequelize } from '../database/connection.js';

/**
 * Durable Meta/TikTok conversion-delivery outbox row (migration 126,
 * ads-centralisation §3). One row = one (prospect, platform, eventKey)
 * delivery obligation. Row IN ANY STATE = ledger-owned (legacy direct
 * senders must not fire for that pair); no row = legacy-eligible.
 *
 * States: pending → sending → sent | retry_wait | config_blocked |
 * failed_permanent | expired | skipped. Terminal reasons live in errorCode.
 * All state transitions happen through platformDeliveryService's fenced
 * claim + claimToken CAS — never through plain model saves.
 */
const PlatformDelivery = sequelize.define('PlatformDelivery', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  prospectId: { type: DataTypes.UUID, allowNull: false },
  platform: { type: DataTypes.STRING(16), allowNull: false },
  eventKey: { type: DataTypes.STRING(32), allowNull: false },
  eventId: { type: DataTypes.STRING(64), allowNull: false },
  eventTime: { type: DataTypes.DATE, allowNull: false },
  dedupeAnchorAt: { type: DataTypes.DATE, allowNull: false },
  pixelId: { type: DataTypes.STRING(64), allowNull: true },
  state: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'pending' },
  sendAttempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  nextAttemptAt: { type: DataTypes.DATE, allowNull: true },
  claimedAt: { type: DataTypes.DATE, allowNull: true },
  claimToken: { type: DataTypes.UUID, allowNull: true },
  firstWireAt: { type: DataTypes.DATE, allowNull: true },
  lastAttemptAt: { type: DataTypes.DATE, allowNull: true },
  sentAt: { type: DataTypes.DATE, allowNull: true },
  lastStatus: { type: DataTypes.INTEGER, allowNull: true },
  errorCode: { type: DataTypes.STRING(64), allowNull: true },
  providerRequestId: { type: DataTypes.STRING(128), allowNull: true },
}, {
  tableName: 'platform_deliveries',
});

export default PlatformDelivery;
