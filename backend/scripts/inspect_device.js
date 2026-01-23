
import { sequelize, Device } from '../src/models/index.js';

async function checkDevice() {
    try {
        console.log('🔍 Connecting...');
        await sequelize.authenticate();

        const deviceId = 'e74a91e3-a077-41a6-9bed-2a5a01970940';
        console.log(`\n📊 Checking Device: ${deviceId}`);

        const device = await Device.findByPk(deviceId);

        if (!device) {
            console.error('❌ Device NOT FOUND');
        } else {
            console.log('✅ Device Found');
            console.log(`Status: ${device.status}`);
            console.log(`Last Seen: ${device.lastSeenAt}`);
            console.log(`Secret Hash (First 10): ${device.secretHash.substring(0, 10)}...`);

            // Generate what the hash expects if we knew the key? No, we can't reverse it.
            // But we can verify if status is 'active'.
        }

    } catch (err) {
        console.error('❌ Error:', err);
    } finally {
        await sequelize.close();
    }
}

checkDevice();
