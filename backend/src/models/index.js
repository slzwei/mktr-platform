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
    Commission, LeadPackage, LeadPackageAssignment, Payment, CampaignPreview,
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

  // Payment associations — immutable financial records. SET NULL on parent delete
  // (never cascade): a deleted agent/package/assignment must not erase a payment.
  User.hasMany(Payment, { foreignKey: 'agentId', as: 'payments', onDelete: 'SET NULL' });
  Payment.belongsTo(User, { foreignKey: 'agentId', as: 'agent', onDelete: 'SET NULL' });
  LeadPackage.hasMany(Payment, { foreignKey: 'leadPackageId', as: 'payments', onDelete: 'SET NULL' });
  Payment.belongsTo(LeadPackage, { foreignKey: 'leadPackageId', as: 'package', onDelete: 'SET NULL' });
  LeadPackageAssignment.hasOne(Payment, { foreignKey: 'leadPackageAssignmentId', as: 'payment', onDelete: 'SET NULL' });
  Payment.belongsTo(LeadPackageAssignment, { foreignKey: 'leadPackageAssignmentId', as: 'assignment', onDelete: 'SET NULL' });

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

  // Redeem Ops associations (docs/redeem-ops/ERD.md). Append-only history/audit
  // rows must survive actor deletion: SET NULL, never cascade from users.
  const {
    RedeemOpsAuditEvent, PartnerOrganisation, PartnerLocation, PartnerContact,
    PartnerAssignmentEvent, PartnerStageEvent, OutreachActivity,
  } = models;
  RedeemOpsAuditEvent.belongsTo(User, { foreignKey: 'actorUserId', as: 'actor', onDelete: 'SET NULL' });

  // Partner CRM (Phase 2)
  PartnerOrganisation.belongsTo(User, { foreignKey: 'ownerUserId', as: 'owner', onDelete: 'SET NULL' });
  PartnerOrganisation.belongsTo(User, { foreignKey: 'createdBy', as: 'creator', onDelete: 'RESTRICT' });
  PartnerOrganisation.belongsTo(PartnerOrganisation, { foreignKey: 'mergedIntoId', as: 'mergedInto', onDelete: 'SET NULL' });
  PartnerOrganisation.hasMany(PartnerLocation, { foreignKey: 'partnerOrganisationId', as: 'locations', onDelete: 'CASCADE' });
  PartnerLocation.belongsTo(PartnerOrganisation, { foreignKey: 'partnerOrganisationId', as: 'partner' });
  PartnerOrganisation.hasMany(PartnerContact, { foreignKey: 'partnerOrganisationId', as: 'contacts', onDelete: 'CASCADE' });
  PartnerContact.belongsTo(PartnerOrganisation, { foreignKey: 'partnerOrganisationId', as: 'partner' });
  PartnerOrganisation.hasMany(PartnerAssignmentEvent, { foreignKey: 'partnerOrganisationId', as: 'assignmentEvents', onDelete: 'CASCADE' });
  PartnerAssignmentEvent.belongsTo(PartnerOrganisation, { foreignKey: 'partnerOrganisationId', as: 'partner' });
  PartnerAssignmentEvent.belongsTo(User, { foreignKey: 'actorUserId', as: 'actor', onDelete: 'SET NULL' });
  PartnerAssignmentEvent.belongsTo(User, { foreignKey: 'fromUserId', as: 'fromUser', onDelete: 'SET NULL' });
  PartnerAssignmentEvent.belongsTo(User, { foreignKey: 'toUserId', as: 'toUser', onDelete: 'SET NULL' });
  PartnerOrganisation.hasMany(PartnerStageEvent, { foreignKey: 'partnerOrganisationId', as: 'stageEvents', onDelete: 'CASCADE' });
  PartnerStageEvent.belongsTo(PartnerOrganisation, { foreignKey: 'partnerOrganisationId', as: 'partner' });
  PartnerStageEvent.belongsTo(User, { foreignKey: 'actorUserId', as: 'actor', onDelete: 'SET NULL' });
  PartnerOrganisation.hasMany(OutreachActivity, { foreignKey: 'partnerOrganisationId', as: 'activities', onDelete: 'CASCADE' });
  OutreachActivity.belongsTo(PartnerOrganisation, { foreignKey: 'partnerOrganisationId', as: 'partner' });
  OutreachActivity.belongsTo(PartnerContact, { foreignKey: 'contactId', as: 'contact', onDelete: 'SET NULL' });
  OutreachActivity.belongsTo(User, { foreignKey: 'actorUserId', as: 'actor', onDelete: 'SET NULL' });

  // Rewards, onboarding, activations (Phases 4–5)
  const {
    RewardOffer, RewardTermsVersion, RewardOfferLocation, RewardInventoryEvent,
    PartnerOnboardingItem, Activation, DrawTermsVersion,
  } = models;
  // Lucky-draw T&C versions (docs/plans/lucky-draw-10x.md §4.6)
  Campaign.hasMany(DrawTermsVersion, { foreignKey: 'campaignId', as: 'drawTermsVersions', onDelete: 'CASCADE' });
  DrawTermsVersion.belongsTo(Campaign, { foreignKey: 'campaignId', as: 'campaign' });
  PartnerOrganisation.hasMany(RewardOffer, { foreignKey: 'partnerOrganisationId', as: 'rewardOffers', onDelete: 'RESTRICT' });
  RewardOffer.belongsTo(PartnerOrganisation, { foreignKey: 'partnerOrganisationId', as: 'partner', onDelete: 'RESTRICT' });
  RewardOffer.hasMany(RewardTermsVersion, { foreignKey: 'rewardOfferId', as: 'termsVersions', onDelete: 'CASCADE' });
  RewardTermsVersion.belongsTo(RewardOffer, { foreignKey: 'rewardOfferId', as: 'offer' });
  RewardOffer.hasMany(RewardOfferLocation, { foreignKey: 'rewardOfferId', as: 'offerLocations', onDelete: 'CASCADE' });
  RewardOfferLocation.belongsTo(RewardOffer, { foreignKey: 'rewardOfferId', as: 'offer' });
  RewardOfferLocation.belongsTo(PartnerLocation, { foreignKey: 'partnerLocationId', as: 'location', onDelete: 'CASCADE' });
  RewardOffer.hasMany(RewardInventoryEvent, { foreignKey: 'rewardOfferId', as: 'inventoryEvents', onDelete: 'RESTRICT' });
  RewardInventoryEvent.belongsTo(RewardOffer, { foreignKey: 'rewardOfferId', as: 'offer' });
  RewardInventoryEvent.belongsTo(User, { foreignKey: 'actorUserId', as: 'actor', onDelete: 'SET NULL' });
  PartnerOrganisation.hasMany(PartnerOnboardingItem, { foreignKey: 'partnerOrganisationId', as: 'onboardingItems', onDelete: 'CASCADE' });
  PartnerOnboardingItem.belongsTo(PartnerOrganisation, { foreignKey: 'partnerOrganisationId', as: 'partner' });
  PartnerOnboardingItem.belongsTo(User, { foreignKey: 'assigneeUserId', as: 'assignee', onDelete: 'SET NULL' });
  PartnerOrganisation.hasMany(Activation, { foreignKey: 'partnerOrganisationId', as: 'activations', onDelete: 'RESTRICT' });
  Activation.belongsTo(PartnerOrganisation, { foreignKey: 'partnerOrganisationId', as: 'partner', onDelete: 'RESTRICT' });
  RewardOffer.hasMany(Activation, { foreignKey: 'rewardOfferId', as: 'activations', onDelete: 'RESTRICT' });
  Activation.belongsTo(RewardOffer, { foreignKey: 'rewardOfferId', as: 'rewardOffer', onDelete: 'RESTRICT' });
  Activation.belongsTo(Campaign, { foreignKey: 'campaignId', as: 'campaign', onDelete: 'SET NULL' });

  // Fulfilment (Phase 6) — entitlement references the canonical MKTR lead by FK
  // (SET NULL on lead delete; no PII copies). History tables are append-only.
  const { RewardEntitlement, Redemption, RedemptionEvent } = models;
  RewardEntitlement.belongsTo(RewardOffer, { foreignKey: 'rewardOfferId', as: 'rewardOffer', onDelete: 'RESTRICT' });
  RewardEntitlement.belongsTo(Activation, { foreignKey: 'activationId', as: 'activation', onDelete: 'RESTRICT' });
  RewardEntitlement.belongsTo(Prospect, { foreignKey: 'prospectId', as: 'prospect', onDelete: 'SET NULL' });
  RewardEntitlement.belongsTo(User, { foreignKey: 'unlockedByUserId', as: 'unlockedBy', onDelete: 'SET NULL' });
  Activation.hasMany(RewardEntitlement, { foreignKey: 'activationId', as: 'entitlements', onDelete: 'RESTRICT' });
  Redemption.belongsTo(RewardEntitlement, { foreignKey: 'entitlementId', as: 'entitlement', onDelete: 'RESTRICT' });
  Redemption.belongsTo(RewardOffer, { foreignKey: 'rewardOfferId', as: 'rewardOffer', onDelete: 'RESTRICT' });
  Redemption.belongsTo(Activation, { foreignKey: 'activationId', as: 'activation', onDelete: 'RESTRICT' });
  Redemption.belongsTo(PartnerOrganisation, { foreignKey: 'partnerOrganisationId', as: 'partner', onDelete: 'RESTRICT' });
  Redemption.belongsTo(PartnerLocation, { foreignKey: 'locationId', as: 'location', onDelete: 'SET NULL' });
  Redemption.belongsTo(User, { foreignKey: 'actorUserId', as: 'actor', onDelete: 'SET NULL' });
  RedemptionEvent.belongsTo(RewardEntitlement, { foreignKey: 'entitlementId', as: 'entitlement', onDelete: 'CASCADE' });
  RedemptionEvent.belongsTo(Redemption, { foreignKey: 'redemptionId', as: 'redemption', onDelete: 'CASCADE' });

  // Lucky-draw ledger (docs/plans/lucky-draw-10x.md §4.3)
  const { Draw, DrawEntry, DrawAttempt, DrawBoostReview } = models;
  Campaign.hasMany(Draw, { foreignKey: 'campaignId', as: 'draws', onDelete: 'RESTRICT' });
  Draw.belongsTo(Campaign, { foreignKey: 'campaignId', as: 'campaign' });
  Draw.belongsTo(Activation, { foreignKey: 'activationId', as: 'activation', onDelete: 'RESTRICT' });
  Draw.belongsTo(DrawTermsVersion, { foreignKey: 'termsVersionId', as: 'termsVersion', onDelete: 'RESTRICT' });
  Draw.hasMany(DrawEntry, { foreignKey: 'drawId', as: 'entries', onDelete: 'CASCADE' });
  DrawEntry.belongsTo(Draw, { foreignKey: 'drawId', as: 'draw' });
  DrawEntry.belongsTo(Prospect, { foreignKey: 'prospectId', as: 'prospect', onDelete: 'SET NULL' });
  Draw.hasMany(DrawAttempt, { foreignKey: 'drawId', as: 'attempts', onDelete: 'CASCADE' });
  DrawAttempt.belongsTo(Draw, { foreignKey: 'drawId', as: 'draw' });
  DrawAttempt.belongsTo(DrawEntry, { foreignKey: 'pickedEntryId', as: 'pickedEntry', onDelete: 'RESTRICT' });
  Draw.hasMany(DrawBoostReview, { foreignKey: 'drawId', as: 'boostReviews', onDelete: 'CASCADE' });
  DrawBoostReview.belongsTo(Draw, { foreignKey: 'drawId', as: 'draw' });
  DrawBoostReview.belongsTo(RewardEntitlement, { foreignKey: 'entitlementId', as: 'entitlement', onDelete: 'RESTRICT' });

  // Outreach work (Phase 3)
  const { OutreachTask, ProspectingPool, ProspectingPoolMember } = models;
  PartnerOrganisation.hasMany(OutreachTask, { foreignKey: 'partnerOrganisationId', as: 'tasks', onDelete: 'CASCADE' });
  OutreachTask.belongsTo(PartnerOrganisation, { foreignKey: 'partnerOrganisationId', as: 'partner' });
  OutreachTask.belongsTo(PartnerContact, { foreignKey: 'contactId', as: 'contact', onDelete: 'SET NULL' });
  OutreachTask.belongsTo(User, { foreignKey: 'assigneeUserId', as: 'assignee', onDelete: 'CASCADE' });
  OutreachTask.belongsTo(User, { foreignKey: 'createdBy', as: 'creator', onDelete: 'RESTRICT' });
  ProspectingPool.hasMany(ProspectingPoolMember, { foreignKey: 'poolId', as: 'members', onDelete: 'CASCADE' });
  ProspectingPoolMember.belongsTo(ProspectingPool, { foreignKey: 'poolId', as: 'pool' });
  ProspectingPoolMember.belongsTo(PartnerOrganisation, { foreignKey: 'partnerOrganisationId', as: 'partner', onDelete: 'CASCADE' });

  // Discover tool (migration 053)
  const { DiscoveryRun, DiscoveryCandidate, DiscoveryPlaceMemory } = models;
  DiscoveryRun.belongsTo(User, { foreignKey: 'createdBy', as: 'creator', onDelete: 'CASCADE' });
  DiscoveryRun.hasMany(DiscoveryCandidate, { foreignKey: 'discoveryRunId', as: 'candidates', onDelete: 'CASCADE' });
  DiscoveryCandidate.belongsTo(DiscoveryRun, { foreignKey: 'discoveryRunId', as: 'run' });
  DiscoveryCandidate.belongsTo(PartnerOrganisation, { foreignKey: 'matchedPartnerId', as: 'matchedPartner', onDelete: 'SET NULL' });
  DiscoveryCandidate.belongsTo(PartnerOrganisation, { foreignKey: 'addedPartnerId', as: 'addedPartner', onDelete: 'SET NULL' });
  DiscoveryPlaceMemory.belongsTo(PartnerOrganisation, { foreignKey: 'addedPartnerId', as: 'addedPartner', onDelete: 'SET NULL' });

  // Cadences (migration 057, docs/plans/redeem-ops-cadences.md §4). Definition
  // rows are never deleted (retired instead), so history references RESTRICT.
  const {
    OutreachCadence, OutreachCadenceStep, OutreachCadenceTransition, OutreachCadenceEnrollment,
  } = models;
  OutreachCadence.belongsTo(User, { foreignKey: 'createdBy', as: 'creator', onDelete: 'RESTRICT' });
  OutreachCadence.hasMany(OutreachCadenceStep, { foreignKey: 'cadenceId', as: 'steps', onDelete: 'RESTRICT' });
  OutreachCadenceStep.belongsTo(OutreachCadence, { foreignKey: 'cadenceId', as: 'cadence' });
  OutreachCadence.hasMany(OutreachCadenceTransition, { foreignKey: 'cadenceId', as: 'transitions', onDelete: 'RESTRICT' });
  OutreachCadenceTransition.belongsTo(OutreachCadence, { foreignKey: 'cadenceId', as: 'cadence' });
  OutreachCadenceTransition.belongsTo(OutreachCadenceStep, { foreignKey: 'fromStepId', as: 'fromStep', onDelete: 'RESTRICT' });
  OutreachCadenceTransition.belongsTo(OutreachCadenceStep, { foreignKey: 'toStepId', as: 'toStep', onDelete: 'RESTRICT' });
  OutreachCadenceEnrollment.belongsTo(OutreachCadence, { foreignKey: 'cadenceId', as: 'cadence', onDelete: 'RESTRICT' });
  OutreachCadenceEnrollment.belongsTo(PartnerOrganisation, { foreignKey: 'partnerOrganisationId', as: 'partner', onDelete: 'CASCADE' });
  PartnerOrganisation.hasMany(OutreachCadenceEnrollment, { foreignKey: 'partnerOrganisationId', as: 'cadenceEnrollments', onDelete: 'CASCADE' });
  OutreachCadenceEnrollment.belongsTo(OutreachCadenceStep, { foreignKey: 'currentStepId', as: 'currentStep', onDelete: 'RESTRICT' });
  OutreachCadenceEnrollment.belongsTo(User, { foreignKey: 'enrolledBy', as: 'enrolledByUser', onDelete: 'RESTRICT' });
  OutreachTask.belongsTo(OutreachCadenceEnrollment, { foreignKey: 'cadenceEnrollmentId', as: 'cadenceEnrollment' });
  OutreachTask.belongsTo(OutreachCadenceStep, { foreignKey: 'cadenceStepId', as: 'cadenceStep' });
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
  Commission, LeadPackage, LeadPackageAssignment, Payment, CampaignPreview,
  QrScan, Attribution, SessionVisit, ProspectActivity, UserPayout,
  Device, BeaconEvent, Impression, IdempotencyKey, ShortLink,
  ShortLinkClick, RoundRobinCursor, Verification, ProvisioningSession,
  Vehicle, WebhookSubscriber, WebhookDelivery, AgentGroup,
  AgentGroupMember, DeviceCampaignAssignment, VehicleCampaignAssignment,
  CampaignMediaItem, CampaignAgentAssignment, ExternalAgent, ExternalCampaignAgent,
  WaitlistSignup, RedeemOpsAuditEvent, PartnerOrganisation, PartnerLocation,
  PartnerContact, PartnerAssignmentEvent, PartnerStageEvent, OutreachActivity,
  OutreachTask, ProspectingPool, ProspectingPoolMember, RewardOffer,
  RewardTermsVersion, DrawTermsVersion, Draw, DrawEntry, DrawAttempt,
  DrawBoostReview, RewardOfferLocation, RewardInventoryEvent,
  PartnerOnboardingItem, Activation, RewardEntitlement, Redemption,
  RedemptionEvent, RedeemOpsCategory, DiscoveryRun, DiscoveryCandidate,
  DiscoveryPlaceMemory, OutreachCadence, OutreachCadenceStep,
  OutreachCadenceTransition, OutreachCadenceEnrollment, OutreachSuppression
} = models;

export { sequelize };

export default { ...models, sequelize };
