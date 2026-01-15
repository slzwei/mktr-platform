import request from 'supertest';
import { app } from '../src/server.js';
import { User, Campaign, Prospect, sequelize } from '../src/models/index.js';

// Prevent server.js from auto-starting if logic exists, but we rely on process.env.JEST_WORKER_ID check in server.js
// We will set that ENV var when running this script.

async function verifyUnassignmentLogs() {
    console.log('🧪 Verifying Unassignment Activity Logs (Integration via Supertest)...');

    // Setup Admin Token
    let adminToken;
    let adminUser;

    try {
        await sequelize.authenticate(); // Ensure DB connected

        const timestamp = Date.now();
        const adminEmail = `admin.logtest.${timestamp}@test.com`;
        const adminPassword = 'password123';

        // Register Admin
        await request(app)
            .post('/api/auth/register')
            .send({ email: adminEmail, password: adminPassword, firstName: 'Admin', lastName: 'Tester', role: 'admin' });

        // Login Admin
        const loginRes = await request(app)
            .post('/api/auth/login')
            .send({ email: adminEmail, password: adminPassword });

        adminToken = loginRes.body.token || loginRes.body.data?.token;
        adminUser = loginRes.body.data?.user || loginRes.body.user;

        if (!adminToken) {
            console.error('❌ Failed to get admin token', loginRes.body);
            return;
        }

        // --- Helper Functions ---
        const createAgent = async (name) => {
            const res = await request(app)
                .post('/api/users')
                .set('Authorization', `Bearer ${adminToken}`)
                .send({
                    email: `agent.${name}.${timestamp}@test.com`,
                    firstName: name,
                    lastName: 'Agent',
                    role: 'agent',
                    owed_leads_count: 10
                });
            return res.body.data.user;
        };

        const createCampaign = async () => {
            const res = await request(app)
                .post('/api/campaigns')
                .set('Authorization', `Bearer ${adminToken}`)
                .send({
                    name: `Test Campaign ${timestamp}`,
                    type: 'lead_capture',
                    status: 'active'
                });
            return res.body.data.campaign;
        };

        const createProspect = async (campaignId, agentId) => {
            const rand = Math.floor(Math.random() * 1000000000);
            // Ensure phone is exactly 10 digits: 9 + 9 random digits (padded if needed, but Math.random range logic below is safer)
            const safePhone = '9' + Math.floor(100000000 + Math.random() * 900000000).toString();

            const res = await request(app)
                .post('/api/prospects')
                .set('Authorization', `Bearer ${adminToken}`)
                .send({
                    firstName: 'John',
                    lastName: 'Doe',
                    email: `john.doe.${rand}@test.com`,
                    phone: safePhone,
                    campaignId,
                    assignedAgentId: agentId,
                    leadSource: 'direct'
                });
            if (res.status !== 201) {
                console.error('❌ Create Prospect Failed:', res.status, res.body);
            }
            return res.body.data.prospect;
        };

        const campaign = await createCampaign();

        // --- TEST 1: Manual Unassignment ---
        console.log('\n--- TEST 1: Manual Unassignment ---');
        const agentA = await createAgent('AgentA');
        const prospect1 = await createProspect(campaign.id, agentA.id);

        const unassignRes = await request(app)
            .put(`/api/prospects/${prospect1.id}`)
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ assignedAgentId: null });

        if (unassignRes.status !== 200) {
            console.error('❌ Unassignment failed:', unassignRes.body);
        } else {
            // Check logs
            const logsRes = await request(app)
                .get(`/api/prospects/${prospect1.id}`)
                .set('Authorization', `Bearer ${adminToken}`);

            const activities = logsRes.body.data.prospect.activities;
            const log = activities.find(a => a.description.includes('Lead manually unassigned'));

            if (log && log.description.includes('AgentA')) {
                console.log('✅ Manual Unassignment Log Verified:', log.description);
            } else {
                console.error('❌ Manual Unassignment Log Missing/Incorrect:', activities.map(a => a.description));
            }
        }

        // --- TEST 2: Single Permanent Delete ---
        console.log('\n--- TEST 2: Single Permanent Delete ---');
        const agentB = await createAgent('AgentB');
        const prospect2 = await createProspect(campaign.id, agentB.id);

        const deleteRes = await request(app)
            .delete(`/api/users/${agentB.id}/permanent`)
            .set('Authorization', `Bearer ${adminToken}`);

        if (deleteRes.status !== 200) {
            console.error('❌ Delete failed:', deleteRes.body);
        } else {
            const logsRes = await request(app)
                .get(`/api/prospects/${prospect2.id}`)
                .set('Authorization', `Bearer ${adminToken}`);

            const activities = logsRes.body.data.prospect.activities;
            const log = activities.find(a => a.description.includes('agent AgentB Agent was deleted'));

            if (log && logsRes.body.data.prospect.assignedAgentId === null) {
                console.log('✅ Single Delete Log Verified:', log.description);
            } else {
                console.error('❌ Single Delete Log Missing/Incorrect:', activities.map(a => a.description));
            }
        }

        // --- TEST 3: Bulk Permanent Delete ---
        console.log('\n--- TEST 3: Bulk Permanent Delete ---');
        const agentC = await createAgent('AgentC');
        const agentD = await createAgent('AgentD');
        const prospect3 = await createProspect(campaign.id, agentC.id);
        const prospect4 = await createProspect(campaign.id, agentD.id);

        const bulkDeleteRes = await request(app)
            .post('/api/users/bulk-delete')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ ids: [agentC.id, agentD.id] });

        if (bulkDeleteRes.status !== 200) {
            console.error('❌ Bulk Delete failed:', bulkDeleteRes.body);
        } else {
            const logsResC = await request(app)
                .get(`/api/prospects/${prospect3.id}`)
                .set('Authorization', `Bearer ${adminToken}`);
            const logC = logsResC.body.data.prospect.activities.find(a => a.description.includes('agent AgentC Agent was deleted'));

            if (logC && logsResC.body.data.prospect.assignedAgentId === null) {
                console.log('✅ Bulk Delete Log C Verified:', logC.description);
            } else {
                console.error('❌ Bulk Delete Log C Missing/Incorrect:', logsResC.body.data.prospect.activities.map(a => a.description));
            }

            const logsResD = await request(app)
                .get(`/api/prospects/${prospect4.id}`)
                .set('Authorization', `Bearer ${adminToken}`);
            const logD = logsResD.body.data.prospect.activities.find(a => a.description.includes('agent AgentD Agent was deleted'));

            if (logD && logsResD.body.data.prospect.assignedAgentId === null) {
                console.log('✅ Bulk Delete Log D Verified:', logD.description);
            } else {
                console.error('❌ Bulk Delete Log D Missing/Incorrect:', logsResD.body.data.prospect.activities.map(a => a.description));
            }
        }

        // --- TEST 4: Soft Delete (Deactivation with Unassignment) ---
        console.log('\n--- TEST 4: Soft Delete (Deactivation) ---');
        const agentE = await createAgent('AgentE');
        const prospect5 = await createProspect(campaign.id, agentE.id);

        const softDeleteRes = await request(app)
            .delete(`/api/users/${agentE.id}`)
            .set('Authorization', `Bearer ${adminToken}`);

        if (softDeleteRes.status !== 200) {
            console.error('❌ Soft Delete failed:', softDeleteRes.body);
        } else {
            const logsRes = await request(app)
                .get(`/api/prospects/${prospect5.id}`)
                .set('Authorization', `Bearer ${adminToken}`);

            const activities = logsRes.body.data.prospect.activities;
            const log = activities.find(a => a.description.includes('was deactivated'));

            if (log && logsRes.body.data.prospect.assignedAgentId === null) {
                console.log('✅ Soft Delete Log Verified:', log.description);
            } else {
                console.error('❌ Soft Delete Log Missing/Incorrect:', activities.map(a => a.description));
            }
        }

    } catch (error) {
        console.error('❌ Unexpected Error:', error);
    } finally {
        // Force exit because supertest/express/sequelize might keep handles open
        if (sequelize) await sequelize.close();
        // process.exit(0); // Optional
    }
}

verifyUnassignmentLogs();
