#!/usr/bin/env node

/**
 * Stress Test - Lead Generation Script
 * 
 * Generates realistic test prospects (leads) for stress testing the system.
 * All test data is tagged with "STRESS_TEST" for safe identification and cleanup.
 * 
 * Usage:
 *   node stress-test-leads.js [count] [batchSize]
 * 
 * Examples:
 *   node stress-test-leads.js          # Generate 500 leads (default)
 *   node stress-test-leads.js 1000     # Generate 1000 leads
 *   node stress-test-leads.js 2000 100 # Generate 2000 leads, 100 per batch
 */

import { sequelize } from './src/database/connection.js';
import Prospect from './src/models/Prospect.js';
import ProspectActivity from './src/models/ProspectActivity.js';
import Campaign from './src/models/Campaign.js';
import User from './src/models/User.js';
import QrTag from './src/models/QrTag.js';

// ============================================================================
// REALISTIC TEST DATA
// ============================================================================

const FIRST_NAMES = [
  'James', 'Mary', 'John', 'Patricia', 'Robert', 'Jennifer', 'Michael', 'Linda',
  'William', 'Barbara', 'David', 'Elizabeth', 'Richard', 'Susan', 'Joseph', 'Jessica',
  'Thomas', 'Sarah', 'Charles', 'Karen', 'Christopher', 'Nancy', 'Daniel', 'Lisa',
  'Matthew', 'Betty', 'Anthony', 'Margaret', 'Mark', 'Sandra', 'Donald', 'Ashley',
  'Steven', 'Kimberly', 'Paul', 'Emily', 'Andrew', 'Donna', 'Joshua', 'Michelle',
  'Kenneth', 'Dorothy', 'Kevin', 'Carol', 'Brian', 'Amanda', 'George', 'Melissa',
  'Edward', 'Deborah', 'Ronald', 'Stephanie', 'Timothy', 'Rebecca', 'Jason', 'Sharon',
  'Jeffrey', 'Laura', 'Ryan', 'Cynthia', 'Jacob', 'Kathleen', 'Gary', 'Amy',
  'Nicholas', 'Angela', 'Eric', 'Shirley', 'Jonathan', 'Anna', 'Stephen', 'Brenda'
];

const LAST_NAMES = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis',
  'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson', 'Thomas',
  'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson', 'White',
  'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson', 'Walker', 'Young',
  'Allen', 'King', 'Wright', 'Scott', 'Torres', 'Nguyen', 'Hill', 'Flores',
  'Green', 'Adams', 'Nelson', 'Baker', 'Hall', 'Rivera', 'Campbell', 'Mitchell',
  'Carter', 'Roberts', 'Gomez', 'Phillips', 'Evans', 'Turner', 'Diaz', 'Parker',
  'Cruz', 'Edwards', 'Collins', 'Reyes', 'Stewart', 'Morris', 'Morales', 'Murphy'
];

const COMPANIES = [
  'Acme Corporation', 'TechStart Inc', 'Global Solutions LLC', 'Innovation Partners',
  'NextGen Enterprises', 'Digital Dynamics', 'Prime Industries', 'Apex Systems',
  'Vertex Group', 'Summit Solutions', 'Fusion Technologies', 'Horizon Corp',
  'Quantum Systems', 'Stellar Enterprises', 'Metro Group', 'Coastal Partners',
  'Pioneer Industries', 'Crystal Clear Solutions', 'Rapid Growth Inc', 'Elite Services',
  'United Ventures', 'Pacific Solutions', 'Atlantic Corporation', 'Mountain View LLC',
  'Sunrise Enterprises', 'Sunset Industries', 'Riverstone Group', 'Oakwood Partners',
  'Redwood Corporation', 'Silverline Solutions', 'Goldstar Enterprises', 'Blueprint Inc',
  'Catalyst Group', 'Dynasty Corporation', 'Empire Solutions', 'Foundation Partners',
  'Gateway Industries', 'Harmony Enterprises', 'Infinity Group', 'Keystone Corp'
];

