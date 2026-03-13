import { sequelize } from '../../src/database/connection.js';

async function cleanupRenderDb() {
    const MASTER_EMAIL = 'shawnleeapps@gmail.com';

    try {
        console.log('Connecting to Render DB...');
        await sequelize.authenticate();
        console.log('Connected! Starting cleanup...');

        // 1. Find master admin
        const [users] = await sequelize.query(`SELECT id FROM "users" WHERE email = :email`, {
            replacements: { email: MASTER_EMAIL }
        });

        if (users.length === 0) {
            console.error(`❌ Master user ${MASTER_EMAIL} not found! Aborting.`);
            return;
        }

        const masterId = users[0].id;
        console.log(`✅ Found master admin: ${MASTER_EMAIL}`);

        // 2. Truncate all business tables (leaf tables first, CASCADE handles FKs)
        const tablesToTruncate = [
            'webhook_deliveries',
            'webhook_subscribers',
            'short_link_clicks',
            'short_links',
            'prospect_activities',
            'commissions',
            'lead_package_assignments',
            'lead_packages',
            'impressions',
            'beacon_events',
            'vehicles',
            'devices',
            'attributions',
            'qr_scans',
            'prospects',
            'campaign_previews',
            'round_robin_cursor',
            'qr_tags',
            'campaigns',
            'cars',
            'drivers',
            'fleet_owners',
            'agent_groups',
            'user_payouts',
            'session_visits',
            'verifications',
            'provisioning_sessions',
            'idempotency_keys',
        ];

        console.log('🗑️  Truncating all business tables...');
        for (const table of tablesToTruncate) {
            try {
                await sequelize.query(`TRUNCATE TABLE "${table}" CASCADE;`);
                console.log(`   ✓ ${table}`);
            } catch (e) {
                if (e.message.includes('does not exist')) {
                    console.log(`   - ${table} (not found, skipping)`);
                } else {
                    console.error(`   ✗ ${table}: ${e.message}`);
                }
            }
        }

        // 3. Delete non-master users
        console.log('👤 Deleting non-master users...');
        const [, meta] = await sequelize.query(`DELETE FROM "users" WHERE id != :id`, {
            replacements: { id: masterId }
        });
        console.log(`   ✓ Deleted ${meta?.rowCount ?? '?'} users`);

        // 4. Verify
        const [remaining] = await sequelize.query(`SELECT email, role FROM "users"`);
        console.log('📋 Remaining users:', remaining);

        console.log('✅ Cleanup complete!');

    } catch (error) {
        console.error('❌ Fatal error during cleanup:', error);
    } finally {
        await sequelize.close();
    }
}

cleanupRenderDb();
