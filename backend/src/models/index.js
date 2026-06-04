import { readdir } from 'fs/promises';
import { fileURLToPath } from 'url';
import path from 'path';
import { sequelize } from '../database/connection.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Auto-load all model files
const models = {};
const modelFiles = (await readdir(__dirname))
  .filter(f => f.endsWith('.js') && f !== 'index.js')
  .sort();

for (const file of modelFiles) {
  const mod = await import(path.join(__dirname, file));
  const model = mod.default;
  if (model?.name && typeof model.sync === 'function') {
    models[model.name] = model;
  }
}

// Define associations (MUST remain explicit -- do not auto-discover)
function defineAssociations() {
  const {
    User, Campaign, Car, FleetOwner, Driver, Prospect, QrTag,
    Commission, LeadPackage, LeadPackageAssignment, CampaignPreview,
    QrScan, Attribution, SessionVisit, ProspectActivity, UserPayout,
    Device, BeaconEvent, Impression, ShortLink, ShortLinkClick,
    Vehicle, WebhookSubscriber, WebhookDelivery, AgentGroup,
    AgentGroupMember, DeviceCampaignAssignment, VehicleCampaignAssignment,
    CampaignMediaItem, CampaignAgentAssignment, ExternalAgent, ExternalCampaignAgent
  } = models;

  // User associations
  User.hasOne(FleetOwner, { foreignKey: 'userId', as: 'fleetOwnerProfile', onDelete: 'CASCADE' });
  User.hasOne(Driver, { foreignKey: 'userId', as: 'driverProfile', onDelete: 'CASCADE' });
  User.hasMany(Campaign, { foreignKey: 'createdBy', as: 'createdCampaigns', onDelete: 'RESTRICT' });
  User.hasMany(QrTag, { foreignKey: 'ownerUserId', as: 'ownedQrTags', onDelete: 'SET NULL' });
  User.hasMany(Commission, { foreignKey: 'agentId', as: 'commissions', onDelete: 'RESTRICT' });
  User.hasMany(Commission, { foreignKey: 'approvedBy', as: 'approvedCommissions', onDelete: 'SET NULL' });
  User.hasMany(Commission, { foreignKey: 'processedBy', as: 'processedCommissions', onDelete: 'SET NULL' });
  User.hasMany(Prospect, { foreignKey: 'assignedAgentId', as: 'assignedProspects', onDelete: 'SET NULL' });
  User.hasMany(LeadPackage, { foreignKey: 'createdBy', as: 'createdLeadPackages', onDelete: 'RESTRICT' });
  User.hasMany(LeadPackageAssignment, { foreignKey: 'agentId', as: 'assignedPackages', onDelete: 'CASCADE' });
  User.hasOne(UserPayout, { foreignKey: 'userId', as: 'payout', onDelete: 'CASCADE' });

  // FleetOwner associations (standalone entity, not linked to User)
  FleetOwner.hasMany(Car, { foreignKey: 'fleet_owner_id', as: 'cars', onDelete: 'RESTRICT' });

  // Car associations
  Car.belongsTo(FleetOwner, { foreignKey: 'fleet_owner_id', as: 'fleetOwner', onDelete: 'RESTRICT' });
  Car.belongsTo(User, { foreignKey: 'current_driver_id', as: 'currentDriver', onDelete: 'SET NULL' });
  Car.hasMany(QrTag, { foreignKey: 'carId', as: 'qrTags', onDelete: 'SET NULL' });

  // Campaign associations
  Campaign.belongsTo(User, { foreignKey: 'createdBy', as: 'creator', onDelete: 'RESTRICT' });
  Campaign.hasMany(QrTag, { foreignKey: 'campaignId', as: 'qrTags', onDelete: 'SET NULL' });
  Campaign.hasMany(Prospect, { foreignKey: 'campaignId', as: 'prospects', onDelete: 'SET NULL' });
  Campaign.hasMany(Commission, { foreignKey: 'campaignId', as: 'commissions', onDelete: 'SET NULL' });
  Campaign.hasMany(LeadPackage, { foreignKey: 'campaignId', as: 'leadPackages', onDelete: 'SET NULL' });
  Campaign.hasOne(CampaignPreview, { foreignKey: 'campaignId', as: 'preview', onDelete: 'CASCADE' });
  Campaign.hasMany(Impression, { foreignKey: 'campaignId', as: 'impressions', onDelete: 'SET NULL' });
  Campaign.hasMany(CampaignMediaItem, { foreignKey: 'campaignId', as: 'mediaItems', onDelete: 'CASCADE' });
  CampaignMediaItem.belongsTo(Campaign, { foreignKey: 'campaignId', as: 'campaign' });
  Campaign.belongsToMany(User, { through: CampaignAgentAssignment, foreignKey: 'campaignId', otherKey: 'agentId', as: 'assignedAgents' });
  User.belongsToMany(Campaign, { through: CampaignAgentAssignment, foreignKey: 'agentId', otherKey: 'campaignId', as: 'assignedToCampaigns' });

  // QrTag associations
  QrTag.belongsTo(User, { foreignKey: 'ownerUserId', as: 'owner', onDelete: 'SET NULL' });
  QrTag.belongsTo(Campaign, { foreignKey: 'campaignId', as: 'campaign', onDelete: 'SET NULL' });
  QrTag.belongsTo(Car, { foreignKey: 'carId', as: 'car', onDelete: 'SET NULL' });
  QrTag.belongsTo(QrTag, { foreignKey: 'parentQrTagId', as: 'parentQrTag', onDelete: 'SET NULL' });
  QrTag.hasMany(Prospect, { foreignKey: 'qrTagId', as: 'prospects', onDelete: 'SET NULL' });
  QrTag.hasMany(QrScan, { foreignKey: 'qrTagId', as: 'scans', onDelete: 'CASCADE' });
  QrTag.hasMany(Attribution, { foreignKey: 'qrTagId', as: 'attributions', onDelete: 'CASCADE' });

  // QrScan associations
  QrScan.belongsTo(QrTag, { foreignKey: 'qrTagId', as: 'qrTag', onDelete: 'CASCADE' });

  // Prospect associations
  Prospect.belongsTo(User, { foreignKey: 'assignedAgentId', as: 'assignedAgent', onDelete: 'SET NULL' });
  Prospect.belongsTo(Campaign, { foreignKey: 'campaignId', as: 'campaign', onDelete: 'SET NULL' });
  Prospect.belongsTo(QrTag, { foreignKey: 'qrTagId', as: 'qrTag', onDelete: 'SET NULL' });
  Prospect.hasMany(Commission, { foreignKey: 'prospectId', as: 'commissions', onDelete: 'SET NULL' });
  Prospect.belongsTo(Attribution, { foreignKey: 'attributionId', as: 'attribution', onDelete: 'SET NULL' });
  Prospect.hasMany(ProspectActivity, { foreignKey: 'prospectId', as: 'activities', onDelete: 'CASCADE' });
  ProspectActivity.belongsTo(Prospect, { foreignKey: 'prospectId', as: 'prospect', onDelete: 'CASCADE' });
  ProspectActivity.belongsTo(User, { foreignKey: 'actorUserId', as: 'actor', onDelete: 'SET NULL' });

  // ExternalAgent associations (MKTR Leads buyers — a separate table from `users`,
  // so Lyfe agent-sync can never see them). externalAgentId doubles as the webhook
  // destination signal: set => MKTR Leads subscriber; null => Lyfe subscriber.
  ExternalAgent.hasMany(Prospect, { foreignKey: 'externalAgentId', as: 'externalProspects', onDelete: 'SET NULL' });
  Prospect.belongsTo(ExternalAgent, { foreignKey: 'externalAgentId', as: 'externalAgent', onDelete: 'SET NULL' });
  ExternalAgent.hasMany(ExternalCampaignAgent, { foreignKey: 'externalAgentId', as: 'campaignLinks', onDelete: 'CASCADE' });
  ExternalCampaignAgent.belongsTo(ExternalAgent, { foreignKey: 'externalAgentId', as: 'externalAgent', onDelete: 'CASCADE' });
  Campaign.hasMany(ExternalCampaignAgent, { foreignKey: 'campaignId', as: 'externalAgentLinks', onDelete: 'CASCADE' });
  ExternalCampaignAgent.belongsTo(Campaign, { foreignKey: 'campaignId', as: 'campaign', onDelete: 'CASCADE' });

  // Commission associations
  Commission.belongsTo(User, { foreignKey: 'agentId', as: 'agent', onDelete: 'RESTRICT' });
  Commission.belongsTo(User, { foreignKey: 'approvedBy', as: 'approver', onDelete: 'SET NULL' });
  Commission.belongsTo(User, { foreignKey: 'processedBy', as: 'processor', onDelete: 'SET NULL' });
  Commission.belongsTo(Campaign, { foreignKey: 'campaignId', as: 'campaign', onDelete: 'SET NULL' });
  Commission.belongsTo(Prospect, { foreignKey: 'prospectId', as: 'prospect', onDelete: 'SET NULL' });
  Commission.belongsTo(LeadPackage, { foreignKey: 'leadPackageId', as: 'leadPackage', onDelete: 'SET NULL' });

  // LeadPackage associations
  LeadPackage.belongsTo(User, { foreignKey: 'createdBy', as: 'creator', onDelete: 'RESTRICT' });
  LeadPackage.belongsTo(Campaign, { foreignKey: 'campaignId', as: 'campaign', onDelete: 'SET NULL' });
  LeadPackage.hasMany(Commission, { foreignKey: 'leadPackageId', as: 'commissions', onDelete: 'SET NULL' });
  LeadPackage.hasMany(LeadPackageAssignment, { foreignKey: 'leadPackageId', as: 'assignments', onDelete: 'CASCADE' });

  // LeadPackageAssignment associations
  LeadPackageAssignment.belongsTo(User, { foreignKey: 'agentId', as: 'agent', onDelete: 'CASCADE' });
  LeadPackageAssignment.belongsTo(LeadPackage, { foreignKey: 'leadPackageId', as: 'package', onDelete: 'CASCADE' });

  // Device associations
  Device.hasMany(BeaconEvent, { foreignKey: 'deviceId', as: 'events', onDelete: 'CASCADE' });
  Device.hasMany(Impression, { foreignKey: 'deviceId', as: 'impressions', onDelete: 'CASCADE' });
  Device.belongsTo(Campaign, { foreignKey: 'campaignId', as: 'campaign', onDelete: 'SET NULL' });
  Device.belongsToMany(Campaign, { through: DeviceCampaignAssignment, foreignKey: 'deviceId', otherKey: 'campaignId', as: 'assignedCampaigns' });
  Campaign.belongsToMany(Device, { through: DeviceCampaignAssignment, foreignKey: 'campaignId', otherKey: 'deviceId', as: 'assignedDevices' });
  BeaconEvent.belongsTo(Device, { foreignKey: 'deviceId', as: 'device', onDelete: 'CASCADE' });
  Impression.belongsTo(Device, { foreignKey: 'deviceId', as: 'device', onDelete: 'CASCADE' });
  Impression.belongsTo(Campaign, { foreignKey: 'campaignId', as: 'campaign', onDelete: 'SET NULL' });

  // ShortLink associations
  ShortLink.belongsTo(User, { foreignKey: 'createdBy', as: 'creator', onDelete: 'SET NULL' });
  ShortLink.belongsTo(Campaign, { foreignKey: 'campaignId', as: 'campaign', onDelete: 'SET NULL' });
  ShortLink.hasMany(ShortLinkClick, { foreignKey: 'shortLinkId', as: 'clicks', onDelete: 'CASCADE' });
  ShortLinkClick.belongsTo(ShortLink, { foreignKey: 'shortLinkId', as: 'shortLink', onDelete: 'CASCADE' });
  // RoundRobinCursor has implicit relation to Campaign via campaignId (FK added in migration 014)

  // Vehicle associations
  Vehicle.belongsTo(Device, { foreignKey: 'masterDeviceId', as: 'masterDevice', onDelete: 'SET NULL' });
  Vehicle.belongsTo(Device, { foreignKey: 'slaveDeviceId', as: 'slaveDevice', onDelete: 'SET NULL' });
  Device.belongsTo(Vehicle, { foreignKey: 'vehicleId', as: 'vehicle', onDelete: 'SET NULL' });
  Vehicle.belongsToMany(Campaign, { through: VehicleCampaignAssignment, foreignKey: 'vehicleId', otherKey: 'campaignId', as: 'assignedCampaigns' });
  Campaign.belongsToMany(Vehicle, { through: VehicleCampaignAssignment, foreignKey: 'campaignId', otherKey: 'vehicleId', as: 'assignedVehicles' });

  // Webhook associations
  WebhookSubscriber.hasMany(WebhookDelivery, { foreignKey: 'subscriberId', as: 'deliveries', onDelete: 'SET NULL' });
  WebhookDelivery.belongsTo(WebhookSubscriber, { foreignKey: 'subscriberId', as: 'subscriber', onDelete: 'SET NULL' });

  // AgentGroup associations
  AgentGroup.belongsTo(User, { foreignKey: 'createdBy', as: 'creator', onDelete: 'RESTRICT' });
  User.hasMany(AgentGroup, { foreignKey: 'createdBy', as: 'agentGroups', onDelete: 'RESTRICT' });
  QrTag.belongsTo(AgentGroup, { foreignKey: 'agentGroupId', as: 'agentGroup', onDelete: 'SET NULL' });
  QrTag.belongsTo(User, { foreignKey: 'assignedAgentId', as: 'assignedAgent', onDelete: 'SET NULL' });

  // AgentGroupMember associations
  AgentGroup.hasMany(AgentGroupMember, { foreignKey: 'agentGroupId', as: 'members', onDelete: 'CASCADE' });
  AgentGroupMember.belongsTo(AgentGroup, { foreignKey: 'agentGroupId', as: 'group' });
  AgentGroupMember.belongsTo(User, { foreignKey: 'userId', as: 'user', onDelete: 'SET NULL' });
}

