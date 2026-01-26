import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function cleanupLogs() {
    const logDir = path.join(__dirname, '../../logs');

    // Create logs directory if it doesn't exist
    if (!fs.existsSync(logDir)) {
        try {
            fs.mkdirSync(logDir, { recursive: true });
        } catch (e) {
            console.error('[Cleanup] Failed to create log directory:', e);
            return;
        }
    }

    console.log('[Cleanup] Checking for old logs...');

    try {
        const files = fs.readdirSync(logDir);
        const now = Date.now();
        const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

        for (const file of files) {
            if (!file.endsWith('.log')) continue;

            const filePath = path.join(logDir, file);
            const stats = fs.statSync(filePath);

            if (now - stats.mtimeMs > MAX_AGE_MS) {
                console.log(`[Cleanup] Deleting old log file: ${file}`);
                fs.unlinkSync(filePath);
            }
        }
    } catch (error) {
        console.error('[Cleanup] Error during log cleanup:', error);
    }
}
