import { DataTypes, Op } from 'sequelize';
import { sequelize } from '../database/connection.js';

/**
 * One frozen draw entry (docs/plans/lucky-draw-10x.md §4.3). Snapshotted at
 * freeze from the verified prospect pool; immutable thereafter except for the
 * seal step writing chances/boost evidence.
 *
 * PII posture: only masked/derived identity is copied (phoneHash + last4 +
 * "First L." display name) — winner CONTACT uses the live prospect row. If the
 * prospect is erased before the pick, prospectId goes NULL and the entry is
 * skipped as ineligible (recorded on the next attempt), never silently
 * re-weighted.
 */
const DrawEntry = sequelize.define('DrawEntry', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  drawId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: { model: 'draws', key: 'id' }
  },
  prospectId: {
    type: DataTypes.UUID,
    allowNull: true,
    references: { model: 'prospects', key: 'id' },
    comment: 'SET NULL on prospect deletion/erasure — entry survives, becomes unpickable'
  },
  phoneHash: { type: DataTypes.STRING(64), allowNull: false, comment: 'sha256 of the E.164 phone at freeze' },
  phoneLast4: { type: DataTypes.STRING(4), allowNull: true },
  displayName: { type: DataTypes.STRING(120), allowNull: true, comment: 'Pre-masked "First L." — safe to publish' },
  chances: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
  verifiedAtFreeze: { type: DataTypes.DATE, allowNull: true, comment: 'Copy of sourceMetadata.phoneVerifiedAt evidence' },
  boostVia: { type: DataTypes.STRING(16), allowNull: true, comment: 'agent_scan|agent_button — how the ×N was earned (button ⇒ an approved review exists)' },
  boostEventId: {
    type: DataTypes.UUID,
    allowNull: true,
    references: { model: 'redemption_events', key: 'id' },
    comment: 'The append-only unlocked event backing the boost'
  }
}, {
  tableName: 'draw_entries',
  timestamps: true,
  updatedAt: false,
  indexes: [
    { fields: ['drawId'], name: 'idx_de_draw' },
    // Partial (erasure sets prospectId NULL) — defined here AND in migration
    // 059 so sync()-built schemas enforce it too.
    {
      unique: true,
      fields: ['drawId', 'prospectId'],
      name: 'uq_de_draw_prospect',
      where: { prospectId: { [Op.ne]: null } }
    }
  ]
});

export default DrawEntry;
