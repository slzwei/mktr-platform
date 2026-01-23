
import { storageService } from '../src/services/storage.js';

async function run() {
    try {
        console.log("--- Testing Deletion Logic ---");

        // 1. Mock a real CDN url (based on user's env)
        const cdnBase = process.env.DO_SPACES_CDN_BASE || 'https://leadgen-uploads.sgp1.cdn.digitaloceanspaces.com';
        const fileKey = 'test-delete-check.txt';
        const fullUrl = `${cdnBase}/${fileKey}`;

        console.log(`target URL: ${fullUrl}`);

        // 2. Logic copy-pasted from campaigns.js
        console.log("Running extraction logic...");
        const urlObj = new URL(fullUrl);
        const key = urlObj.pathname.substring(1);
        console.log(`Extracted Key: "${key}"`);

        if (key !== fileKey) {
            console.error(`❌ Key mismatch! Expected "${fileKey}", got "${key}"`);
        } else {
            console.log("✅ Key extraction correct.");
        }

        // 3. Dry run check of service
        if (!storageService.isEnabled()) {
            console.log("⚠️ Storage service NOT enabled in this environment.");
        } else {
            console.log("✅ Storage service IS enabled.");
            // We won't actually delete unless we upload something first, but this proves the logic flow.
        }

    } catch (e) {
        console.error("Test Error:", e);
    }
}

// Mock env if needed for local test without loading dotfiles
if (!process.env.DO_SPACES_CDN_BASE) {
    process.env.DO_SPACES_CDN_BASE = 'https://leadgen-uploads.sgp1.cdn.digitaloceanspaces.com';
    process.env.DO_SPACES_BUCKET = 'leadgen-uploads';
    process.env.DO_SPACES_REGION = 'sgp1';
    process.env.DO_SPACES_ENDPOINT = 'https://sgp1.digitaloceanspaces.com';
    // key/secret deliberately omitted to avoid real ops unless env loaded
}

run();
