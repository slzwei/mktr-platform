import { DataTypes } from 'sequelize';
import { sequelize } from '../database/connection.js';

/**
 * A lucky draw for one campaign (docs/plans/lucky-draw-10x.md §4.3).
 *
 * Lifecycle: open → frozen (1× pool snapshotted) → sealed (boosts + poolHash
 * committed) → drawn (≥1 witnessed attempt) → published / claimed; void from
 * any pre-published state. The winner is NEVER stored here — each pick is a
 * draw_attempts row (redraws = further attempts), so there is no circular FK
 * and the full history is append-shaped.
 *
 * closesAt / boostClosesAt are UTC INSTANTS (derived from SGT day boundaries
 * at createDraw time) — freeze/seal re-apply them regardless of when an
 * operator actually runs, so an ops delay can never widen a window.
 */
const Draw = sequelize.define('Draw', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  campaignId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: { model: 'campaigns', key: 'id' }
  },
  activationId: {
    type: DataTypes.UUID,
    allowNull: true,
    references: { model: 'activations', key: 'id' },
    comment: 'Designated ×N activation — unlock events on OTHER activations never boost'
  },
  termsVersionId: {
    type: DataTypes.UUID,
    allowNull: true,
    references: { model: 'draw_terms_versions', key: 'id' }
  },
  closesAt: { type: DataTypes.DATE, allowNull: false, comment: 'Entry cutoff instant (UTC)' },
  boostClosesAt: { type: DataTypes.DATE, allowNull: true, comment: 'Unlock-event cutoff instant (UTC); null = no boost tier' },
  multiplier: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 10 },
  status: {
    type: DataTypes.STRING(16),
    allowNull: false,
    defaultValue: 'open',
    comment: 'open|frozen|sealed|drawn|published|claimed|void'
  },
  poolHash: {
    type: DataTypes.STRING(64),
    allowNull: true,
    comment: 'sha256 over the canonical ordered entry tuples (id|prospectId|phoneHash|chances|boostVia) — committed at seal'
  },
  // Commit-reveal on the SEED (P2-8, migration 103). The pool was already
  // committed at seal, but the seed was minted at DRAW time and used
  // immediately — and pickWinner is a pure function of (seed, entries), so an
  // operator could re-mint and re-run until the pick landed on a chosen entry,
  // then persist that attempt. Committing hash(seed) in the same one-way
  // frozen→sealed transition fixes the winner at the seal instant; any later
  // substitution fails verifyDraw.
  seedCommitment: {
    type: DataTypes.STRING(64),
    allowNull: true,
    comment: 'sha256(sealedSeed) — committed at seal, before any pick is computed'
  },
  sealedSeed: {
    type: DataTypes.STRING(64),
    allowNull: true,
    comment: 'The seed committed at seal and REVEALED at draw; every attempt must hash to seedCommitment'
  },
  witnessedByUserId: { type: DataTypes.UUID, allowNull: true, references: { model: 'users', key: 'id' }, onDelete: 'SET NULL' },
  // Multi-winner snapshot (Phase 3, migration 125). The engine's authority for
  // WHAT this draw awards — deliberately a copy, never a live read of the
  // campaign: editing prizes must not change an in-flight draw.
  prizes: {
    type: DataTypes.JSONB,
    allowNull: true,
    comment: 'Snapshot of luckyDraw.prizes at createDraw; NULL = legacy single-prize draw'
  },
  winnersCount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 1,
    comment: 'Number of prize units this draw awards (Σqty at createDraw)'
  },
  algorithmVersion: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 1,
    comment: '1 = legacy sha256-mod single winner, 2 = domain-separated derivation (utils/drawSelection.js)'
  },
  notes: { type: DataTypes.TEXT, allowNull: true },
  createdBy: { type: DataTypes.UUID, allowNull: false, references: { model: 'users', key: 'id' } }
}, {
  tableName: 'draws',
  timestamps: true,
  indexes: [
    { fields: ['campaignId'], name: 'idx_draws_campaign' },
    // One LIVE draw per campaign (history unlimited). Defined here AND in
    // migration 059 so sync()-built schemas (tests) enforce it too — the
    // prospects_campaign_id_phone lesson.
    {
      unique: true,
      fields: ['campaignId'],
      name: 'uq_draws_live_campaign',
      where: { status: ['open', 'frozen', 'sealed', 'drawn'] }
    }
  ]
});

export default Draw;
