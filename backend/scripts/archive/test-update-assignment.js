
// import { sequelize } from '../src/database/connection.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Force load backend/.env
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendEnvPath = path.resolve(__dirname, '../.env');

dotenv.config({ path: backendEnvPath });

async function testUpdateAssignment() {
    let sequelizeInstance;
    try {
        const { LeadPackageAssignment, User, LeadPackage } = await import('../src/models/index.js');
        const { sequelize } = await import('../src/models/index.js');
        sequelizeInstance = sequelize;

        console.log('🔍 Finding a test assignment...');
        const assignment = await LeadPackageAssignment.findOne();

        if (!assignment) {
            console.log('⚠️ No assignments found. Cannot test update.');
            return;
        }

        const oldLeads = assignment.leadsRemaining;
        const newLeads = oldLeads === 100 ? 50 : 100; // Toggle value

        console.log(`📝 Updating assignment ${assignment.id} from ${oldLeads} to ${newLeads} leads...`);

        // Simulate API update via model directly as we are testing DB logic first, 
        // to test API route we would need valid auth token which is complex in script.
        // But we can trust standard Sequelize update if model is correct.
        // Let's verify standard update behavior:

        await assignment.update({ leadsRemaining: newLeads });

        console.log('✅ Update called.');

        const reloaded = await LeadPackageAssignment.findByPk(assignment.id);
        console.log(`🔄 Reloaded leads: ${reloaded.leadsRemaining}`);

        if (reloaded.leadsRemaining === newLeads) {
            console.log('✅ Verification SUCCESS: Leads updated correctly.');
        } else {
            console.error('❌ Verification FAILED: Leads did not update.');
        }

        // Revert
        await assignment.update({ leadsRemaining: oldLeads });
        console.log('Restored original value.');

    } catch (error) {
        console.error('❌ Error testing update:', error);
    } finally {
        if (sequelizeInstance) await sequelizeInstance.close();
    }
}

testUpdateAssignment();
