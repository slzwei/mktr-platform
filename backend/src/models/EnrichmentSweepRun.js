import { DataTypes, Op } from 'sequelize';
import { sequelize } from '../database/connection.js';

/**
 * Nightly sweep fence + durable repair-scan cursor
 * (docs/plans/consumer-profile-enrichment.md §7.3, Codex R3 #9/#10).
 *
 * A FENCE, not a log: the partial unique on (runDateSgt) for
 * runType='nightly' AND status IN (running, done) means one live nightly
 * per SGT date — `done` ends the date, `failed` may retry within it.
 * Takeover of a `running` row is permitted only when heartbeatAt is stale
 * (> 30 min): the taker swaps in its own ownerToken, and every
 * stats/finalization update is ownerToken-fenced so a zombie can't clobber
 * its successor. Repair-scan progress lives in `cursor` with a fixed
 * row/wall-time budget per night, rotating through the population across
 * runs. Backfill runs use runType='backfill' (unfenced by date, separately
 * observable — plan §5).
 */
const EnrichmentSweepRun = sequelize.define('EnrichmentSweepRun', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  runDateSgt: { type: DataTypes.STRING(10), allowNull: false, comment: 'YYYY-MM-DD in Asia/Singapore' },
  runType: {
    type: DataTypes.STRING(12),
    allowNull: false,
    defaultValue: 'nightly',
    validate: { isIn: [['nightly', 'backfill']] }
  },
  status: {
    type: DataTypes.STRING(10),
    allowNull: false,
    validate: { isIn: [['running', 'done', 'failed']] }
  },
  ownerToken: { type: DataTypes.UUID, allowNull: false },
  heartbeatAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  finishedAt: { type: DataTypes.DATE, allowNull: true },
  stats: { type: DataTypes.JSONB, allowNull: true },
  cursor: { type: DataTypes.JSONB, allowNull: true }
}, {
  tableName: 'enrichment_sweep_runs',
  indexes: [
    {
      unique: true,
      fields: ['runDateSgt'],
      name: 'uq_esruns_nightly_date',
      where: { runType: 'nightly', status: { [Op.in]: ['running', 'done'] } }
    },
  ]
});

export default EnrichmentSweepRun;
