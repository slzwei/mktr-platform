
import { sequelize } from '../src/database/connection.js';

async function listUsers() {
    try {
        console.log('Connecting to DB...');
        await sequelize.authenticate();

        // List first 20 users with roles
        const [users] = await sequelize.query(`SELECT id, email, role FROM "users" LIMIT 20`);
        console.log('Available Users:', users);

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await sequelize.close();
    }
}

listUsers();