const JOB_TITLES = [
  'Chief Executive Officer', 'Chief Technology Officer', 'Chief Marketing Officer',
  'Vice President of Sales', 'Vice President of Operations', 'Director of Marketing',
  'Marketing Manager', 'Sales Manager', 'Product Manager', 'Project Manager',
  'Business Development Manager', 'Account Executive', 'Sales Representative',
  'Marketing Specialist', 'Digital Marketing Manager', 'Content Marketing Manager',
  'SEO Specialist', 'Social Media Manager', 'Brand Manager', 'Growth Hacker',
  'Operations Manager', 'General Manager', 'Regional Manager', 'District Manager',
  'Human Resources Manager', 'Financial Controller', 'Business Analyst', 'Data Analyst',
  'Customer Success Manager', 'Account Manager', 'Partnership Manager', 'Strategy Director'
];

const INDUSTRIES = [
  'Technology', 'Healthcare', 'Finance', 'Insurance', 'Real Estate', 'Retail',
  'E-commerce', 'Manufacturing', 'Consulting', 'Education', 'Automotive',
  'Telecommunications', 'Media', 'Entertainment', 'Hospitality', 'Transportation',
  'Logistics', 'Energy', 'Construction', 'Professional Services', 'Legal',
  'Advertising', 'Marketing', 'Software', 'Hardware', 'Biotechnology', 'Pharmaceutical'
];

const LEAD_SOURCES = ['qr_code', 'website', 'referral', 'social_media', 'advertisement', 'direct', 'other'];
const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'proposal_sent', 'negotiating', 'won', 'lost', 'nurturing'];
const PRIORITIES = ['low', 'medium', 'high', 'urgent'];

const CITIES = [
  { city: 'New York', state: 'NY', zip: '10001' },
  { city: 'Los Angeles', state: 'CA', zip: '90001' },
  { city: 'Chicago', state: 'IL', zip: '60601' },
  { city: 'Houston', state: 'TX', zip: '77001' },
  { city: 'Phoenix', state: 'AZ', zip: '85001' },
  { city: 'Philadelphia', state: 'PA', zip: '19101' },
  { city: 'San Antonio', state: 'TX', zip: '78201' },
  { city: 'San Diego', state: 'CA', zip: '92101' },
  { city: 'Dallas', state: 'TX', zip: '75201' },
  { city: 'San Jose', state: 'CA', zip: '95101' },
  { city: 'Austin', state: 'TX', zip: '78701' },
  { city: 'Jacksonville', state: 'FL', zip: '32099' },
  { city: 'San Francisco', state: 'CA', zip: '94101' },
  { city: 'Columbus', state: 'OH', zip: '43004' },
  { city: 'Indianapolis', state: 'IN', zip: '46201' },
  { city: 'Charlotte', state: 'NC', zip: '28201' },
  { city: 'Seattle', state: 'WA', zip: '98101' },
  { city: 'Denver', state: 'CO', zip: '80201' },
  { city: 'Boston', state: 'MA', zip: '02101' },
  { city: 'Portland', state: 'OR', zip: '97201' }
];