defineAssociations();

// Startup assertion: verify critical associations exist
const criticalAssociations = [
  ['Prospect', 'assignedAgent'],
  ['Prospect', 'campaign'],
  ['Prospect', 'qrTag'],
  ['Campaign', 'creator'],
  ['Campaign', 'assignedAgents'],
  ['QrTag', 'owner'],
  ['Commission', 'agent'],
  ['WebhookDelivery', 'subscriber'],
  ['Prospect', 'externalAgent'],
];

for (const [modelName, alias] of criticalAssociations) {
  if (!models[modelName]?.associations?.[alias]) {
    throw new Error(`Missing association: ${modelName}.${alias} -- model loading may be broken`);
  }
}

// Named exports (destructured from models object for backward compatibility)
export const {
  User, Campaign, Car, FleetOwner, Driver, Prospect, QrTag,
  Commission, LeadPackage, LeadPackageAssignment, CampaignPreview,
  QrScan, Attribution, SessionVisit, ProspectActivity, UserPayout,
  Device, BeaconEvent, Impression, IdempotencyKey, ShortLink,
  ShortLinkClick, RoundRobinCursor, Verification, ProvisioningSession,
  Vehicle, WebhookSubscriber, WebhookDelivery, AgentGroup,
  AgentGroupMember, DeviceCampaignAssignment, VehicleCampaignAssignment,
  CampaignMediaItem, CampaignAgentAssignment, ExternalAgent, ExternalCampaignAgent,
  WaitlistSignup
} = models;

export { sequelize };

export default { ...models, sequelize };
