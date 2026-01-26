// import { sequelize } from '../src/database/connection.js'; // REMOVED STATIC IMPORT to allow dotenv to run first
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Force load backend/.env which has the Postgres config
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendEnvPath = path.resolve(__dirname, '../.env');

console.log(`Loading env from: ${backendEnvPath}`);
dotenv.config({ path: backendEnvPath });

async function checkAgentPackages() {
    // Re-import sequelize or simple connection test will show us dialect
    // Note: Since connection.js is already imported, it might have initialized with old env if not careful.
    // However, in this script execution, we are setting env before connection.js is fully utilized if we rely on lazy loading or if we accept connection.js reads env at top level.
    // Actually connection.js reads env at top level. So we might need to set env vars BEFORE import if possible, or reliance on dotenv.config() at top of this file (which I will do in the run command using -r or just hope node resolution order works). 
    // Wait, typical ES modules imports run before code. So updating process.env here is too late for `connection.js` import.
    // I need to use `node -r dotenv/config` pointing to the right file, OR delay import. 

    // For now, I will trust the user of the script to run it with the right env, BUT 
    // I will try to use the dynamic import(), which executes AFTER this file starts running.

    // But `connection.js` is already imported at top level? No, I can remove it from top level.

    try {
        const { sequelize } = await import('../src/database/connection.js');

        console.log(`Checking DB config... Dialect: ${sequelize.getDialect()}`);
        if (sequelize.getDialect() === 'sqlite') {
            console.log(`⚠️ WARNING: Still using SQLite. Host env var is: ${process.env.DB_HOST}`);
        } else {
            console.log(`✅ Using Postgres: ${process.env.DB_HOST}`);
        }

        const agentIds = ['6c86bbce', '107305e3']; // Partial IDs provided by user

        for (const searchId of agentIds) {
            console.log(`\n--------------------------------------------------`);
            console.log(`Searching for agent with ID ending in: ${searchId}`);

            // Cast UUID to text for LIKE comparison in Postgres
            const [users] = await sequelize.query(`SELECT * FROM "users" WHERE id::text LIKE '%${searchId}'`);

            if (users.length === 0) {
                console.log(`❌ Agent with ID ending in ${searchId} not found.`);
                continue;
            }

            const agent = users[0];
            console.log(`✅ Found Agent: ${agent.full_name || agent.firstName + ' ' + (agent.lastName || '')} (ID: ${agent.id})`);
            console.log(`   Manual Leads Owed (DB column): ${agent.owed_leads_count}`);

            // Check assignments
            // Check table name casing (Postgres usually lowercase in this project based on verify script)
            const [assignments] = await sequelize.query(`SELECT * FROM "lead_package_assignments" WHERE "agentId" = '${agent.id}'`);

            if (assignments.length === 0) {
                console.log('ℹ️ No packages assigned to this agent.');
            } else {
                console.log(`📦 Found ${assignments.length} assigned package(s):`);

                for (const assignment of assignments) {
                    // Fetch package name for context
                    const [pkgs] = await sequelize.query(`SELECT name FROM "lead_packages" WHERE id = '${assignment.leadPackageId}'`);
                    const pkgName = pkgs[0]?.name || 'Unknown Package';

                    console.log(`   - Package: ${pkgName}`);
                    console.log(`     Status: ${assignment.status}`);
                    console.log(`     Leads: ${assignment.leadsRemaining} / ${assignment.leadsTotal}`);
                    console.log(`     Assignment ID: ${assignment.id}`);
                }
            }
        }

    } catch (error) {
        console.error('Error:', error);
    } finally {
        // We can't easily close if we dynamically imported and don't have the instance reference easily if we didn't assign it. 
        // Oh wait I did const { sequelize } = ...
        // But need to handle if import failed.
    }
}

checkAgentPackages();
