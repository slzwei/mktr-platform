
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';
import { Sequelize } from 'sequelize';

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../backend/.env') });

const BASE_URL = 'http://127.0.0.1:3001/api';

// Database connection for Setup (skipping API for setup speed/reliability)
// We need to manipulate DB state directly for robust setup
import { sequelize } from '../src/database/connection.js';

class NodeAPIClient {
    constructor(baseURL) {
        this.baseURL = baseURL;
        this.token = null;
    }

    setToken(token) { this.token = token; }

    async request(endpoint, options = {}) {
        const url = `${this.baseURL}${endpoint}`;
        const headers = { 'Content-Type': 'application/json', ...(this.token && { Authorization: `Bearer ${this.token}` }), ...options.headers };
        const config = { ...options, headers };
        if (config.body && typeof config.body === 'object') config.body = JSON.stringify(config.body);

        const response = await fetch(url, config);
        const data = await response.json().catch(() => ({}));
        return { ok: response.ok, status: response.status, data };
    }

    post(endpoint, body) { return this.request(endpoint, { method: 'POST', body }); }
}

const client = new NodeAPIClient(BASE_URL);

async function runTest() {
    let transaction;
    try {
        await sequelize.authenticate();
        console.log('--- Step 1: Setup Test Data ---');

        // 1. Create Test Agent (Creator)
        const agentEmail = `test.agent.${Date.now()}@mktr.local`;
        const [agent] = await sequelize.query(`
            INSERT INTO users (id, email, "firstName", "lastName", role, "isActive", "emailVerified", "createdAt", "updatedAt")
            VALUES (gen_random_uuid(), '${agentEmail}', 'Test', 'Human', 'agent', true, true, NOW(), NOW())
            RETURNING id;
        `);
        const agentId = agent[0].id;
        console.log(`Created Human Agent: ${agentId}`);

        // 2. Create Test Campaign
        const [campaign] = await sequelize.query(`
            INSERT INTO campaigns (id, name, type, status, "createdBy", "createdAt", "updatedAt")
            VALUES (gen_random_uuid(), 'Assignment Verification', 'lead_generation', 'active', '${agentId}', NOW(), NOW())
            RETURNING id;
        `);
        const campaignId = campaign[0].id;
        console.log(`Created Campaign: ${campaignId}`);

        // 3. Create Lead Package
        const [pkg] = await sequelize.query(`
            INSERT INTO lead_packages (id, "campaignId", name, price, "leadCount", type, "createdBy", "createdAt", "updatedAt")
            VALUES (gen_random_uuid(), '${campaignId}', 'Test Package', 100, 10, 'basic', '${agentId}', NOW(), NOW())
            RETURNING id;
        `);
        const packageId = pkg[0].id;

        // 4. Assign Package to Agent (Active with credits)
        await sequelize.query(`
            INSERT INTO lead_package_assignments (id, "agentId", "leadPackageId", status, "leadsTotal", "leadsRemaining", "priceSnapshot", "createdAt", "updatedAt")
            VALUES (gen_random_uuid(), '${agentId}', '${packageId}', 'active', 10, 5, 100, NOW(), NOW());
        `);
        console.log('Assigned active package to agent with 5 credits.');

        // Get System Agent ID
        const [sysUsers] = await sequelize.query(`SELECT id FROM users WHERE email = 'system@mktr.local'`);
        const systemAgentId = sysUsers[0]?.id;
        if (!systemAgentId) throw new Error('System Agent not found in DB');
        console.log(`System Agent ID: ${systemAgentId}`);

        console.log('--- Step 2: Test Human Assignment ---');
        // Submit lead (should go to human)
        const lead1 = await client.post('/prospects', {
            campaignId: campaignId,
            firstName: 'Lead',
            lastName: 'One',
            email: `lead1.${Date.now()}@test.com`,
            leadSource: 'website'
        });

        if (!lead1.ok) {
            console.error('API Error:', JSON.stringify(lead1.data, null, 2));
            throw new Error(`Lead 1 creation failed: ${lead1.status}`);
        }

        if (lead1.data.data.prospect.assignedAgentId === agentId) {
            console.log('✅ PASS: Lead assigned to Human Agent when credits exist.');
        } else {
            console.error('❌ FAIL: Lead NOT assigned to Human Agent. Assigned to:', lead1.data.data.prospect.assignedAgentId);
        }

        console.log('--- Step 3: Deplete Credits ---');
        // Set leadsRemaining to 0
        await sequelize.query(`
            UPDATE lead_package_assignments 
            SET "leadsRemaining" = 0 
            WHERE "agentId" = '${agentId}' AND "leadPackageId" = '${packageId}'
        `);
        console.log('Agent credits set to 0.');

        console.log('--- Step 4: Test System Agent Fallback ---');
        // Submit lead (should go to System)
        const lead2 = await client.post('/prospects', {
            campaignId: campaignId,
            firstName: 'Lead',
            lastName: 'Two',
            email: `lead2.${Date.now()}@test.com`,
            leadSource: 'website'
        });

        if (lead2.data.data.prospect.assignedAgentId === systemAgentId) {
            console.log('✅ PASS: Lead assigned to System Agent when no human credits exist.');
        } else {
            console.error('❌ FAIL: Lead NOT assigned to System Agent. Assigned to:', lead2.data.data.prospect.assignedAgentId);
        }

    } catch (error) {
        console.error('Test failed:', error);
    } finally {
        await sequelize.close();
    }
}

runTest();
