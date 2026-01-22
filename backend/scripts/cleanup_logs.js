
import { sequelize, BeaconEvent } from '../src/models/index.js';
import { Op } from 'sequelize';

async function cleanupLogs() {
    console.log('🧹 Starting cleanupLogs...');

    try {
        const retentionDays = 7;
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

        console.log(`🧹 Deleting BeaconEvents older than ${cutoffDate.toISOString()}...`);

        const deletedCount = await BeaconEvent.destroy({
            where: {
                createdAt: {
                    [Op.lt]: cutoffDate
                }
            }
        });

        console.log(`✅ Cleanup complete. Deleted ${deletedCount} old logs.`);

        // Note: We do NOT delete Impressions automatically yet as they are revenue critical.
        // Future: Move old impressions to S3/Cold Storage.

    } catch (error) {
        console.error('❌ cleanupLogs failed:', error);
    }
}

// Allow running standalone
if (process.argv[1] === import.meta.url || process.argv[1].endsWith('cleanup_logs.js')) {
    cleanupLogs().then(() => {
        // Only exit if standalone, otherwise let the caller handle it (if integrated into cron)
        if (process.argv[1].endsWith('cleanup_logs.js')) process.exit(0);
    });
}

export { cleanupLogs };
