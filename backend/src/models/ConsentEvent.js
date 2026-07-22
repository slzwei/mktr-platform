import { DataTypes } from 'sequelize';
import { sequelize } from '../database/connection.js';

/**
 * APPEND-ONLY person-level consent evidence (PR B, plan §3.1).
 *
 * One row = one consent ACT: a signup checkbox (including an explicit UNTICK
 * of the default-on contact box — that denial is evidence too), a server-built
 * evidence block (third_party/dnc_override/draw_terms), an unsubscribe, an
 * admin/erasure act. Never UPDATE or DELETE rows — state is derived
 * latest-wins per (kind, campaignId-or-global) by consentService.
 *
 * Purpose scoping: the live consent copy is campaign-scoped on both capture
 * surfaces, so `campaignId` is semantic; campaignId NULL = an explicitly
 * GLOBAL act (unsubscribe/erasure). Cross-campaign marketing has NO basis
 * until a global opt-in surface ships (Phase 2) — resist "fixing" reads.
 *
 * `verified` = the signup carried a live OTP stamp; only verified grants can
 * ever mint marketing authority (canMarketTo).
 */
const ConsentEvent = sequelize.define('ConsentEvent', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  consumerId: { type: DataTypes.UUID, allowNull: false, references: { model: 'consumers', key: 'id' } },
  prospectId: { type: DataTypes.UUID, allowNull: true, references: { model: 'prospects', key: 'id' } },
  campaignId: { type: DataTypes.UUID, allowNull: true, comment: 'Purpose scope; NULL = explicit global act' },
  kind: {
    type: DataTypes.STRING(32),
    allowNull: false,
    validate: { isIn: [['contact', 'campaign_terms', 'third_party', 'dnc_override', 'draw_terms']] },
  },
  granted: { type: DataTypes.BOOLEAN, allowNull: false },
  channels: { type: DataTypes.JSONB, allowNull: true, comment: "e.g. ['phone','whatsapp','email'] from the evidence builders" },
  version: { type: DataTypes.STRING(64), allowNull: false, comment: "Consent-copy version; 'legacy-backfill' for pre-evidence rows" },
  source: {
    type: DataTypes.STRING(32),
    allowNull: false,
    validate: { isIn: [['signup', 'backfill', 'unsubscribe', 'admin', 'erasure', 'resubscribe']] },
  },
  sourceUrl: { type: DataTypes.TEXT, allowNull: true },
  verified: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  actorUserId: { type: DataTypes.UUID, allowNull: true },
  metadata: { type: DataTypes.JSONB, allowNull: true, comment: 'e.g. dncTransactionId, termsVersionId' },
  occurredAt: { type: DataTypes.DATE, allowNull: false },
}, {
  tableName: 'consent_events',
  indexes: [
    { fields: ['consumerId', 'kind', 'occurredAt'], name: 'idx_ce_consumer_kind_time' },
    { fields: ['prospectId'], name: 'idx_ce_prospect' },
    // Backfill idempotency — mirrored because test boot syncs from models
    // (the migration-index-loss lesson, proven in consumerSpine.test.js).
    {
      unique: true,
      fields: ['prospectId', 'kind'],
      name: 'uq_ce_backfill',
      where: { source: 'backfill' },
    },
  ],
});

export default ConsentEvent;
