import { Campaign } from '../src/models/index.js';

async function checkCampaignUrls() {
    try {
        const campaigns = await Campaign.findAll();

        console.log(`Found ${campaigns.length} total campaigns in database.`);

        for (const c of campaigns) { // Iterate through campaigns
            console.log(`Checking Campaign: ${c.id} (${c.name})`);
            console.log(`  Raw Playlist Data:`, JSON.stringify(c.ad_playlist, null, 2));

            if (c.ad_playlist && Array.isArray(c.ad_playlist)) {
                c.ad_playlist.forEach((item, idx) => {
                    if (item.url && item.url.includes('192.168')) {
                        console.log(`[ALERT] Found local IP in Campaign ID: ${c.id}, Name: "${c.name}"`);
                        foundIssue = true;
                    }
                });
            } else {
                console.log(`  [WARN] ad_playlist is not an array or is empty.`);
            }
        }

        if (!foundIssue) {
            console.log("No local IPs found in active Brand Awareness campaigns.");
        }

    } catch (error) {
        console.error("Error inspecting campaigns:", error);
    } finally {
        process.exit();
    }
}

checkCampaignUrls();
