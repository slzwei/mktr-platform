import { DataTypes } from 'sequelize';
import { sequelize } from '../database/connection.js';

/**
 * One row per person: the AI persona summary + the deterministic
 * consumerScore (docs/plans/consumer-profile-enrichment.md §3.2).
 *
 * Naming: `consumerScore`, never bare `score` — that word is owned by the
 * per-prospect lead field (Prospect.js:75) and the two must not blur.
 *
 * Discovery protocol (Codex R2 #2 / R4-era): `inputVersion` is a monotonic
 * counter bumped transactionally (UPSERT — first-time consumers must not
 * lose bumps) by every writer that feeds the synthesis DTO or the score:
 * observation revision activation, retraction, manual facts, consent
 * events, WA delivery, draw entries, screening verdicts, prospect
 * lifecycle mutations, and spine relinks (BOTH consumers). Dirty ⇔
 * inputVersion > syncedInputVersion. `profileInputHash` is set from the
 * completed job's inputHash — never compared against a NEW hash (R4 #1).
 *
 * `scoredConfigVersion` is stamped on every scoring pass EVEN WHEN
 * consumerScore stays NULL, so unscoreable profiles exit the re-score loop
 * (R3 #11). Erasure DELETES this row entirely (§9) — no scrubbed husk.
 */
const ConsumerProfile = sequelize.define('ConsumerProfile', {
  consumerId: { type: DataTypes.UUID, primaryKey: true },
  summary: {
    type: DataTypes.TEXT,
    allowNull: true,
    validate: { len: [0, 1200] },
    comment: 'Plain text, generated ONLY from validated claims (§6.4); never rendered as HTML'
  },
  profileJson: {
    type: DataTypes.JSONB,
    allowNull: true,
    comment: 'Structured claims w/ basisObservationIds + server-checked entailment (§6.4)'
  },
  consumerScore: {
    type: DataTypes.SMALLINT,
    allowNull: true,
    validate: { min: 0, max: 100 },
    comment: 'Server-computed only (consumerScoringService); NULL = unscoreable, renders "—"'
  },
  // §7.1b — the SAME components grouped two ways. Real columns (migration
  // 093), not scoreBreakdown lookups, because People sorts on them. Declared
  // on the model as well as the migration: test boot builds schema via
  // sync({force:true}) BEFORE migrations run (the Consumer.js index lesson).
  meetScore: {
    type: DataTypes.SMALLINT,
    allowNull: true,
    validate: { min: 0, max: 100 },
    comment: 'Reachability: engagement + contactability + market fit. NULL = unscoreable'
  },
  buyScore: {
    type: DataTypes.SMALLINT,
    allowNull: true,
    validate: { min: 0, max: 100 },
    comment: 'Potential: life events + family gap + capacity + coverage headroom. NULL until ≥1 fact component is assessed'
  },
  scoreBreakdown: {
    type: DataTypes.JSONB,
    allowNull: true,
    comment: 'Per component: {state: unknown|assessed, points, maxPoints, basisObservationIds, note}'
  },
  scoredConfigVersion: { type: DataTypes.INTEGER, allowNull: true },
  scoringAlgorithmVersion: { type: DataTypes.STRING(16), allowNull: true },
  scoreInputHash: { type: DataTypes.STRING(64), allowNull: true },
  inputVersion: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
  syncedInputVersion: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
  profileInputHash: { type: DataTypes.STRING(64), allowNull: true },
  modelVersion: { type: DataTypes.STRING(48), allowNull: true },
  summaryGeneratedAt: { type: DataTypes.DATE, allowNull: true },
  scoreComputedAt: { type: DataTypes.DATE, allowNull: true }
}, {
  tableName: 'consumer_profiles'
  // idx_cprof_dirty (partial, inputVersion > syncedInputVersion) is
  // migration-only: column-to-column predicates don't express in model
  // index `where`, and it's a perf index — behavior doesn't depend on it.
});

export default ConsumerProfile;
