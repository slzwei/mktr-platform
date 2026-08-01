/**
 * Seed the Lyfe webhook subscriber into the database.
 * Run once: node scripts/seed-lyfe-webhook.js
 */
import dotenv from 'dotenv';
dotenv.config();

import { sequelize } from '../src/database/connection.js';
import WebhookSubscriber from '../src/models/WebhookSubscriber.js';

if (!process.env.LYFE_WEBHOOK_URL || !process.env.LYFE_WEBHOOK_SECRET) {
  console.error('Missing required env vars: LYFE_WEBHOOK_URL, LYFE_WEBHOOK_SECRET');
  process.exit(1);
}

const LYFE_WEBHOOK = {
  name: 'Lyfe App',
  url: process.env.LYFE_WEBHOOK_URL,
  secret: process.env.LYFE_WEBHOOK_SECRET,
  events: ['lead.created', 'lead.assigned', 'lead.unassigned'],
  enabled: true,
  description: 'Push new leads to Lyfe mobile app for agent follow-up'
};

async function main() {
  await sequelize.authenticate();
  await WebhookSubscriber.sync();

  // Upsert by name to match bootstrap.js behavior
  const existing = await WebhookSubscriber.findOne({ where: { name: LYFE_WEBHOOK.name } });
  if (existing) {
    await existing.update(LYFE_WEBHOOK);
    console.log('Updated existing Lyfe webhook subscriber:', existing.id);
  } else {
    const subscriber = await WebhookSubscriber.create(LYFE_WEBHOOK);
    console.log('Created Lyfe webhook subscriber:', subscriber.id);
  }

  await sequelize.close();
}

main().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
