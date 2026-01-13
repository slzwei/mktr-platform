
import dotenv from 'dotenv';
import { User, LeadPackageAssignment, QrTag, LeadPackage, Prospect, ProspectActivity, sequelize } from '../src/models/index.js';

dotenv.config();

async function debug() {
    try {
        const email = 'shawnleepa@gmail.com';
        console.log(`Checking for user with email: ${email}`);

        const user = await User.findOne({ where: { email } });

        if (!user) {
            console.log('User not found.');
            return;
        }

        console.log('User found:', user.toJSON());

        // Check System Agent Params
        const systemEmail = process.env.SYSTEM_AGENT_EMAIL || 'system@mktr.local';
        const defaultAgentId = process.env.DEFAULT_AGENT_ID;

        console.log('System Configuration:');
        console.log('SYSTEM_AGENT_EMAIL:', systemEmail);
        console.log('DEFAULT_AGENT_ID:', defaultAgentId);

        if (user.email === systemEmail) {
            console.log('*** User IS the System Agent Email ***');
        }
        if (user.id === defaultAgentId) {
            console.log('*** User IS the Default Agent ID ***');
        }

        // Check Assignments
        const assignments = await LeadPackageAssignment.findAll({
            where: { agentId: user.id },
            include: [{ model: LeadPackage, as: 'package' }]
        });

        console.log(`Found ${assignments.length} assignments.`);
        assignments.forEach(a => {
            console.log(`- Assignment ${a.id}: Status=${a.status}, LeadsRemaining=${a.leadsRemaining}, Campaign=${a.package?.campaignId}`);
        });

        // Check QR Tags
        const tags = await QrTag.findAll({ where: { ownerUserId: user.id } });
        console.log(`Found ${tags.length} QR Tags owned.`);
        tags.forEach(t => {
            console.log(`- Tag ${t.id}: Code=${t.code}, Campaign=${t.campaignId}`);
        });

        // Check for recent prospects assigned to this user
        console.log('\nChecking recent prospects assigned to this user...');
        const prospects = await Prospect.findAll({
            where: { assignedAgentId: user.id },
            order: [['createdAt', 'DESC']],
            limit: 5,
            include: [{
                model: ProspectActivity,
                as: 'activities',
                where: { type: ['created', 'assigned'] },
                required: false
            }]
        });

        if (prospects.length === 0) {
            console.log('No prospects found assigned to this user.');
        } else {
            prospects.forEach(p => {
                console.log(`\nProspect ID: ${p.id}`);
                console.log(`Created At: ${p.createdAt}`);
                console.log(`Name: ${p.firstName} ${p.lastName}`);
                if (p.activities && p.activities.length > 0) {
                    p.activities.forEach(a => {
                        console.log(`  - Activity: ${a.type}`);
                        console.log(`    Description: ${a.description}`);
                        console.log(`    ActorUserId: ${a.actorUserId} ${a.actorUserId === user.id ? '(MATCHES AGENT!)' : ''}`);
                    });
                } else {
                    console.log('  No specific creation/assignment activities found (or filtered out).');
                }
            });
        }

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await sequelize.close();
    }
}

debug();
