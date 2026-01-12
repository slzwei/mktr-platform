
import { User, LeadPackageAssignment, LeadPackage } from '../src/models/index.js';

async function verifyAssignments() {
    try {
        const user = await User.findOne({ where: { fullName: 'Shawn Teo' } });
        if (!user) {
            console.log('User "Shawn Teo" not found. Listing all users:');
            const users = await User.findAll({ attributes: ['id', 'fullName', 'email', 'role'] });
            users.forEach(u => console.log(`- ${u.fullName} (${u.email}) [${u.role}] ID: ${u.id}`));
            return;
        }
        console.log(`Found User: ${user.fullName} (${user.id})`);

        const assignments = await LeadPackageAssignment.findAll({
            where: { agentId: user.id },
            include: [{ model: LeadPackage, as: 'package' }]
        });

        if (assignments.length === 0) {
            console.log('No assignments found for this user.');
        } else {
            console.log(`Found ${assignments.length} assignments:`);
            assignments.forEach(a => {
                console.log(`- Package: ${a.package?.name}, Leads: ${a.leadsRemaining}/${a.leadsTotal}, Status: ${a.status}`);
            });
        }
    } catch (error) {
        console.error('Error:', error);
    } finally {
        process.exit();
    }
}

verifyAssignments();
