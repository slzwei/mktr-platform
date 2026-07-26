import { DataTypes, Op } from 'sequelize';
import { sequelize } from '../database/connection.js';

/**
 * Durable enrichment work queue (docs/plans/consumer-profile-enrichment.md §3.3).
 *
 * One job per (kind, subject, source revision, pipeline version) — versions
 * are stamped at ENQUEUE (R2 #5), so reconciliation can see which pipeline a
 * pending job serves and deploy-era claimers can't reinterpret work.
 *
 * kind-shape contract (chk_ejobs_kind in migration 091):
 *   map        — subjectProspectId + sourceRevisionId + sourceContentHash;
 *                payload = the MINIMIZED capture snapshot (taxonomy-relevant
 *                normalized fields only, ≤ 8 KB serialized, never contact
 *                data) frozen at enqueue — the mapper never reads mutable
 *                live rows (R3 #4/#10-era).
 *   extract    — subjectProspectId + sourceArtifactId + sourceRevisionId +
 *                sourceContentHash; NO payload — text is fetched at claim by
 *                artifact + hash.
 *   synthesize — subjectConsumerId + inputHash + promptVersion; NO payload —
 *                the DTO is REBUILT at claim under the fence and handed out
 *                only when its hash equals inputHash (R4 #1).
 *
 * Dedupe lifecycle (R4-era finding 1): map/extract uniques span
 * pending/leased/done; the synthesize unique spans pending/leased ONLY — a
 * done synth job must never block re-enqueueing a recurring input hash
 * (A→B→A convergence). Completion replay is validated by job id + lease
 * token (done rows keep their leaseToken until the 30-day queue prune).
 *
 * Erasure nulls payload + lastError across EVERY status for both subject
 * addressings — done/dead rows outlive the person otherwise (R3 #4, R4 #4).
 */
const EnrichmentJob = sequelize.define('EnrichmentJob', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  kind: {
    type: DataTypes.STRING(12),
    allowNull: false,
    validate: { isIn: [['map', 'extract', 'synthesize']] }
  },
  subjectProspectId: { type: DataTypes.UUID, allowNull: true },
  subjectConsumerId: { type: DataTypes.UUID, allowNull: true },
  sourceArtifactId: { type: DataTypes.STRING(80), allowNull: true },
  sourceRevisionId: { type: DataTypes.BIGINT, allowNull: true },
  sourceContentHash: { type: DataTypes.STRING(64), allowNull: true },
  inputHash: { type: DataTypes.STRING(64), allowNull: true },
  promptVersion: { type: DataTypes.STRING(32), allowNull: true },
  payload: { type: DataTypes.JSONB, allowNull: true },
  taxonomyVersion: { type: DataTypes.STRING(16), allowNull: true },
  pipelineVersion: { type: DataTypes.STRING(48), allowNull: false },
  status: {
    type: DataTypes.STRING(12),
    allowNull: false,
    defaultValue: 'pending',
    validate: { isIn: [['pending', 'leased', 'done', 'stale', 'dead', 'cancelled']] }
  },
  leaseToken: { type: DataTypes.UUID, allowNull: true },
  leaseExpiresAt: { type: DataTypes.DATE, allowNull: true },
  workerId: { type: DataTypes.STRING(80), allowNull: true },
  attempts: {
    type: DataTypes.SMALLINT,
    allowNull: false,
    defaultValue: 0,
    comment: 'Lease expiry AND payload-validation failures both increment; ≥3 → dead (R2 #6)'
  },
  lastError: { type: DataTypes.TEXT, allowNull: true }
}, {
  tableName: 'enrichment_jobs',
  indexes: [
    // Mirrored on the model (sync-before-migrations test boot).
    {
      unique: true,
      fields: ['kind', 'subjectProspectId', 'sourceRevisionId', 'pipelineVersion'],
      name: 'uq_ejobs_map',
      where: { kind: 'map', status: { [Op.in]: ['pending', 'leased', 'done'] } }
    },
    {
      unique: true,
      fields: ['kind', 'subjectProspectId', 'sourceArtifactId', 'sourceRevisionId', 'pipelineVersion'],
      name: 'uq_ejobs_extract',
      where: { kind: 'extract', status: { [Op.in]: ['pending', 'leased', 'done'] } }
    },
    {
      unique: true,
      fields: ['kind', 'subjectConsumerId', 'inputHash', 'promptVersion'],
      name: 'uq_ejobs_synthesize',
      where: { kind: 'synthesize', status: { [Op.in]: ['pending', 'leased'] } }
    },
    { fields: ['kind', 'createdAt'], name: 'idx_ejobs_pending', where: { status: 'pending' } },
    { fields: ['leaseExpiresAt'], name: 'idx_ejobs_lease_expiry', where: { status: 'leased' } },
    { fields: ['subjectConsumerId'], name: 'idx_ejobs_subject_consumer', where: { subjectConsumerId: { [Op.ne]: null } } },
    { fields: ['subjectProspectId'], name: 'idx_ejobs_subject_prospect', where: { subjectProspectId: { [Op.ne]: null } } },
  ]
});

export default EnrichmentJob;
