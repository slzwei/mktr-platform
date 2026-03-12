/**
 * Seed the Lyfe webhook subscriber into the database.
 * Run once: node scripts/seed-lyfe-webhook.js
 */
import dotenv from 'dotenv';
dotenv.config();

import { sequelize } from '../src/database/connection.js';
import WebhookSubscriber from '../src/models/WebhookSubscriber.js';

const LYFE_WEBHOOK = {
  name: 'Lyfe App',
  url: 'https://nvtedkyjwulkzjeoqjgx.supabase.co/functions/v1/receive-mktr-lead',
  secret: '***REMOVED***',
  events: ['lead.created'],
  enabled: true,
  description: 'Push new leads to Lyfe mobile app for agent follow-up'
};

async function main() {
  await sequelize.authenticate();
  await WebhookSubscriber.sync();

  // Upsert by URL to avoid duplicates
  const existing = await WebhookSubscriber.findOne({ where: { url: LYFE_WEBHOOK.url } });
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
