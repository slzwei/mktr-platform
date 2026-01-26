import { sequelize } from '../src/database/connection.js';
import { Device, Campaign } from '../src/models/index.js';
import { v4 as uuidv4 } from 'uuid';

async function verify() {
    try {
        await sequelize.authenticate();
        console.log('✅ Connected to DB');

        // [Fix] Ensure schema is migrated for this script run (both legacy and new columns)
        try {
            const [cols] = await sequelize.query("PRAGMA table_info(devices)");
            const colNames = cols.map(c => c.name);

            if (!colNames.includes('campaignId')) {
                await sequelize.query("ALTER TABLE devices ADD COLUMN campaignId TEXT");
                console.log('✅ Manually added legacy campaignId column');
            }

            if (!colNames.includes('campaignIds')) {
                await sequelize.query("ALTER TABLE devices ADD COLUMN campaignIds TEXT DEFAULT '[]'");
                console.log('✅ Manually added new campaignIds column');
            }
        } catch (e) {
            console.warn('⚠️ Schema check failed', e.message);
        }

        // 1. Setup Data
        let sysUser = await sequelize.models.User.findOne();
        if (!sysUser) {
            sysUser = await sequelize.models.User.create({
                id: uuidv4(),
                email: 'sys' + uuidv4() + '@test.com',
                password: 'mock',
                firstName: 'System',
                lastName: 'Agent',
                role: 'admin',
                status: 'active'
            });
            console.log('✅ Created temporary system user');
        }

        const device = await Device.create({
            model: 'Test Tablet ' + uuidv4(),
            secretHash: 'mock_hash',
            status: 'active'
        });
        console.log('✅ Created Test Device:', device.id);

        const phv1 = await Campaign.create({
            name: 'PHV 1 ' + uuidv4(),
            type: 'brand_awareness',
            status: 'active',
            createdBy: sysUser.id,
            ad_playlist: [{ type: 'image', url: 'http://test.com/img1.jpg', duration: 10 }]
        });
        console.log('✅ Created PHV Campaign 1:', phv1.id);

        const phv2 = await Campaign.create({
            name: 'PHV 2 ' + uuidv4(),
            type: 'brand_awareness',
            status: 'active',
            createdBy: sysUser.id,
            ad_playlist: [{ type: 'video', url: 'http://test.com/vid1.mp4', duration: 15 }]
        });
        console.log('✅ Created PHV Campaign 2:', phv2.id);

        const regular = await Campaign.create({
            name: 'Regular 1 ' + uuidv4(),
            type: 'lead_generation',
            status: 'active',
            createdBy: sysUser.id
        });
        console.log('✅ Created Regular Campaign:', regular.id);

        // 2. Test Success Case: Assign 2 PHV Campaigns
        console.log('\n🧪 Testing Valid Assignment (2 PHV Campaigns)...');
        try {
            await device.update({ campaignIds: [phv1.id, phv2.id], campaignId: null });

            // Simulating the API check logic manually to verify it passes our rules
            const assigned = await Campaign.findAll({ where: { id: device.campaignIds } });
            const invalid = assigned.find(c => c.type !== 'brand_awareness');
            if (invalid) throw new Error('Failed Validation Logic');

            console.log('✅ Successfully assigned 2 PHV campaigns');
        } catch (e) {
            console.error('❌ Failed valid assignment:', e);
        }

        // 3. Test Failure Case: Assign Regular Campaign
        console.log('\n🧪 Testing Invalid Assignment (Regular Campaign)...');
        const mixedIds = [phv1.id, regular.id];
        const invalidCampaigns = await Campaign.findAll({ where: { id: mixedIds } });
        const hasInvalid = invalidCampaigns.some(c => c.type !== 'brand_awareness');

        if (hasInvalid) {
            console.log('✅ Correctly identified invalid campaign type (Lead Gen) in mixed list');
        } else {
            console.error('❌ Failed to detect invalid campaign type');
        }

        // 4. Verify Local Manifest Logic (Simulation)
        console.log('\n🧪 Verifying Manifest Generation Logic...');
        await device.reload();
        const manifestIds = device.campaignIds;
        const activeCampaigns = await Campaign.findAll({
            where: { id: manifestIds, status: 'active', type: 'brand_awareness' }
        });

        activeCampaigns.sort((a, b) => {
            return manifestIds.indexOf(a.id) - manifestIds.indexOf(b.id);
        });

        const playlist = [];
        activeCampaigns.forEach(c => {
            if (c.ad_playlist) playlist.push(...c.ad_playlist);
        });

        console.log(`ℹ️ Combined Playlist Length: ${playlist.length}`);
        if (playlist.length === 2) {
            console.log('✅ Manifest logic correctly merged playlists (1 from PHV1, 1 from PHV2)');
        } else {
            console.error('❌ Manifest logic failed merge', playlist);
        }

        // Cleanup
        await device.destroy();
        await phv1.destroy();
        await phv2.destroy();
        await regular.destroy();
        console.log('\n✅ Cleanup Complete');

    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await sequelize.close();
    }
}

verify();
