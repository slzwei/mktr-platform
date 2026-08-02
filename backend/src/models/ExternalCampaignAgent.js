import { DataTypes, Sequelize } from 'sequelize';
import { sequelize } from '../database/connection.js';

/**
 * ExternalCampaignAgent — which campaigns an external buyer participates in.
 *
 * A campaign may mix internal Lyfe agents and external buyers; the unified
 * round-robin (systemAgent.resolveLeadAssignment) rotates across both pools.
 * Eligibility is decoupled from balance: balance is global on ExternalAgent,
 * this table just says "agent X may receive leads for campaign Y".
 */
const ExternalCampaignAgent = sequelize.define('ExternalCampaignAgent', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  externalAgentId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: { model: 'external_agents', key: 'id' }
  },
  campaignId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: { model: 'campaigns', key: 'id' }
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true
  },
  // Explicit timestamp defaults so the MODEL-built schema (test boot's
  // sync({force:true})) matches what migration 030 created in prod. Without a DB
  // default here Sequelize emits these NOT NULL with NO default: a raw INSERT
  // that omits them succeeds in prod and dies in every test (CLAUDE.md's
  // "test schema != prod schema"). The ORM still fills them on create/update —
  // this only makes the database agree.
  //
  // fn('NOW'), NOT DataTypes.NOW: the latter is an ORM-side default only and
  // emits no DEFAULT clause at all (verified against this Sequelize version),
  // so it would have looked like a fix and changed nothing. This is the same
  // expression the migration uses.
  createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
  updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') }
}, {
  tableName: 'external_campaign_agents',
  indexes: [
    { fields: ['campaignId'] },
    { fields: ['externalAgentId'] },
    { fields: ['externalAgentId', 'campaignId'], unique: true, name: 'idx_eca_unique' }
  ]
});

export default ExternalCampaignAgent;
