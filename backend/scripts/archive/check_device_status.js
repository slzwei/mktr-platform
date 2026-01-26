import { sequelize, Device } from '../src/models/index.js';

async function checkStatus() {
    try {
        console.log("Connecting to DB...");
        await sequelize.authenticate();
        console.log("Connected.");

        const devices = await Device.findAll();
        console.log(`Found ${devices.length} devices.`);

        devices.forEach(d => {
            console.log(`Device ID: ${d.id}`);
            console.log(`  Model: ${d.model}`);
            console.log(`  Last Seen (Raw):`, d.lastSeenAt);
            console.log(`  Last Seen (ISO):`, d.lastSeenAt ? new Date(d.lastSeenAt).toISOString() : 'NULL');
            console.log('---');
        });

    } catch (err) {
        console.error("Error:", err);
    } finally {
        await sequelize.close();
    }
}

checkStatus();
