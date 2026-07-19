import { DataTypes, Op } from 'sequelize';
import { sequelize } from '../database/connection.js';

/**
 * The durable cross-campaign person (docs/plans/consumer-spine-and-consent-ledger.md).
 *
 * Identity key = E.164 phone; prospects stay one-row-per-campaign-signup and
 * FK here via `consumerId`. This table is a REBUILDABLE PROJECTION of
 * prospects: the capture resolver writes it best-effort behind a savepoint and
 * reconcileConsumerSpine() (migration 079 / scripts/rebuild-consumer-spine.js)
 * re-derives every row, so drift is always repairable — never trust a counter
 * over a recompute.
 *
 * call_bot (Retell) prospects are deliberately NOT linked: prospect.phone is
 * the call's to_number, which for inbound calls is MKTR's own DDI
 * (retellService.js §DNC note) — linking would merge strangers.
 *
 * `unsubTokenHash`/`erasedAt` land dark here (PR A) for the consent-ledger and
 * erasure PRs — nothing reads them yet.
 */
const Consumer = sequelize.define('Consumer', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  phone: {
    type: DataTypes.STRING(20),
    allowNull: true, // null only after erasure (PR C); live rows always have one
    validate: { is: /^\+[1-9]\d{9,14}$/ },
    comment: 'E.164 identity key — one live consumer per phone (uq_consumers_phone)'
  },
  phoneHash: {
    type: DataTypes.STRING(64),
    allowNull: true, // nulled together with phone on PR-C erasure — no tombstone
    comment: 'sha256 hex of the E.164 phone (same recipe as sourceMetadata.phoneVerifiedFor)'
  },
  firstName: { type: DataTypes.STRING, allowNull: true },
  lastName: { type: DataTypes.STRING, allowNull: true },
  email: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: 'Latest real (non-synthetic) email seen — an attribute, never an identity key'
  },
  firstSeenAt: { type: DataTypes.DATE, allowNull: false },
  lastSeenAt: { type: DataTypes.DATE, allowNull: false },
  signupCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  verifiedSignupCount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    comment: 'Signups carrying a live-at-capture OTP stamp — only these can ever mint marketing authority (PR B)'
  },
  unsubTokenHash: { type: DataTypes.STRING(64), allowNull: true, comment: 'PR B: sha256 of the opaque unsubscribe token' },
  erasedAt: { type: DataTypes.DATE, allowNull: true, comment: 'PR C: PDPA erasure timestamp' },
}, {
  tableName: 'consumers',
  indexes: [
    // Mirrored on the model because test boot builds schema via
    // sync({force:true}) BEFORE migrations (bootstrap.js) — a migration-only
    // index would silently vanish there (the Prospect (campaignId,phone)
    // lesson; see RewardEntitlement.js for the same pattern).
    { unique: true, fields: ['phone'], name: 'uq_consumers_phone', where: { phone: { [Op.ne]: null } } },
    { fields: ['phoneHash'], name: 'idx_consumers_phone_hash' },
    { fields: ['lastSeenAt'], name: 'idx_consumers_last_seen' },
  ]
});

export default Consumer;
