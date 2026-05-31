import { DataTypes } from 'sequelize';
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
  }
}, {
  tableName: 'external_campaign_agents',
  indexes: [
    { fields: ['campaignId'] },
    { fields: ['externalAgentId'] },
    { fields: ['externalAgentId', 'campaignId'], unique: true, name: 'idx_eca_unique' }
  ]
});

export default ExternalCampaignAgent;
