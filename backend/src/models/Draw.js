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
    comment: 'sha256 over the canonical ordered entry tuples (id|prospectId|phoneHash|chances|boostVia) — committed at seal, BEFORE any seed exists'
  },
  witnessedByUserId: { type: DataTypes.UUID, allowNull: true, references: { model: 'users', key: 'id' } },
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
