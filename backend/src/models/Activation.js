import { DataTypes, Op } from 'sequelize';
import { sequelize } from '../database/connection.js';

/**
 * The operational use of a Reward Offer in connection with ONE canonical MKTR
 * campaign (docs/redeem-ops/ERD.md §3.15, brief §25). An Activation is NOT a
 * campaign: it owns no design config, forms, pixels, or routing — `campaignId`
 * is a read-only reference and campaign editing stays on mktr.sg.
 */
const Activation = sequelize.define('Activation', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  partnerOrganisationId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: { model: 'partner_organisations', key: 'id' }
  },
  rewardOfferId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: { model: 'reward_offers', key: 'id' }
  },
  campaignId: {
    type: DataTypes.UUID,
    allowNull: true,
    references: { model: 'campaigns', key: 'id' },
    comment: 'Canonical MKTR campaign reference — SET NULL on campaign delete; snapshot below keeps display alive'
  },
  campaignNameSnapshot: { type: DataTypes.STRING(160), allowNull: true },
  allocatedQuantity: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  issuedCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, comment: 'Guarded counter (Phase 6 issuance)' },
  redeemedCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  status: {
    type: DataTypes.STRING(16),
    allowNull: false,
    defaultValue: 'draft',
    comment: 'draft|preparing|active|paused|completed|cancelled'
  },
  unlockPolicy: {
    type: DataTypes.STRING(16),
    allowNull: false,
    defaultValue: 'agent_unlock',
    comment: 'on_capture = voucher live at signup; agent_unlock = consultant unlocks at the meeting (default)'
  },
  startDate: { type: DataTypes.DATE, allowNull: true },
  endDate: { type: DataTypes.DATE, allowNull: true },
  internalNotes: { type: DataTypes.TEXT, allowNull: true },
  renewalOutcome: { type: DataTypes.STRING(24), allowNull: true, comment: 'renewed|not_renewed|pending (Phase 7)' },
  createdBy: { type: DataTypes.UUID, allowNull: false, references: { model: 'users', key: 'id' } }
}, {
  tableName: 'activations',
  indexes: [
    { fields: ['partnerOrganisationId'], name: 'idx_act_partner' },
    { fields: ['rewardOfferId'], name: 'idx_act_offer' },
    { fields: ['status'], name: 'idx_act_status' },
    // ONE live activation per campaign — makes Phase 6 issuance deterministic
    {
      unique: true,
      fields: ['campaignId'],
      name: 'uq_act_live_campaign',
      where: { status: { [Op.in]: ['preparing', 'active', 'paused'] }, campaignId: { [Op.ne]: null } }
    }
  ]
});

export default Activation;
