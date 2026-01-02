
import { sequelize } from '../src/database/connection.js';
import { DataTypes } from 'sequelize';

async function cleanupRenderDb() {
    const MASTER_EMAIL = 'shawnleeapps@gmail.com'; // Corrected typo from user input

    try {
        console.log('Connecting to Render DB...');
        await sequelize.authenticate();
        console.log('Connected! Starting cleanup...');

        // 1. Ensure Master Admin Exists
        const [users] = await sequelize.query(`SELECT * FROM "users" WHERE email = :email`, {
            replacements: { email: MASTER_EMAIL }
        });

        let masterId;

        if (users.length > 0) {
            console.log(`✅ Found existing user ${MASTER_EMAIL}. Updating role to admin...`);
            masterId = users[0].id;
            await sequelize.query(`UPDATE "users" SET role = 'admin' WHERE id = :id`, {
                replacements: { id: masterId }
            });
        } else {
            console.log(`⚠️ User ${MASTER_EMAIL} not found. Creating new admin user...`);
            // Generate a new UUID for the user
            const { v4: uuidv4 } = await import('uuid'); // Dynamic import if needed, or rely on db gen
            // Actually, let's just use SQL to insert and return ID to avoid dep issues if possible, 
            // or assume gen_random_uuid() works if Postgres.

            const [newUser] = await sequelize.query(`
        INSERT INTO "users" (id, email, role, created_at, updated_at)
        VALUES (gen_random_uuid(), :email, 'admin', NOW(), NOW())
        RETURNING id;
      `, {
                replacements: { email: MASTER_EMAIL }
            });

            // Sequelize insert raw query result structure varies.
            // Usually [results, metadata]. If RETURNING, results is array of rows.
            masterId = newUser[0].id;
            console.log(`✅ Created new master admin with ID: ${masterId}`);
        }

        // 2. Truncate Business Tables
        const tablesToTruncate = [
            'prospects',
            'cars',
            'drivers',
            'fleet_owners',
            'campaigns',
            'qr_scans',
            'qr_tags',
            'attributions',
            'commissions',
            'prospect_activities',
            'lead_packages',
            'short_link_clicks',
            'short_links',
            'user_payouts',
            'campaign_previews',
            'beacon_events',
            'session_visits'
        ];

        console.log('🗑️  Truncating business tables...');
        for (const table of tablesToTruncate) {
            try {
                await sequelize.query(`TRUNCATE TABLE "${table}" CASCADE;`);
                console.log(`   - Truncated ${table}`);
            } catch (e) {
                if (!e.message.includes('does not exist')) {
                    console.error(`   ! Failed to truncate ${table}: ${e.message}`);
                }
            }
        }

        // 3. Delete non-master users
        console.log('👤 Cleaning up users...');
        await sequelize.query(`DELETE FROM "users" WHERE id != :id`, {
            replacements: { id: masterId }
        });
        console.log('   - Deleted non-master users.');

        console.log('✅ Cleanup complete. Master Admin: ' + MASTER_EMAIL);

    } catch (error) {
        console.error('❌ Fatal error during cleanup:', error);
    } finally {
        await sequelize.close();
    }
}

cleanupRenderDb();
