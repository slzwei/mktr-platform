
import { User, sequelize } from '../src/models/index.js';

async function testDelete() {
    try {
        // Create a dummy agent
        const agent = await User.create({
            email: `test-delete-${Date.now()}@example.com`,
            firstName: 'Test',
            lastName: 'Delete',
            role: 'agent',
            isActive: true,
            owed_leads_count: 0
        });

        console.log(`Created agent: ${agent.id}, isActive: ${agent.isActive}`);

        // Simulate "User.delete" which calls DELETE /users/:id
        // In the backend routes, this does: await user.update({ isActive: false });

        // We can simulate the route handler logic directly
        await agent.update({ isActive: false });
        console.log(`Soft deleted agent. isActive: ${agent.isActive}`);

        // Verify it still exists
        const check1 = await User.findByPk(agent.id);
        if (check1) {
            console.log('Agent still exists in DB (Soft Delete confirmed)');
        } else {
            console.log('Agent gone from DB');
        }

        // Now simulate permanent delete
        // DELETE /users/:id/permanent -> await user.destroy();
        if (check1.role === 'agent') {
            await check1.destroy();
            console.log('Permanently deleted agent.');
        }

        const check2 = await User.findByPk(agent.id);
        if (!check2) {
            console.log('Agent gone from DB (Permanent Delete confirmed)');
        } else {
            console.log('Agent still exists in DB');
        }

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await sequelize.close();
    }
}

testDelete();
