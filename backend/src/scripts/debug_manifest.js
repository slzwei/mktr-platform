import { sequelize } from '../database/connection.js';
import { Device, Campaign } from '../models/index.js';

async function run() {
    try {
        console.log("--- START DEBUG MANIFEST (PHASE 2) ---");

        // 1. Fetch latest device (most recently updated/seen)
        const device = await Device.findOne({
            order: [['updatedAt', 'DESC']]
        });

        if (!device) {
            console.error("No device found in DB.");
            return;
        }

        console.log(`Device Found: ${device.id}`);
        console.log(`Updated At: ${device.updatedAt}`);

        // 2. Inspect Raw IDs
        let campaignIds = device.campaignIds;
        console.log(`Raw campaignIds from DB:`, JSON.stringify(campaignIds));
        console.log(`Type of campaignIds:`, typeof campaignIds);

        // Parse if string (SQLite/Legacy safety)
        if (typeof campaignIds === 'string') {
            try {
                campaignIds = JSON.parse(campaignIds);
                console.log("Parsed string to JSON:", campaignIds);
            } catch (e) {
                console.error("Failed to parse campaignIds string:", e.message);
            }
        }

        if (!Array.isArray(campaignIds)) {
            campaignIds = [];
            if (device.campaignId) campaignIds.push(device.campaignId);
        }

        console.log(`Final ID List (${campaignIds.length}):`, campaignIds);

        // 3. Fetch Campaigns
        const campaigns = await Campaign.findAll({
            where: { id: campaignIds }
        });

        console.log(`\nFetched ${campaigns.length} campaigns from DB.`);

        // 4. Manifest Simulation
        campaigns.forEach(c => {
            console.log(`[${c.status.toUpperCase()}] ${c.name} (${c.type})`);
        });

        const activePhv = campaigns.filter(c => c.status === 'active' && c.type === 'brand_awareness');
        console.log(`\nManifest would contain: ${activePhv.length} campaigns.`);
        activePhv.forEach(c => console.log(` - ${c.name}`));

    } catch (error) {
        console.error('Debug script failed:', error);
    } finally {
        await sequelize.close();
    }
}

run();
