import { sequelize } from '../database/connection.js';

// Import all models
import User from './User.js';
import Campaign from './Campaign.js';
import Car from './Car.js';
import FleetOwner from './FleetOwner.js';
import Driver from './Driver.js';
import Prospect from './Prospect.js';
import QrTag from './QrTag.js';
import Commission from './Commission.js';
import LeadPackage from './LeadPackage.js';
import CampaignPreview from './CampaignPreview.js';
import QrScan from './QrScan.js';
import Attribution from './Attribution.js';
import SessionVisit from './SessionVisit.js';
import ProspectActivity from './ProspectActivity.js';

// Define associations
const defineAssociations = () => {
  // User associations
  User.hasOne(FleetOwner, { foreignKey: 'userId', as: 'fleetOwnerProfile' });
  User.hasOne(Driver, { foreignKey: 'userId', as: 'driverProfile' });
  User.hasMany(Campaign, { foreignKey: 'createdBy', as: 'createdCampaigns' });
  User.hasMany(QrTag, { foreignKey: 'ownerUserId', as: 'ownedQrTags' });
  User.hasMany(Commission, { foreignKey: 'agentId', as: 'commissions' });
  User.hasMany(Commission, { foreignKey: 'approvedBy', as: 'approvedCommissions' });
  User.hasMany(Commission, { foreignKey: 'processedBy', as: 'processedCommissions' });
  User.hasMany(Prospect, { foreignKey: 'assignedAgentId', as: 'assignedProspects' });
  User.hasMany(LeadPackage, { foreignKey: 'createdBy', as: 'createdLeadPackages' });

  // FleetOwner associations (standalone entity, not linked to User)
  FleetOwner.hasMany(Car, { foreignKey: 'fleet_owner_id', as: 'cars' });

  // Car associations
  Car.belongsTo(FleetOwner, { foreignKey: 'fleet_owner_id', as: 'fleetOwner' });
  Car.belongsTo(User, { foreignKey: 'current_driver_id', as: 'currentDriver' });
  Car.hasMany(QrTag, { foreignKey: 'carId', as: 'qrTags' });

  // Campaign associations
  Campaign.belongsTo(User, { foreignKey: 'createdBy', as: 'creator' });
  Campaign.hasMany(QrTag, { foreignKey: 'campaignId', as: 'qrTags' });
  Campaign.hasMany(Prospect, { foreignKey: 'campaignId', as: 'prospects' });
  Campaign.hasMany(Commission, { foreignKey: 'campaignId', as: 'commissions' });
  Campaign.hasMany(LeadPackage, { foreignKey: 'campaignId', as: 'leadPackages' });
  Campaign.hasOne(CampaignPreview, { foreignKey: 'campaignId', as: 'preview' });

  // QrTag associations
  QrTag.belongsTo(User, { foreignKey: 'ownerUserId', as: 'owner' });
  QrTag.belongsTo(Campaign, { foreignKey: 'campaignId', as: 'campaign' });
  QrTag.belongsTo(Car, { foreignKey: 'carId', as: 'car' });
  QrTag.hasMany(Prospect, { foreignKey: 'qrTagId', as: 'prospects' });
  QrTag.hasMany(QrScan, { foreignKey: 'qrTagId', as: 'scans' });
  QrTag.hasMany(Attribution, { foreignKey: 'qrTagId', as: 'attributions' });

  // Prospect associations
  Prospect.belongsTo(User, { foreignKey: 'assignedAgentId', as: 'assignedAgent' });
  Prospect.belongsTo(Campaign, { foreignKey: 'campaignId', as: 'campaign' });
  Prospect.belongsTo(QrTag, { foreignKey: 'qrTagId', as: 'qrTag' });
  Prospect.hasMany(Commission, { foreignKey: 'prospectId', as: 'commissions' });
  Prospect.belongsTo(Attribution, { foreignKey: 'attributionId', as: 'attribution' });
  Prospect.hasMany(ProspectActivity, { foreignKey: 'prospectId', as: 'activities' });
  ProspectActivity.belongsTo(Prospect, { foreignKey: 'prospectId', as: 'prospect' });
  ProspectActivity.belongsTo(User, { foreignKey: 'actorUserId', as: 'actor' });

  // Commission associations
  Commission.belongsTo(User, { foreignKey: 'agentId', as: 'agent' });
  Commission.belongsTo(User, { foreignKey: 'approvedBy', as: 'approver' });
  Commission.belongsTo(User, { foreignKey: 'processedBy', as: 'processor' });
  Commission.belongsTo(Campaign, { foreignKey: 'campaignId', as: 'campaign' });
  Commission.belongsTo(Prospect, { foreignKey: 'prospectId', as: 'prospect' });
  Commission.belongsTo(LeadPackage, { foreignKey: 'leadPackageId', as: 'leadPackage' });

  // LeadPackage associations
  LeadPackage.belongsTo(User, { foreignKey: 'createdBy', as: 'creator' });
  LeadPackage.belongsTo(Campaign, { foreignKey: 'campaignId', as: 'campaign' });
  LeadPackage.hasMany(Commission, { foreignKey: 'leadPackageId', as: 'commissions' });
};

// Initialize associations
defineAssociations();

// Export all models and sequelize instance
export {
  sequelize,
  User,
  Campaign,
  Car,
  FleetOwner,
  Driver,
  Prospect,
  QrTag,
  Commission,
  LeadPackage,
  CampaignPreview,
  QrScan,
  Attribution,
  SessionVisit,
  ProspectActivity
};

// Export default object for convenience
export default {
  sequelize,
  User,
  Campaign,
  Car,
  FleetOwner,
  Driver,
  Prospect,
  QrTag,
  Commission,
  LeadPackage,
  CampaignPreview,
  QrScan,
  Attribution,
  SessionVisit,
  ProspectActivity
};
