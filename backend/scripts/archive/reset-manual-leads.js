
// import { sequelize } from '../src/database/connection.js'; // REMOVE static import
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Force load backend/.env
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendEnvPath = path.resolve(__dirname, '../.env');

dotenv.config({ path: backendEnvPath });

async function resetManualLeads() {
    let sequelizeInstance;
    try {
        // Dynamic import to ensure env is loaded first
        const { User, sequelize } = await import('../src/models/index.js');
        sequelizeInstance = sequelize;

        console.log('🔄 Resetting manual owed_leads_count for ALL users to 0...');

        const [results, metadata] = await sequelize.query(
            `UPDATE "users" SET "owed_leads_count" = 0 WHERE "owed_leads_count" != 0`
        );

        // Postgres returns metadata with rowCount/rowCount depending on version, 
        // usually metadata is the result object in update queries for generic sequelzie, 
        // but for specific dialect raw queries:
        // Postgres: [results, metadata]. metadata.rowCount is what we want.

        console.log(`✅ Reset complete. Rows affected: ${metadata?.rowCount ?? 'unknown'}`);

    } catch (error) {
        console.error('❌ Error resetting manual leads:', error);
    } finally {
        if (sequelizeInstance) await sequelizeInstance.close();
    }
}

resetManualLeads();
