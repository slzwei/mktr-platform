
import { User, Prospect, ProspectActivity, sequelize } from '../src/models/index.js';

async function debugMissingLog() {
    try {
        console.log('🔍 Debugging: Checking status of "Ng Hui Xin" and "Grail"');

        // 1. Find the prospect "Ng Hui Xin" (checking first or last name matches)
        const prospects = await Prospect.findAll({
            where: {
                [sequelize.Sequelize.Op.or]: [
                    { firstName: { [sequelize.Sequelize.Op.like]: '%Ng Hui Xin%' } },
                    { lastName: { [sequelize.Sequelize.Op.like]: '%Ng Hui Xin%' } },
                    { firstName: 'Ng', lastName: 'Hui Xin' },
                    { firstName: 'Hui Xin', lastName: 'Ng' }
                ]
            },
            include: ['assignedAgent']
        });

        if (prospects.length === 0) {
            console.log('❌ Prospect "Ng Hui Xin" not found.');
        } else {
            for (const p of prospects) {
                console.log(`\n📄 Prospect Found: ID=${p.id}, Name=${p.firstName} ${p.lastName}`);
                console.log(`   Assigned Agent: ${p.assignedAgent ? `${p.assignedAgent.firstName} ${p.assignedAgent.lastName} (ID: ${p.assignedAgent.id})` : 'NULL'}`);

                // Check Agent Status
                if (p.assignedAgent) {
                    console.log(`   Agent Status: isActive=${p.assignedAgent.isActive}`);
                }

                // Check recent activities
                const activities = await ProspectActivity.findAll({
                    where: { prospectId: p.id },
                    order: [['createdAt', 'DESC']],
                    limit: 5
                });

                console.log('   Recent Activities:');
                activities.forEach(a => {
                    console.log(`     - [${a.createdAt.toISOString()}] ${a.description} (Type: ${a.type})`);
                });
            }
        }

        // 2. Find Agent "Grail"
        const agents = await User.findAll({
            where: {
                [sequelize.Sequelize.Op.or]: [
                    { firstName: { [sequelize.Sequelize.Op.like]: '%Grail%' } },
                    { lastName: { [sequelize.Sequelize.Op.like]: '%Grail%' } }
                ]
            }
        });

        if (agents.length === 0) {
            console.log('\n❌ Agent "Grail" not found.');
        } else {
            for (const a of agents) {
                console.log(`\n👤 Agent Found: ID=${a.id}, Name=${a.firstName} ${a.lastName}`);
                console.log(`   Status: isActive=${a.isActive}`);
            }
        }

    } catch (error) {
        console.error('❌ Error during debug:', error);
    } finally {
        await sequelize.close();
    }
}

debugMissingLog();
