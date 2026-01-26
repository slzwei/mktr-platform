
import request from 'supertest';
import { sequelize, User, Prospect, ProspectActivity } from '../src/models/index.js';
import app from '../src/server.js';
import jwt from 'jsonwebtoken';

// Token will be generated inside simulate()

async function simulate() {
    try {
        console.log('🧪 Simulating specific scenario: Delete "Grail" with assigned "Ng Hui Xin"...');

        await sequelize.authenticate();

        // 0. Create Admin User for Token
        const adminEmail = `admin-${Date.now()}@test.com`;
        const adminUser = await User.create({
            firstName: 'Super',
            lastName: 'Admin',
            email: adminEmail,
            role: 'admin',
            isActive: true,
            emailVerified: true
        });

        const adminToken = jwt.sign(
            { userId: adminUser.id, role: 'admin', email: adminEmail },
            process.env.JWT_SECRET || 'testsecret',
            { expiresIn: '1h' }
        );
        const agentName = 'Grail';
        const agentEmail = `grail.test.${Date.now()}@test.com`;

        let agent = await User.create({
            firstName: 'Grail',
            lastName: 'Agent',
            email: agentEmail,
            role: 'agent',
            isActive: true,
            // password: 'password123', // User model might not require password if created directly or handles hashing hooks
            emailVerified: true
        });
        console.log(`✅ Created Agent: ${agent.firstName} ${agent.lastName} (${agent.id})`);

        // 2. Create Prospect "Ng Hui Xin"
        const prospectName = 'Ng Hui Xin';
        const [pFirst, ...pLast] = prospectName.split(' ');

        let prospect = await Prospect.create({
            firstName: pFirst,
            lastName: pLast.join(' '),
            email: `nghuixin.${Date.now()}@test.com`,
            phone: '9' + Math.floor(100000000 + Math.random() * 900000000).toString(),
            assignedAgentId: agent.id,
            leadStatus: 'new',
            leadSource: 'referral'
        });
        console.log(`✅ Created Prospect: ${prospect.firstName} ${prospect.lastName} (${prospect.id}) assigned to Agent ${agent.id}`);

        // 3. Perform Permanent Delete
        console.log(`🗑️ Deleting Agent ${agent.id} permanently...`);
        const res = await request(app)
            .delete(`/api/users/${agent.id}/permanent`)
            .set('Authorization', `Bearer ${adminToken}`);

        if (res.status === 200) {
            console.log('✅ Delete request successful.');
        } else {
            console.error('❌ Delete request failed:', res.status, res.body);
            return;
        }

        // 4. Verify Activity Log
        // Reload prospect to check unassignment
        const updatedProspect = await Prospect.findByPk(prospect.id);
        if (updatedProspect.assignedAgentId === null) {
            console.log('✅ Prospect correctly unassigned (assignedAgentId is null).');
        } else {
            console.error(`❌ Prospect still assigned to ${updatedProspect.assignedAgentId}`);
        }

        const logs = await ProspectActivity.findAll({
            where: { prospectId: prospect.id },
            order: [['createdAt', 'DESC']]
        });

        const unassignLog = logs.find(l => l.description.includes('unassigned') && l.description.includes('Grail'));

        if (unassignLog) {
            console.log(`✅ Log FOUND: "${unassignLog.description}"`);
        } else {
            console.error('❌ Log MISSING for prospect Ng Hui Xin!');
            console.log('Existing Logs:', logs.map(l => l.description));
        }

    } catch (error) {
        console.error('❌ Error during simulation:', error);
    } finally {
        // await sequelize.close(); // app might keep connection open, but usually good to close if reusing connection
        // Since we import app, server might start. We rely on script completion.
    }
}

simulate();
