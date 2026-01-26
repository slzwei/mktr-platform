import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load .env from backend root
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '../.env');
console.log(`Loading .env from: ${envPath}`);
dotenv.config({ path: envPath });

async function checkStats() {
    try {
        // Dynamic import to ensure env vars are loaded BEFORE connection.js runs
        const { Prospect, sequelize } = await import('../src/models/index.js');

        console.log('Checking database connection...');
        await sequelize.authenticate();
        console.log('Connection established.');

        const total = await Prospect.count();
        console.log('Total Prospects:', total);

        if (total > 0) {
            const stats = await Prospect.findAll({
                attributes: ['leadStatus', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
                group: ['leadStatus']
            });

            console.log('Status Distribution:');
            stats.forEach(s => {
                console.log(`${s.leadStatus || 'NULL'}: ${s.get('count')}`);
            });
        }
    } catch (error) {
        console.error('Error:', error);
    }
    // Process will exit naturally or we can force close if needed, but since dynamic import, we have access to sequelize inside
}

checkStats();
