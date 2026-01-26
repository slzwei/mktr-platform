import { User, Campaign, Prospect, sequelize } from '../src/models/index.js';
import { resolveAssignedAgentId } from '../src/services/systemAgent.js';
import { sendLeadAssignmentEmail } from '../src/services/mailer.js';

// Mock request and user
const mockReqUser = { role: 'public' }; // simulating public signup

async function testRoundRobinAssignment() {
    try {
        console.log('🧪 Testing Round Robin Assignment & Email...');

        // 1. Setup: Ensure we have a campaign with ONE assigned agent
        console.log('1. Setting up test data...');

        // Get the agent 'Shawn Teo' (from previous context we know this exists)
        const agent = await User.findOne({ where: { email: 'shawnleepa@gmail.com' } });
        if (!agent) throw new Error('Test agent not found');
        console.log(`   Found agent: ${agent.firstName} (${agent.role})`);

        // Create or find a test campaign
        let campaign = await Campaign.findOne({ where: { name: 'Test Round Robin Campaign' } });
        if (!campaign) {
            campaign = await Campaign.create({
                name: 'Test Round Robin Campaign',
                status: 'active',
                assigned_agents: [agent.id], // Assign ONLY this agent
                createdBy: agent.id
            });
            console.log('   Created test campaign');
        } else {
            // Ensure agent is assigned
            await campaign.update({ assigned_agents: [agent.id] });
            console.log('   Updated existing test campaign');
        }

        // 2. Test resolveAssignedAgentId
        console.log('\n2. Testing resolveAssignedAgentId...');
        const resolvedAgentId = await resolveAssignedAgentId({
            reqUser: undefined, // Public user
            requestedAgentId: null,
            campaignId: campaign.id,
            qrTagId: null
        });

        console.log(`   Resolved Agent ID: ${resolvedAgentId}`);
        console.log(`   Expected Agent ID: ${agent.id}`);

        if (resolvedAgentId !== agent.id) {
            console.error('❌ Round Robin logic failed! Did not return the assigned agent.');
            // Check if fallback to system agent happened
            return;
        } else {
            console.log('✅ Round Robin logic worked! Correct agent selected.');
        }

        // 3. Test Email Trigger (simulate route logic)
        console.log('\n3. Testing Email Logic...');

        if (resolvedAgentId) {
            const assignedAgent = await User.findByPk(resolvedAgentId);
            if (!assignedAgent) {
                console.error('❌ Could not fetch agent details details from DB');
            } else if (!assignedAgent.email) {
                console.error('❌ Agent has no email address!');
            } else {
                console.log(`   Attempting to send email to: ${assignedAgent.email}`);

                // Mock prospect data
                const mockProspect = {
                    id: 'test-prospect-id',
                    firstName: 'Test',
                    lastName: 'RR-User',
                    email: 'test@example.com',
                    phone: '12345678',
                    createdAt: new Date(),
                    campaign: { name: campaign.name }
                };

                try {
                    await sendLeadAssignmentEmail(assignedAgent, mockProspect);
                    console.log('✅ Email send function completed without error');
                } catch (e) {
                    console.error('❌ Email send function threw error:', e);
                }
            }
        }

    } catch (err) {
        console.error('❌ Test failed with error:', err);
    } finally {
        await sequelize.close();
    }
}

testRoundRobinAssignment();
