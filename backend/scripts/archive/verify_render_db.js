
import { sequelize } from '../src/database/connection.js';

async function verifyRenderDb() {
    try {
        console.log('Connecting to Render DB for verification...');
        await sequelize.authenticate();

        // 1. Check Users
        const [users] = await sequelize.query(`SELECT count(*) as count FROM "users"`);
        console.log(`Users count: ${users[0].count} (Expected: 1)`);

        const [master] = await sequelize.query(`SELECT email, role FROM "users"`);
        console.log('Remaining User:', master[0]);

        // 2. Check Business Tables
        const tables = ['prospects', 'cars', 'campaigns', 'qr_tags'];
        for (const table of tables) {
            const [res] = await sequelize.query(`SELECT count(*) as count FROM "${table}"`);
            console.log(`${table} count: ${res[0].count} (Expected: 0)`);
        }

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await sequelize.close();
    }
}

verifyRenderDb();
