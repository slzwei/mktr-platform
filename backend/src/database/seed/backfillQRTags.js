import fs from 'fs';
import path from 'path';
import QRCode from 'qrcode';
import { fileURLToPath } from 'url';
import { sequelize, QrTag } from '../../models/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsDir = path.join(__dirname, '../../uploads/image');

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

  // Ensure models are synced in dev (SQLite)
  await sequelize.sync();

  const tags = await QrTag.findAll();
  let updated = 0;

  for (const tag of tags) {
    let changed = false;

    // Ensure slug (normalized lowercase a-z0-9)
    if (!tag.slug) {
      const slug = (Math.random().toString(36).slice(2, 12)).replace(/[^a-z0-9]/g, '');
      tag.slug = slug.toLowerCase();
      changed = true;
    } else {
      const normalized = tag.slug.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 64);
      if (normalized !== tag.slug) {
        tag.slug = normalized;
        changed = true;
      }
    }

    // Ensure PNG
    if (!tag.qrImageUrl) {
      const linkPath = `/t/${tag.slug}`;
      const fileName = `qr-${tag.slug}.png`;
      const filePath = path.join(uploadsDir, fileName);
      if (!dryRun) {
        const pngBuffer = await QRCode.toBuffer(linkPath, { type: 'png', width: 600, margin: 2 });
        fs.writeFileSync(filePath, pngBuffer);
      }
      tag.qrImageUrl = `/uploads/image/${fileName}`;
      changed = true;
    }

    if (changed && !dryRun) {
      await tag.save();
      updated++;
    }
  }

  console.log(`Backfill complete. Updated: ${updated}/${tags.length}. Dry-run: ${dryRun}`);
  await sequelize.close();
}

main().catch(async (e) => {
  console.error('Backfill error:', e);
  await sequelize.close();
  process.exit(1);
});


