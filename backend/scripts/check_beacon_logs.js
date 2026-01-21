
import 'dotenv/config'; // Load .env
import { BeaconEvent, Device } from '../src/models/index.js';

async function checkBeaconLogs() {
    try {
        console.log('🔍 Checking BeaconEvent table...');
        const count = await BeaconEvent.count();
        console.log(`✅ Total BeaconEvents in DB: ${count}`);

        if (count > 0) {
            const latest = await BeaconEvent.findOne({
                order: [['createdAt', 'DESC']],
                include: [{ model: Device, as: 'device' }]
            });
            console.log('📄 Latest Event:', JSON.stringify(latest.toJSON(), null, 2));
        } else {
            console.log('⚠️ No BeaconEvents found. Devices might not differ heartbeats yet.');
        }

        // List all devices to see IDs
        const devices = await Device.findAll();
        console.log(`📱 Devices found: ${devices.length}`);
        devices.forEach(d => console.log(` - ${d.id} (${d.model}) Last Seen: ${d.lastSeenAt}`));

    } catch (error) {
        console.error('❌ Error checking logs:', error);
    }
}

checkBeaconLogs();
