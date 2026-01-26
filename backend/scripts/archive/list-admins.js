
import { sequelize } from '../src/database/connection.js';
import { User } from '../src/models/index.js';

async function listAdmins() {
    try {
        await sequelize.authenticate();
        console.log('Connected to database.');

        const admins = await User.findAll({
            where: { role: 'admin' },
            attributes: ['id', 'email', 'firstName', 'lastName', 'createdAt']
        });

        if (admins.length === 0) {
            console.log('No admin users found.');
        } else {
            console.log('Found admin users:');
            admins.forEach(admin => {
                console.log(`- ${admin.email} (ID: ${admin.id}, Name: ${admin.firstName} ${admin.lastName})`);
            });
        }

    } catch (error) {
        console.error('Error listing admins:', error);
    } finally {
        await sequelize.close();
    }
}

listAdmins();