const INTERESTS = [
  'Product Demo', 'Pricing Information', 'Free Trial', 'Enterprise Solution',
  'Integration Options', 'Custom Development', 'Support Plans', 'Training',
  'Consultation', 'Partnership Opportunities', 'Bulk Discount', 'ROI Analysis'
];

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function randomItem(array) {
  return array[Math.floor(Math.random() * array.length)];
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomBool(probability = 0.5) {
  return Math.random() < probability;
}

function generatePhone() {
  const areaCode = randomInt(200, 999);
  const prefix = randomInt(200, 999);
  const lineNumber = randomInt(1000, 9999);
  return `${areaCode}-${prefix}-${lineNumber}`;
}

function generateEmail(firstName, lastName, company) {
  const domain = company.toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[^a-z0-9]/g, '')
    .substring(0, 15);
  const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}@${domain}.com`;
  return email;
}

function generateProspect(campaignIds, agentIds, qrTagIds) {
  const firstName = randomItem(FIRST_NAMES);
  const lastName = randomItem(LAST_NAMES);
  const company = randomItem(COMPANIES);
  const location = randomItem(CITIES);
  
  const prospect = {
    firstName,
    lastName,
    email: generateEmail(firstName, lastName, company),
    phone: randomBool(0.9) ? generatePhone() : null,
    company: randomBool(0.85) ? company : null,
    jobTitle: randomBool(0.8) ? randomItem(JOB_TITLES) : null,
    industry: randomBool(0.75) ? randomItem(INDUSTRIES) : null,
    leadSource: randomItem(LEAD_SOURCES),
    leadStatus: randomItem(LEAD_STATUSES),
    priority: randomItem(PRIORITIES),
    score: randomBool(0.7) ? randomInt(0, 100) : null,
    interests: randomBool(0.6) ? [randomItem(INTERESTS), randomItem(INTERESTS)] : [],
    tags: ['STRESS_TEST'], // Critical: All test data tagged
    notes: randomBool(0.4) ? `Test prospect generated at ${new Date().toISOString()}` : null,
    campaignId: randomBool(0.8) && campaignIds.length > 0 ? randomItem(campaignIds) : null,
    assignedAgentId: randomBool(0.6) && agentIds.length > 0 ? randomItem(agentIds) : null,
    qrTagId: randomBool(0.5) && qrTagIds.length > 0 ? randomItem(qrTagIds) : null,
    location: {
      city: location.city,
      state: location.state,
      zipCode: location.zip,
      country: 'US'
    },
    budget: randomBool(0.5) ? {
      min: randomInt(1000, 10000),
      max: randomInt(10000, 100000),
      currency: 'USD',
      timeframe: randomItem(['monthly', 'quarterly', 'annually'])
    } : null,
    demographics: randomBool(0.3) ? {
      age: randomInt(25, 65),
      gender: randomItem(['male', 'female', 'other']),
      income: randomItem(['50k-75k', '75k-100k', '100k-150k', '150k+']),
      education: randomItem(['High School', 'Bachelor', 'Master', 'PhD'])
    } : null,
    preferences: {
      contactMethod: randomItem(['email', 'phone', 'text']),
      language: 'en',
      timezone: randomItem(['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles'])
    }
  };

  return prospect;
}

function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  
  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }
  return `${seconds}s`;
}

function formatNumber(num) {
  return num.toLocaleString();
}

// ============================================================================
// MAIN SCRIPT
// ============================================================================

async function generateTestLeads(totalCount = 500, batchSize = 50) {
  const startTime = Date.now();
  
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║       STRESS TEST - Lead Generation System                 ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');
  
  console.log(`📊 Configuration:`);
  console.log(`   • Total leads to generate: ${formatNumber(totalCount)}`);
  console.log(`   • Batch size: ${batchSize}`);
  console.log(`   • Tag: STRESS_TEST`);
  console.log('');

  try {
    // Connect to database
    console.log('🔌 Connecting to database...');
    await sequelize.authenticate();
    console.log('✅ Database connected\n');

    // Fetch existing entities for realistic relationships
    console.log('🔍 Fetching existing campaigns, agents, and QR tags...');
    const campaigns = await Campaign.findAll({ attributes: ['id'] });
    const agents = await User.findAll({ 
      where: { role: 'agent' },
      attributes: ['id']
    });
    const qrTags = await QrTag.findAll({ attributes: ['id'] });

    const campaignIds = campaigns.map(c => c.id);
    const agentIds = agents.map(a => a.id);
    const qrTagIds = qrTags.map(q => q.id);

    console.log(`   • Found ${formatNumber(campaignIds.length)} campaigns`);
    console.log(`   • Found ${formatNumber(agentIds.length)} agents`);
    console.log(`   • Found ${formatNumber(qrTagIds.length)} QR tags`);
    console.log('');

    // Generate and insert in batches
    const totalBatches = Math.ceil(totalCount / batchSize);
    let totalCreated = 0;
    let totalActivitiesCreated = 0;

    console.log('🚀 Starting lead generation...\n');

    for (let batch = 0; batch < totalBatches; batch++) {
      const batchStartTime = Date.now();
      const currentBatchSize = Math.min(batchSize, totalCount - totalCreated);
      
      // Generate prospect data
      const prospects = [];
      for (let i = 0; i < currentBatchSize; i++) {
        prospects.push(generateProspect(campaignIds, agentIds, qrTagIds));
      }

      // Bulk create prospects
      const createdProspects = await Prospect.bulkCreate(prospects, {
        returning: true,
        validate: true
      });

      // Create associated activities
      const activities = [];
      for (const prospect of createdProspects) {
        activities.push({
          prospectId: prospect.id,
          type: 'created',
          actorUserId: prospect.assignedAgentId || null,
          description: `Prospect created via stress test`,
          metadata: {
            source: 'stress-test-script',
            batchNumber: batch + 1,
            timestamp: new Date().toISOString()
          }
        });

        // Add assignment activity if assigned
        if (prospect.assignedAgentId) {
          activities.push({
            prospectId: prospect.id,
            type: 'assigned',
            actorUserId: prospect.assignedAgentId,
            description: `Assigned to agent ${prospect.assignedAgentId}`,
            metadata: {
              source: 'stress-test-script',
              autoAssigned: true
            }
          });
        }
      }

      await ProspectActivity.bulkCreate(activities);

      totalCreated += createdProspects.length;
      totalActivitiesCreated += activities.length;

      const batchDuration = Date.now() - batchStartTime;
      const batchRate = (createdProspects.length / (batchDuration / 1000)).toFixed(1);
      const progress = ((totalCreated / totalCount) * 100).toFixed(1);
      const elapsed = formatDuration(Date.now() - startTime);
      const eta = formatDuration(((Date.now() - startTime) / totalCreated) * (totalCount - totalCreated));

      // Progress bar
      const barWidth = 40;
      const filledWidth = Math.round((totalCreated / totalCount) * barWidth);
      const emptyWidth = barWidth - filledWidth;
      const bar = '█'.repeat(filledWidth) + '░'.repeat(emptyWidth);

      console.log(`[${bar}] ${progress}%`);
      console.log(`   Batch ${batch + 1}/${totalBatches}: Created ${currentBatchSize} leads @ ${batchRate}/s`);
      console.log(`   Total: ${formatNumber(totalCreated)}/${formatNumber(totalCount)} | Elapsed: ${elapsed} | ETA: ${eta}\n`);
    }

    const totalDuration = Date.now() - startTime;
    const totalRate = (totalCreated / (totalDuration / 1000)).toFixed(1);

    // Final summary
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║                    GENERATION COMPLETE                     ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');
    console.log('📈 Summary:');
    console.log(`   • Prospects created: ${formatNumber(totalCreated)}`);
    console.log(`   • Activities created: ${formatNumber(totalActivitiesCreated)}`);
    console.log(`   • Total duration: ${formatDuration(totalDuration)}`);
    console.log(`   • Average rate: ${totalRate} leads/second`);
    console.log(`   • Tag: STRESS_TEST`);
    console.log('');
    console.log('✅ All test leads have been tagged with "STRESS_TEST"');
    console.log('🧹 Use cleanup-test-leads.js to remove them when done\n');

  } catch (error) {
    console.error('\n❌ Error during stress test:');
    console.error(error);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

// ============================================================================
// CLI ENTRY POINT
// ============================================================================

const args = process.argv.slice(2);
const count = parseInt(args[0]) || 500;
const batchSize = parseInt(args[1]) || 50;

if (count <= 0 || count > 100000) {
  console.error('❌ Count must be between 1 and 100,000');
  process.exit(1);
}

if (batchSize <= 0 || batchSize > 500) {
  console.error('❌ Batch size must be between 1 and 500');
  process.exit(1);
}

generateTestLeads(count, batchSize);




