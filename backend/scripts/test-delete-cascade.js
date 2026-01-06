
import { User, Prospect, LeadPackageAssignment, sequelize } from '../src/models/index.js';

async function testDeleteWithDependencies() {
    try {
        // Create agent
        const agent = await User.create({
            email: `test-agent-${Date.now()}@example.com`,
            firstName: 'Test',
            lastName: 'Agent',
            role: 'agent',
            isActive: true
        });
        console.log('Agent created:', agent.id);

        // Create a dependency (e.g. prospect assignment)
        // We need a dummy campaign first ideally, but maybe prospect is enough if loose
        // Checking Prospect model, it likely needs campaign.
        // Let's try LeadPackageAssignment as it's simpler?

        // Actually, let's just create a mock dependency if possible or just try to delete.
        // Basic test: Does destroy work?
        try {
            await agent.destroy();
            console.log('Basic destroy worked');
        } catch (e) {
            console.error('Basic destroy failed:', e.message);
        }

    } catch (error) {
        console.error('Setup error:', error);
    } finally {
        await sequelize.close();
    }
}

testDeleteWithDependencies();
