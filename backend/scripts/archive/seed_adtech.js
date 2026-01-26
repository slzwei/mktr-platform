import crypto from 'crypto';
import { sequelize, Device, Campaign, User } from '../src/models/index.js';

async function seed() {
    console.log("Applying Schema Changes...");
    try {
        await sequelize.query('ALTER TABLE devices ADD COLUMN IF NOT EXISTS "campaignId" UUID;');
        await sequelize.query('ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS "ad_playlist" JSON DEFAULT \'[]\';');
    } catch (e) {
        console.log("Schema alter warning (might already exist):", e.message);
    }

    // Refresh models after schema change
    await sequelize.sync();

    const deviceKey = 'test-device-key';
    const secretHash = crypto.createHash('sha256').update(deviceKey).digest('hex');

    // 1. Find or Create Device
    let [device] = await Device.findOrCreate({
        where: { secretHash },
        defaults: {
            status: 'active',
            model: 'Test Emulator',
            externalId: 'emu-001'
        }
    });
    console.log(`Device ID: ${device.id}`);

    // 2. Find a Creator User (any admin)
    const user = await User.findOne();
    if (!user) {
        console.error("No users found! Please run regular seed first.");
        process.exit(1);
    }

    // 3. Create Campaign with Playlist
    const campaign = await Campaign.create({
        name: "Phase 3 Demo Campaign",
        status: 'active',
        createdBy: user.id,
        ad_playlist: [
            {
                id: "demo_item_1",
                type: "image",
                url: "https://picsum.photos/seed/phase3/1920/1080",
                duration: 5
            },
            {
                id: "demo_item_2",
                type: "video",
                url: "https://storage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
                duration: 15
            }
        ]
    });
    console.log(`Campaign Created: ${campaign.id}`);

    // 4. Assign
    await device.update({ campaignId: campaign.id });
    console.log("Assigned Campaign to Device!");

    process.exit(0);
}

seed().catch(err => {
    console.error(err);
    process.exit(1);
});
