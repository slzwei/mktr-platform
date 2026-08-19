import { DataTypes } from 'sequelize';
import { sequelize } from '../database/connection.js';

/**
 * Durable erasure sweep marker for a session id (migration 127,
 * ads-centralisation §4.6). Upserted in the erasure transaction with
 * sweepUntil = now()+24h; the purge tick re-deletes that sid's touchpoints
 * (occurredAt <= sweepUntil, shared-session-guarded) under the same per-sid
 * advisory lock the beacon insert takes, then drops the row once the window
 * has passed. Replaces any setTimeout — survives restarts.
 */
const ErasedSessionSweep = sequelize.define('ErasedSessionSweep', {
  sessionId: { type: DataTypes.STRING(64), primaryKey: true },
  sweepUntil: { type: DataTypes.DATE, allowNull: false },
}, {
  tableName: 'erased_session_sweeps',
});

export default ErasedSessionSweep;
