/**
 * Seed script for QR Assignment Mode testing.
 *
 * Creates:
 *   1. Campaign: "QR Assignment Test"
 *   2. Agent Group: "Test RR Group" with 2 agents picked from existing users
 *   3. QR #1 — Direct → Agent A
 *   4. QR #2 — Direct → Agent B
 *   5. QR #3 — Round Robin → Agent Group (Agent B + Agent C)
 *
 * Usage:
 *   node backend/src/database/seed/qrAssignmentTest.js
 *
 * Cleanup:
 *   node backend/src/database/seed/qrAssignmentTest.js --cleanup
 */

import { sequelize } from '../connection.js';
import { User, Campaign, QrTag, AgentGroup } from '../../models/index.js';
import { createQrCode } from '../../services/qrCodeService.js';

const TEST_CAMPAIGN_NAME = 'QR Assignment Test';
const TEST_GROUP_NAME = 'Test RR Group';
const TEST_AGENT_EMAILS = [
  'testagent.a@mktr.local',
  'testagent.b@mktr.local',
  'testagent.c@mktr.local'
];

async function cleanup() {
  await sequelize.sync({ force: false });

  // Delete QR tags tied to the test campaign
  const campaign = await Campaign.findOne({ where: { name: TEST_CAMPAIGN_NAME } });
  if (campaign) {
    const deleted = await QrTag.destroy({ where: { campaignId: campaign.id } });
    console.log(`Deleted ${deleted} test QR tags`);
    await campaign.destroy();
    console.log('Deleted test campaign');
  }

  const group = await AgentGroup.findOne({ where: { name: TEST_GROUP_NAME } });
  if (group) {
    await group.destroy();
    console.log('Deleted test agent group');
  }

  // Delete test agents
  const { Op } = await import('sequelize');
  const deletedAgents = await User.destroy({ where: { email: { [Op.in]: TEST_AGENT_EMAILS } } });
  if (deletedAgents > 0) console.log(`Deleted ${deletedAgents} test agents`);

  console.log('Cleanup done');
}

async function seed() {
  await sequelize.sync({ force: false });

  // --- Create 3 test agents with phone numbers ---
  const testAgentData = [
    { firstName: 'Test', lastName: 'Agent A', email: TEST_AGENT_EMAILS[0], phone: '+6591111111', role: 'agent', isActive: true, emailVerified: true, password: 'testpass123' },
    { firstName: 'Test', lastName: 'Agent B', email: TEST_AGENT_EMAILS[1], phone: '+6592222222', role: 'agent', isActive: true, emailVerified: true, password: 'testpass123' },
    { firstName: 'Test', lastName: 'Agent C', email: TEST_AGENT_EMAILS[2], phone: '+6593333333', role: 'agent', isActive: true, emailVerified: true, password: 'testpass123' }
  ];

  const agents = [];
  for (const data of testAgentData) {
    const [agent] = await User.findOrCreate({
      where: { email: data.email },
      defaults: data
    });
    agents.push(agent);
    console.log(`Agent: ${agent.firstName} ${agent.lastName} — ${agent.phone}`);
  }

  const [agentA, agentB, agentC] = agents;
  console.log('Agent A:', agentA.firstName, agentA.lastName, '—', agentA.phone || agentA.email);
  console.log('Agent B:', agentB.firstName, agentB.lastName, '—', agentB.phone || agentB.email);
  console.log('Agent C:', agentC.firstName, agentC.lastName, '—', agentC.phone || agentC.email);

  // --- Find admin user for createdBy ---
  const admin = await User.findOne({ where: { role: 'admin', isActive: true } });
  if (!admin) {
    console.error('No active admin user found');
    process.exit(1);
  }

  // --- Create Campaign ---
  const [campaign] = await Campaign.findOrCreate({
    where: { name: TEST_CAMPAIGN_NAME },
    defaults: {
      name: TEST_CAMPAIGN_NAME,
      description: 'Test campaign for QR direct vs round-robin assignment',
      status: 'active',
      type: 'lead_generation',
      is_active: true,
      defaultAssignmentMode: 'direct',
      createdBy: admin.id
    }
  });
  console.log('\nCampaign:', campaign.name, '(', campaign.id, ')');

  // --- Create Agent Group (Agent B + Agent C) ---
  const groupAgents = [
    { phone: agentB.phone, email: agentB.email, name: `${agentB.firstName} ${agentB.lastName}`.trim() },
    { phone: agentC.phone, email: agentC.email, name: `${agentC.firstName} ${agentC.lastName}`.trim() }
  ];

  const [group] = await AgentGroup.findOrCreate({
    where: { name: TEST_GROUP_NAME },
    defaults: {
      name: TEST_GROUP_NAME,
      description: 'Agent B + Agent C for round-robin testing',
      agents: groupAgents,
      agentCount: groupAgents.length,
      createdBy: admin.id
    }
  });
  console.log('Agent Group:', group.name, '(', group.id, ')');

  // --- Create QR #1: Direct → Agent A ---
  const { qrTag: qr1 } = await createQrCode({
    label: 'Test Direct - Agent A',
    type: 'promotional',
    campaignId: campaign.id,
    agentAssignmentMode: 'direct',
    assignedAgentPhone: agentA.phone,
    assignedAgentEmail: agentA.email,
    assignedAgentName: `${agentA.firstName} ${agentA.lastName}`.trim()
  }, admin);
  console.log(`\nQR #1 (Direct → Agent A): /t/${qr1.slug}`);

  // --- Create QR #2: Direct → Agent B ---
  const { qrTag: qr2 } = await createQrCode({
    label: 'Test Direct - Agent B',
    type: 'promotional',
    campaignId: campaign.id,
    agentAssignmentMode: 'direct',
    assignedAgentPhone: agentB.phone,
    assignedAgentEmail: agentB.email,
    assignedAgentName: `${agentB.firstName} ${agentB.lastName}`.trim()
  }, admin);
  console.log(`QR #2 (Direct → Agent B): /t/${qr2.slug}`);

  // --- Create QR #3: Round Robin → Group (Agent B + Agent C) ---
  const agentPhones = groupAgents.map(a => a.phone);
  const { qrTag: qr3 } = await createQrCode({
    label: 'Test Round Robin - Group',
    type: 'promotional',
    campaignId: campaign.id,
    agentAssignmentMode: 'round_robin',
    agentGroupId: group.id,
    agentGroupAgentIds: agentPhones
  }, admin);
  console.log(`QR #3 (Round Robin → B+C): /t/${qr3.slug}`);

  // --- Print test URLs ---
  const base = process.env.PUBLIC_BASE_URL || 'https://mktr.sg';
  console.log('\n--- Test URLs ---');
  console.log(`QR #1 (→ Agent A):     ${base}/t/${qr1.slug}`);
  console.log(`QR #2 (→ Agent B):     ${base}/t/${qr2.slug}`);
  console.log(`QR #3 (→ B or C RR):   ${base}/t/${qr3.slug}`);
  console.log('\n--- Cleanup later ---');
  console.log('node backend/src/database/seed/qrAssignmentTest.js --cleanup');
}

// --- Entry point ---
const isCleanup = process.argv.includes('--cleanup');
(isCleanup ? cleanup() : seed())
  .then(() => process.exit(0))
  .catch(err => { console.error(err); process.exit(1); });
