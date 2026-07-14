import { DataTypes, Op } from 'sequelize';
import { sequelize } from '../database/connection.js';

/**
 * A business we prospect / partner with for reward supply (docs/redeem-ops/ERD.md §3.1).
 * Display values (legalName/tradingName/…) are stored separately from normalized
 * matching keys (normalizedName, websiteDomain, handles) — services/redeemOps/normalizers.js
 * derives the keys; duplicate detection lives in dedupeService.js.
 */
const PartnerOrganisation = sequelize.define('PartnerOrganisation', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },

  // Display identity — at least one name required (service-enforced)
  legalName: { type: DataTypes.STRING(160), allowNull: true },
  tradingName: { type: DataTypes.STRING(160), allowNull: true },
  brandName: { type: DataTypes.STRING(120), allowNull: true },

  // Normalized matching keys (never rendered)
  normalizedName: { type: DataTypes.STRING(160), allowNull: false },
  uen: { type: DataTypes.STRING(16), allowNull: true, comment: 'Uppercased ACRA UEN' },
  website: { type: DataTypes.STRING(255), allowNull: true },
  websiteDomain: { type: DataTypes.STRING(160), allowNull: true },
  primaryPhone: {
    type: DataTypes.STRING(20),
    allowNull: true,
    validate: {
      isE164(value) {
        if (value && !/^\+[1-9]\d{9,14}$/.test(value)) {
          throw new Error('Phone must be in E.164 format (e.g. +6591234567)');
        }
      }
    }
  },
  primaryEmail: { type: DataTypes.STRING(160), allowNull: true },
  instagramHandle: { type: DataTypes.STRING(64), allowNull: true },
  tiktokHandle: { type: DataTypes.STRING(64), allowNull: true },
  facebookUrl: { type: DataTypes.STRING(255), allowNull: true },
  facebookHandle: { type: DataTypes.STRING(120), allowNull: true },
  linkedinUrl: { type: DataTypes.STRING(255), allowNull: true },

  category: { type: DataTypes.STRING(64), allowNull: true },
  subcategory: { type: DataTypes.STRING(64), allowNull: true },
  source: { type: DataTypes.STRING(64), allowNull: true },
  tags: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
  notes: { type: DataTypes.TEXT, allowNull: true },

  // Pipeline + ownership (constants: services/redeemOps/constants.js — STRING not ENUM, house style)
  pipelineStage: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'NEW' },
  lostReason: { type: DataTypes.STRING(32), allowNull: true },
  snoozedUntil: { type: DataTypes.DATE, allowNull: true },
  availability: {
    type: DataTypes.STRING(24),
    allowNull: false,
    defaultValue: 'available',
    comment: 'available|owned|follow_up_later|restricted|disqualified — the claim gate'
  },
  ownerUserId: { type: DataTypes.UUID, allowNull: true, references: { model: 'users', key: 'id' } },
  claimedAt: { type: DataTypes.DATE, allowNull: true },
  firstOutreachAt: { type: DataTypes.DATE, allowNull: true },
  lastActivityAt: { type: DataTypes.DATE, allowNull: true, comment: 'Denormalized for queue/stale queries' },
  nextTaskAt: { type: DataTypes.DATE, allowNull: true, comment: 'Denormalized from open tasks (Phase 3)' },
  atRiskFlag: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, comment: 'Claimed >48h, no first outreach (sweep-set)' },
  staleFlag: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, comment: 'No meaningful activity >14d (sweep-set)' },

  mergedIntoId: { type: DataTypes.UUID, allowNull: true, references: { model: 'partner_organisations', key: 'id' }, comment: 'Set on merge; row retained, hidden from lists' },
  archivedAt: { type: DataTypes.DATE, allowNull: true },

  // Consumer-facing marketplace profile (migration 067). Everything else on
  // this model is CRM-internal and must never surface publicly.
  publicBlurb: { type: DataTypes.TEXT, allowNull: true, comment: 'Consumer-facing partner blurb (marketplace)' },
  verifiedAt: { type: DataTypes.DATE, allowNull: true, comment: 'Verification stamp — null = unverified; admin-set only' },
  partnerSince: { type: DataTypes.SMALLINT, allowNull: true, comment: 'Display year for "on Redeem since"' },
  createdBy: { type: DataTypes.UUID, allowNull: false, references: { model: 'users', key: 'id' } }
}, {
  tableName: 'partner_organisations',
  indexes: [
    { unique: true, fields: ['uen'], where: { uen: { [Op.ne]: null } }, name: 'uq_po_uen' },
    { unique: true, fields: ['primaryPhone'], where: { primaryPhone: { [Op.ne]: null } }, name: 'uq_po_phone' },
    { unique: true, fields: ['instagramHandle'], where: { instagramHandle: { [Op.ne]: null } }, name: 'uq_po_instagram' },
    { unique: true, fields: ['tiktokHandle'], where: { tiktokHandle: { [Op.ne]: null } }, name: 'uq_po_tiktok' },
    { fields: ['normalizedName'], name: 'idx_po_normalized_name' },
    { fields: ['websiteDomain'], name: 'idx_po_domain' },
    { fields: ['ownerUserId', 'pipelineStage'], name: 'idx_po_owner_stage' },
    { fields: ['pipelineStage'], name: 'idx_po_stage' },
    { fields: ['availability'], name: 'idx_po_availability' },
    { fields: ['category'], name: 'idx_po_category' },
    { fields: ['lastActivityAt'], name: 'idx_po_last_activity' },
    { fields: ['nextTaskAt'], name: 'idx_po_next_task' }
  ]
});

export default PartnerOrganisation;
