
import { sequelize } from '../src/database/connection.js';

async function checkAdmin() {
    try {
        console.log('Connecting to DB...');
        await sequelize.authenticate();

        // Check users table for master admin
        const [users] = await sequelize.query(`SELECT * FROM "users" WHERE email = 'admin@tetrapass.com'`);

        if (users.length > 0) {
            console.log('Found Master Admin:', users[0]);
        } else {
            console.log('Master Admin NOT FOUND in users table.');
            // List all users to see who is there
            const [allUsers] = await sequelize.query(`SELECT id, email, role FROM "users" LIMIT 10`);
            console.log('First 10 users:', allUsers);
        }

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await sequelize.close();
    }
}

checkAdmin();
