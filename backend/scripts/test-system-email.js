
import dotenv from 'dotenv';
import { sendLeadAssignmentEmail } from '../src/services/mailer.js';

dotenv.config();

// Mock objects
const mockSystemAgent = {
    id: 'system-agent-id',
    email: process.env.SYSTEM_AGENT_EMAIL || 'system@mktr.local', // Should trigger redirect
    firstName: 'System',
    lastName: 'Agent'
};

const mockProspect = {
    id: 'test-prospect-id',
    firstName: 'Test',
    lastName: 'Prospect',
    email: 'test@example.com',
    createdAt: new Date(),
    campaignName: 'Test Campaign'
};

async function test() {
    console.log('🧪 Testing System Agent Email Redirect...');
    console.log(`System Agent Email: ${mockSystemAgent.email}`);

    try {
        await sendLeadAssignmentEmail(mockSystemAgent, mockProspect);
        console.log('✅ Test function called successfully. Check logs above for "Redirecting assignment email to shawnleejob@gmail.com".');
    } catch (err) {
        console.error('❌ Test failed:', err);
    }
}

test();
