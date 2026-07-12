import { DataTypes } from 'sequelize';
import { sequelize } from '../database/connection.js';

/**
 * One witnessed pick (docs/plans/lucky-draw-10x.md §4.3) — the initial draw is
 * attempt 1; every redraw (unclaimed/unreachable/ineligible/declined) is a
 * further attempt excluding ALL previously picked entries.
 *
 * Commit/reveal: the pool (poolHash on the draw) is sealed FIRST; the seed is
 * generated at the witnessed pick and recorded here after. Reproducibility:
 * totalChances + eligibleHash pin the exact eligible set the seed was applied
 * to, so `verify` re-derives the same pickedEntryId — and can DETECT (not
 * silently absorb) any post-attempt erasure that changed the set.
 */
const DrawAttempt = sequelize.define('DrawAttempt', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  drawId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: { model: 'draws', key: 'id' }
  },
  attemptNo: { type: DataTypes.INTEGER, allowNull: false },
  seed: { type: DataTypes.STRING(64), allowNull: false, comment: '32 random bytes hex, minted at the witnessed pick' },
  totalChances: { type: DataTypes.INTEGER, allowNull: false },
  eligibleHash: {
    type: DataTypes.STRING(64),
    allowNull: false,
    comment: 'sha256 over the ordered eligible (entryId|chances) pairs this seed was applied to'
  },
  pickedEntryId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: { model: 'draw_entries', key: 'id' }
  },
  reason: {
    type: DataTypes.STRING(16),
    allowNull: false,
    defaultValue: 'initial',
    comment: 'Why this attempt ran: initial|unclaimed|unreachable|ineligible|declined (= prior attempt outcome)'
  },
  drawnAt: { type: DataTypes.DATE, allowNull: false },
  witnessedByUserId: { type: DataTypes.UUID, allowNull: true, references: { model: 'users', key: 'id' }, onDelete: 'SET NULL' },
  contactedAt: { type: DataTypes.DATE, allowNull: true },
  claimDeadline: { type: DataTypes.DATE, allowNull: true, comment: 'drawnAt + 14 days (the public /winners promise)' },
  claimedAt: { type: DataTypes.DATE, allowNull: true },
  outcome: {
    type: DataTypes.STRING(16),
    allowNull: false,
    defaultValue: 'pending',
    comment: 'pending|claimed|unclaimed|unreachable|ineligible|declined'
  }
}, {
  tableName: 'draw_attempts',
  timestamps: true,
  indexes: [
    { unique: true, fields: ['drawId', 'attemptNo'], name: 'uq_da_draw_attempt' }
  ]
});

export default DrawAttempt;
