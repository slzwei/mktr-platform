
import { sequelize } from '../src/database/connection.js';

async function checkDb() {
    try {
        console.log('Connecting to DB...');
        await sequelize.authenticate();
        console.log('Connected!');

        const [results] = await sequelize.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE';
    `);

        // Convert to simple array and sort
        const tables = results.map(r => r.table_name).sort();
        console.log('Tables found:', tables);

        // Try to find the admin user again, but checking correct table name
        if (tables.includes('admin_users')) {
            const [users] = await sequelize.query(`SELECT id, email FROM "admin_users"`);
            console.log('admin_users count:', users.length);
            console.log('Sample admin_users:', users);
        } else {
            console.log('No admin_users table found.');
        }

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await sequelize.close();
    }
}

checkDb();
