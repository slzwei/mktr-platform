import express from 'express';
import jwt from 'jsonwebtoken';
import { init } from '../src/server_internal.js';
import { sequelize } from '../src/database/connection.js';
import { User, Campaign, Commission, Prospect, FleetOwner, Car, QrTag, AgentGroup, AgentGroupMember, Attribution, QrScan, LeadPackage, LeadPackageAssignment, RedeemOpsCategory } from '../src/models/index.js';

const JWT_SECRET = process.env.JWT_SECRET;
let _app = null;

/**
 * Get or create the shared Express app instance.
 * Initializes once; subsequent calls return cached instance.
 */
export async function getApp() {
  if (_app) return _app;
  _app = express();
  await init(_app);
  return _app;
}

/**
 * Close DB connection. Call in afterAll().
 */
export async function closeDb() {
  await sequelize.close();
}

/**
 * Create a JWT token for a given user ID.
 */
export function makeToken(userId, expiresIn = '1h') {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn });
}

// ---- Factories ----

let _counter = 0;
function uid() { return ++_counter; }

/**
 * Create a test user and return { user, token }.
 */
export async function createTestUser(overrides = {}) {
  const n = uid();
  const user = await User.create({
    email: `test-user-${n}-${Date.now()}@test.com`,
    firstName: overrides.firstName || `Test${n}`,
    lastName: overrides.lastName || 'User',
    role: overrides.role || 'admin',
    isActive: true,
    emailVerified: true,
    password: 'TestPassword123!',
    ...overrides
  });
  const token = makeToken(user.id);
  return { user, token };
}

/**
 * Create a test campaign owned by userId.
 */
export async function createTestCampaign(userId, overrides = {}) {
  return Campaign.create({
    name: overrides.name || `Test Campaign ${uid()}`,
    createdBy: userId,
    status: overrides.status || 'active',
    type: overrides.type || 'lead_generation',
    is_active: true,
    min_age: 18,
    max_age: 65,
    ...overrides
  });
}

/**
 * Create a test prospect for a campaign.
 */
export async function createTestProspect(campaignId, overrides = {}) {
  const n = uid();
  return Prospect.create({
    firstName: overrides.firstName || `Prospect${n}`,
    lastName: overrides.lastName || 'Test',
    email: overrides.email || `prospect-${n}-${Date.now()}@test.com`,
    // Include the monotonic uid (n) so rapid back-to-back calls don't collide on
    // the same Date.now() millisecond — prospects has a unique (campaignId, phone)
    // index, so two same-campaign prospects with an identical phone would throw.
    phone: overrides.phone || `+65${String(Date.now() + n).slice(-8)}`,
    campaignId,
    leadStatus: overrides.leadStatus || 'new',
    leadSource: overrides.leadSource || 'qr_code',
    ...overrides
  });
}

/**
 * Create a test commission for an agent and campaign.
 */
export async function createTestCommission(agentId, campaignId, overrides = {}) {
  return Commission.create({
    agentId,
    campaignId,
    amount: overrides.amount || 50.00,
    type: overrides.type || 'conversion',
    status: overrides.status || 'pending',
    description: overrides.description || 'Test commission',
    earnedDate: overrides.earnedDate || new Date(),
    ...overrides
  });
}

/**
 * Create a test fleet owner.
 */
export async function createTestFleetOwner(overrides = {}) {
  const n = uid();
  return FleetOwner.create({
    full_name: overrides.full_name || `Fleet Owner ${n}`,
    email: overrides.email || `fleet-${n}-${Date.now()}@test.com`,
    phone: overrides.phone || `8${String(Date.now()).slice(-7)}`,
    company_name: overrides.company_name || `Fleet Co ${n}`,
    ...overrides
  });
}

/**
 * Create a test QR tag for a campaign.
 */
