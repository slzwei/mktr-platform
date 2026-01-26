
import { Op } from 'sequelize';
import { User, LeadPackageAssignment, LeadPackage, sequelize } from '../src/models/index.js';

async function checkAssignments() {
    console.log('DEBUG: DB_HOST =', process.env.DB_HOST);
    try {
        // 1. Find Shawn Teo
        const agents = await User.findAll({
            where: sequelize.where(
                sequelize.fn('concat', sequelize.col('firstName'), ' ', sequelize.col('lastName')),
                { [Op.like]: '%Shawn Teo%' }
            )
        });

        if (agents.length === 0) {
            console.log('❌ User "Shawn Teo" not found.');
            // Try searching just by parts
            const allUsers = await User.findAll({ attributes: ['id', 'firstName', 'lastName', 'email', 'role'] });
            console.log('Available users:', allUsers.map(u => `${u.firstName} ${u.lastName} (${u.email}) [${u.role}]`));
            return;
        }

        const agent = agents[0];
        console.log(`✅ Found Agent: ${agent.firstName} ${agent.lastName} (ID: ${agent.id})`);

        // 2. Check Assignments
        const assignments = await LeadPackageAssignment.findAll({
            where: { agentId: agent.id },
            include: [{ model: LeadPackage, as: 'package' }]
        });

        console.log(`📊 Assignments Found: ${assignments.length}`);

        if (assignments.length > 0) {
            assignments.forEach(a => {
                console.log(` - ID: ${a.id}`);
                console.log(`   Package: ${a.package?.name}`);
                console.log(`   Status: ${a.status}`);
                console.log(`   Leads: ${a.leadsRemaining}/${a.leadsTotal}`);
            });
        } else {
            console.log('⚠️ No assignments found for this agent in the database.');
        }

    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await sequelize.close();
    }
}

checkAssignments();
