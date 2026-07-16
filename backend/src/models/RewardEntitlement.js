import { DataTypes, Op } from 'sequelize';
import { sequelize } from '../database/connection.js';

/**
 * A specific consumer/lead's right to a reward (docs/redeem-ops/ERD.md §3.16).
 *
 * Lifecycle: eligible (reserved/locked — inventory held, NO voucher exists) →
 * issued (unlocked at the consultant meeting — voucher token minted) →
 * redeemed | expired | cancelled.
 *
 * Two tokens, one consumer link: presentationTokenHash is the reservation-pass
 * QR shown to the CONSULTANT (salon verify rejects it); tokenHash is the
 * redemption voucher, minted only at unlock. Raw tokens are random 32-byte
 * base64url, SHA-256 at rest, returned once.
 */
const RewardEntitlement = sequelize.define('RewardEntitlement', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  rewardOfferId: { type: DataTypes.UUID, allowNull: false, references: { model: 'reward_offers', key: 'id' } },
  activationId: { type: DataTypes.UUID, allowNull: false, references: { model: 'activations', key: 'id' } },
  prospectId: {
    type: DataTypes.UUID,
    allowNull: true,
    references: { model: 'prospects', key: 'id' },
    comment: 'Canonical MKTR lead reference — SET NULL on lead delete; entitlement survives PII removal'
  },
  status: {
    type: DataTypes.STRING(16),
    allowNull: false,
    defaultValue: 'eligible',
    comment: 'eligible(reserved/locked)|issued(unlocked)|redeemed|expired|cancelled|blocked'
  },
  reservedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  unlockedAt: { type: DataTypes.DATE, allowNull: true },
  unlockedByUserId: { type: DataTypes.UUID, allowNull: true, references: { model: 'users', key: 'id' } },
  unlockedVia: { type: DataTypes.STRING(16), allowNull: true, comment: 'agent_scan|agent_button|auto_on_capture|manual' },
  expiresAt: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: 'State-dependent: reservation window while eligible; re-stamped to the redemption window at unlock'
  },
  presentationTokenHash: { type: DataTypes.STRING(64), allowNull: false, comment: 'SHA-256 of the reservation-pass token (meeting QR)' },
  tokenHash: { type: DataTypes.STRING(64), allowNull: true, comment: 'SHA-256 of the redemption voucher token — minted at unlock' },
  tokenHint: { type: DataTypes.STRING(8), allowNull: true, comment: 'Last 4 of the voucher code, for support' },
  issuedVia: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'hook', comment: 'hook|sweep|manual' },
  phoneKey: {
    type: DataTypes.STRING(20),
    allowNull: true,
    comment: 'Digits-only holder phone at issuance — anti-farming dedupe key (one live reward per phone per activation)'
  },
  createdBy: { type: DataTypes.UUID, allowNull: true }
}, {
  tableName: 'reward_entitlements',
  indexes: [
    // Idempotency anchor for hook+sweep issuance — partial because deleted
    // prospects SET-NULL and Postgres treats NULLs as distinct (ERD.md §3.16)
    { unique: true, fields: ['activationId', 'prospectId'], name: 'uq_re_activation_prospect', where: { prospectId: { [Op.ne]: null } } },
    // Anti-farming (migration 075): one LIVE reward per phone per activation —
    // expired/cancelled rows leave the partial set and free the slot. Mirrored
    // here because test mode builds schema from models via sync({force:true}).
    {
      unique: true,
      fields: ['activationId', 'phoneKey'],
      name: 'uq_re_activation_phone',
      where: { phoneKey: { [Op.ne]: null }, status: { [Op.in]: ['eligible', 'issued', 'redeemed'] } }
    },
    { unique: true, fields: ['presentationTokenHash'], name: 'uq_re_presentation_token' },
    { unique: true, fields: ['tokenHash'], name: 'uq_re_voucher_token', where: { tokenHash: { [Op.ne]: null } } },
    { fields: ['activationId', 'status'], name: 'idx_re_activation_status' },
    { fields: ['prospectId'], name: 'idx_re_prospect' },
    { fields: ['expiresAt'], name: 'idx_re_expiry_eligible', where: { status: 'eligible' } }
  ]
});

export default RewardEntitlement;