export async function createTestQrTag(campaignId, ownerUserId, overrides = {}) {
  const n = uid();
  return QrTag.create({
    slug: `test-${n}-${Date.now()}`,
    label: overrides.label || `Test QR ${n}`,
    type: overrides.type || 'promotional',
    campaignId,
    ownerUserId,
    active: true,
    agentAssignmentMode: overrides.agentAssignmentMode || 'direct',
    assignedAgentPhone: overrides.assignedAgentPhone || null,
    assignedAgentEmail: overrides.assignedAgentEmail || null,
    assignedAgentName: overrides.assignedAgentName || null,
    agentGroupId: overrides.agentGroupId || null,
    roundRobinIndex: overrides.roundRobinIndex || 0,
    ...overrides
  });
}

/**
 * Create a test agent group.
 */
export async function createTestAgentGroup(createdBy, agents = [], overrides = {}) {
  const n = uid();
  const group = await AgentGroup.create({
    name: overrides.name || `Test Group ${n}`,
    description: overrides.description || 'Test agent group',
    createdBy,
    ...overrides
  });

  // Create member rows in the join table
  for (let i = 0; i < agents.length; i++) {
    const a = agents[i];
    if (!a.phone) continue;
    await AgentGroupMember.create({
      agentGroupId: group.id,
      phone: a.phone,
      email: a.email || null,
      name: a.name || null,
      lyfeId: a.lyfeId || null,
      sortOrder: i
    });
  }

  return group;
}

/**
 * Create a test car belonging to a fleet owner.
 */
export async function createTestCar(fleetOwnerId, overrides = {}) {
  const n = uid();
  return Car.create({
    make: overrides.make || 'Toyota',
    model: overrides.model || `Camry-${n}`,
    year: overrides.year || 2023,
    plate_number: overrides.plate_number || `TEST${n}${Date.now().toString().slice(-4)}`,
    type: overrides.type || 'sedan',
    status: overrides.status || 'active',
    fleet_owner_id: fleetOwnerId,
    ...overrides
  });
}

/**
 * Create a test attribution record linked to a QR tag and session.
 * Requires a QrScan to exist (creates one automatically).
 */
export async function createTestAttribution(qrTagId, sessionId, overrides = {}) {
  // Create a QrScan first (Attribution requires qrScanId FK)
  const scan = await QrScan.create({
    qrTagId,
    ipHash: overrides.ipHash || 'testhash' + Date.now(),
    ts: new Date(),
    ua: 'test-agent',
    botFlag: false,
    isDuplicate: false
  });

  return Attribution.create({
    qrTagId,
    qrScanId: scan.id,
    sessionId,
    firstTouch: true,
    lastTouchAt: new Date(),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    usedOnce: false,
    ...overrides
  });
}

/**
 * Create a test lead package for a campaign.
 */
export async function createTestLeadPackage(campaignId, createdBy, overrides = {}) {
  const n = uid();
  return LeadPackage.create({
    name: overrides.name || `Test Package ${n}`,
    type: overrides.type || 'basic',
    price: overrides.price || 100.00,
    leadCount: overrides.leadCount || 50,
    status: overrides.status || 'active',
    campaignId,
    createdBy,
    ...overrides
  });
}

/**
 * Create a test lead package assignment for an agent.
 */
export async function createTestLeadPackageAssignment(agentId, packageId, overrides = {}) {
  return LeadPackageAssignment.create({
    agentId,
    leadPackageId: packageId,
    status: overrides.status || 'active',
    leadsRemaining: overrides.leadsRemaining ?? 10,
    leadsTotal: overrides.leadsTotal ?? 50,
    priceSnapshot: overrides.priceSnapshot || 100.00,
    purchaseDate: overrides.purchaseDate || new Date(),
    ...overrides
  });
}

/**
 * Seed a Redeem Ops category (migration 052 taxonomy). Category writes are now
 * validated against this table, so any test that creates a partner/pool/reward
 * with a category must seed it first. Idempotent (case-insensitive).
 */
export async function seedRedeemOpsCategory(name, overrides = {}) {
  const [category] = await RedeemOpsCategory.findOrCreate({
    where: { name },
    defaults: { name, isActive: true, ...overrides },
  });
  return category;
}
