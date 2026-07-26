import { DataTypes, Op } from 'sequelize';
import { sequelize } from '../database/connection.js';

/**
 * Append-only, revisioned fact ledger — one row = one observation of one
 * person-attribute from one source-artifact revision
 * (docs/plans/consumer-profile-enrichment.md §3.1).
 *
 * Anchoring (Codex R1 #2): source-derived rows anchor to the PROSPECT and
 * resolve their owner through the live prospects.consumerId link at read
 * time — the spine reconciler relinks prospects without ceremony, and
 * prospect-anchored rows follow for free. Only `manual` rows anchor to the
 * consumer directly (they survive relinks, die on that consumer's erasure).
 *
 * NEVER UPDATE rows: corrections supersede (revision activation sets
 * `supersededAt`) or retract (`retractedAt`). Supersession is permanent —
 * retracting a superseding row revives nothing (§3.4). Identity for
 * idempotent inserts is (artifact, revision, pipeline, pipelineVersion, key)
 * — revision, not content hash: A→B→A staff edits mint revision 3 and must
 * never collide with revision 1's superseded rows (R3 #3).
 */
const ConsumerObservation = sequelize.define('ConsumerObservation', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  sourceProspectId: {
    type: DataTypes.UUID,
    allowNull: true,
    comment: 'Anchor for source-derived rows; owner = live prospects.consumerId at read'
  },
  consumerId: {
    type: DataTypes.UUID,
    allowNull: true,
    comment: 'Anchor for manual person-level facts ONLY (chk_cobs_anchor)'
  },
  key: {
    type: DataTypes.STRING(64),
    allowNull: false,
    comment: 'Allowlisted taxonomy key (factTaxonomy.js) — never free-form'
  },
  value: {
    type: DataTypes.JSONB,
    allowNull: false,
    comment: 'Per-key schema; supports negatives ({v:false}) and {complete} collections'
  },
  confidence: {
    type: DataTypes.REAL,
    allowNull: false,
    validate: { min: 0, max: 1 }
  },
  source: {
    type: DataTypes.STRING(24),
    allowNull: false,
    validate: { isIn: [['form', 'quiz', 'retell_analysis', 'screening_transcript', 'manual']] },
    comment: 'Doubles as the explicitness rank in resolveCurrentFacts (§3.4)'
  },
  sourceArtifactId: {
    type: DataTypes.STRING(80),
    allowNull: true,
    comment: 'e.g. form:<prospectId>, quiz:<prospectId>, screening:<callId>'
  },
  sourceRevisionId: {
    type: DataTypes.BIGINT,
    allowNull: true,
    comment: 'Monotonic per-artifact revision minted by the SOURCE mutation txn (R3 #3)'
  },
  sourceContentHash: {
    type: DataTypes.STRING(64),
    allowNull: true,
    comment: 'sha256 of the exact artifact content — integrity/audit, NOT identity'
  },
  sourceEventAt: {
    type: DataTypes.DATE,
    allowNull: false,
    comment: 'Artifact time (call end / capture) clamped to now()+24h skew — never extraction time'
  },
  pipeline: { type: DataTypes.STRING(24), allowNull: false },
  pipelineVersion: {
    type: DataTypes.STRING(48),
    allowNull: false,
    comment: 'COMPOSITE semantic version of the pipeline (code+prompt+taxonomy) — R3 #6'
  },
  evidence: {
    type: DataTypes.TEXT,
    allowNull: true,
    validate: { len: [0, 300] },
    comment: 'Server-verified substring of normalized source text; kept for the row lifetime'
  },
  supersededAt: { type: DataTypes.DATE, allowNull: true },
  retractedAt: { type: DataTypes.DATE, allowNull: true, comment: 'Admin "that\'s wrong" (§9)' }
}, {
  tableName: 'consumer_observations',
  indexes: [
    // Mirrored on the model — test boot builds schema via sync({force:true})
    // BEFORE migrations (the Consumer.js / RewardEntitlement.js pattern).
    {
      unique: true,
      fields: ['sourceArtifactId', 'sourceRevisionId', 'pipeline', 'pipelineVersion', 'key'],
      name: 'uq_cobs_artifact_revision_key',
      where: { sourceArtifactId: { [Op.ne]: null } }
    },
    { fields: ['sourceProspectId', 'key'], name: 'idx_cobs_prospect_key', where: { sourceProspectId: { [Op.ne]: null } } },
    { fields: ['consumerId', 'key'], name: 'idx_cobs_consumer_key', where: { consumerId: { [Op.ne]: null } } },
    { fields: ['sourceArtifactId'], name: 'idx_cobs_artifact', where: { sourceArtifactId: { [Op.ne]: null } } },
  ]
});

export default ConsumerObservation;
