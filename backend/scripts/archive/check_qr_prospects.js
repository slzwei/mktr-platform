import { QrTag, Prospect, Campaign } from '../src/models/index.js';

async function checkQrProspects() {
    try {
        console.log('Listing all QR Tags...');
        const qrTags = await QrTag.findAll({
            include: [{ model: Campaign, as: 'campaign', attributes: ['name'] }]
        });

        for (const qr of qrTags) {
            console.log(`\nQR Tag: ${qr.slug} (ID: ${qr.id})`);
            console.log(`  Campaign: ${qr.campaign?.name} (ID: ${qr.campaignId})`);

            const qrCount = await Prospect.count({ where: { qrTagId: qr.id } });
            console.log(`  Prospect Count (by qrTagId): ${qrCount}`);

            if (qr.campaignId) {
                const campaignCount = await Prospect.count({ where: { campaignId: qr.campaignId } });
                console.log(`  Total Prospects in Campaign: ${campaignCount}`);

                // Check overlap
                const overlapCount = await Prospect.count({
                    where: {
                        qrTagId: qr.id,
                        campaignId: qr.campaignId
                    }
                });
                console.log(`  Prospects with BOTH qrTagId AND campaignId: ${overlapCount}`);

                if (qrCount < campaignCount) {
                    // Check if there are prospects in this campaign that DON'T have this QR tag
                    const nonQrCount = await Prospect.count({
                        where: {
                            campaignId: qr.campaignId,
                            qrTagId: null
                        }
                    });
                    console.log(`  Prospects in campaign with NO QR tag: ${nonQrCount}`);
                }
            }
        }

    } catch (error) {
        console.error('Error:', error);
    } finally {
        process.exit();
    }
}

checkQrProspects();
