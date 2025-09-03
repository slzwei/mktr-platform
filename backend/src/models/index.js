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

// Define associations
const defineAssociations = () => {
  // User associations
  User.hasOne(FleetOwner, { foreignKey: 'userId', as: 'fleetOwnerProfile' });
  User.hasOne(Driver, { foreignKey: 'userId', as: 'driverProfile' });
  User.hasMany(Campaign, { foreignKey: 'createdBy', as: 'createdCampaigns' });
  User.hasMany(QrTag, { foreignKey: 'createdBy', as: 'createdQrTags' });
  User.hasMany(Commission, { foreignKey: 'agentId', as: 'commissions' });
  User.hasMany(Commission, { foreignKey: 'approvedBy', as: 'approvedCommissions' });
  User.hasMany(Commission, { foreignKey: 'processedBy', as: 'processedCommissions' });
  User.hasMany(Prospect, { foreignKey: 'assignedAgentId', as: 'assignedProspects' });
  User.hasMany(LeadPackage, { foreignKey: 'createdBy', as: 'createdLeadPackages' });

  // FleetOwner associations
  FleetOwner.belongsTo(User, { foreignKey: 'userId', as: 'user' });
  FleetOwner.hasMany(Car, { foreignKey: 'fleetOwnerId', as: 'cars' });
  FleetOwner.hasMany(Driver, { foreignKey: 'fleetOwnerId', as: 'drivers' });

  // Driver associations
  Driver.belongsTo(User, { foreignKey: 'userId', as: 'user' });
  Driver.belongsTo(FleetOwner, { foreignKey: 'fleetOwnerId', as: 'fleetOwner' });
  Driver.hasMany(Car, { foreignKey: 'currentDriverId', as: 'assignedCars' });

  // Car associations
  Car.belongsTo(FleetOwner, { foreignKey: 'fleetOwnerId', as: 'fleetOwner' });
  Car.belongsTo(Driver, { foreignKey: 'currentDriverId', as: 'currentDriver' });
  Car.hasMany(QrTag, { foreignKey: 'carId', as: 'qrTags' });

  // Campaign associations
  Campaign.belongsTo(User, { foreignKey: 'createdBy', as: 'creator' });
  Campaign.hasMany(QrTag, { foreignKey: 'campaignId', as: 'qrTags' });
  Campaign.hasMany(Prospect, { foreignKey: 'campaignId', as: 'prospects' });
  Campaign.hasMany(Commission, { foreignKey: 'campaignId', as: 'commissions' });
  Campaign.hasMany(LeadPackage, { foreignKey: 'campaignId', as: 'leadPackages' });

  // QrTag associations
  QrTag.belongsTo(User, { foreignKey: 'createdBy', as: 'creator' });
  QrTag.belongsTo(Campaign, { foreignKey: 'campaignId', as: 'campaign' });
  QrTag.belongsTo(Car, { foreignKey: 'carId', as: 'car' });
  QrTag.hasMany(Prospect, { foreignKey: 'qrTagId', as: 'prospects' });

  // Prospect associations
  Prospect.belongsTo(User, { foreignKey: 'assignedAgentId', as: 'assignedAgent' });
  Prospect.belongsTo(Campaign, { foreignKey: 'campaignId', as: 'campaign' });
  Prospect.belongsTo(QrTag, { foreignKey: 'qrTagId', as: 'qrTag' });
  Prospect.hasMany(Commission, { foreignKey: 'prospectId', as: 'commissions' });

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
  LeadPackage
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
  LeadPackage
};
