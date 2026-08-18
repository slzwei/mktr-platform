#!/usr/bin/env node
/**
 * Opt-in, credentialed validateOnly smoke for the Data Manager envelopes
 * (plan google-ads-signal-levers §4.4 / §9) — NEVER CI, never deployed
 * (scripts/ is dockerignored). Run locally with the real GOOGLE_DM_* env
 * before the first flip: validate-only requests are parsed and validated by
 * Google but NOT executed, so this pins the envelope field names against
 * the live API without ingesting anything.
 *
 * Usage:
 *   GOOGLE_DM_OAUTH_CLIENT_ID=… GOOGLE_DM_OAUTH_CLIENT_SECRET=… \
 *   GOOGLE_DM_REFRESH_TOKEN=… GOOGLE_ADS_CUSTOMER_ID=1829163947 \
 *   GOOGLE_CM_USER_LIST_ID=… GOOGLE_CONV_ACTION_QUALIFIED=… \
 *     node scripts/google-dm-validate-smoke.mjs
 */
import crypto from 'crypto';
import { dmRequest } from '../src/utils/googleDataManagerClient.js';
import { buildIngestBody } from '../src/services/googleCustomerMatchService.js';
import { buildOutcomeEnvelope } from '../src/services/googleOfflineConversionsService.js';

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');

async function main() {
  const results = [];
  const run = async (name, method, body) => {
    try {
      const res = await dmRequest(method, { ...body, validateOnly: true });
      results.push({ name, ok: true, requestId: res?.requestId || null });
    } catch (err) {
      results.push({ name, ok: false, error: err.message });
    }
  };

  // Customer Match ingest — one synthetic member (validate-only: not stored).
  await run('cm-ingest', 'audienceMembers:ingest', buildIngestBody([
    { userIdentifiers: [{ emailAddress: sha('smoke@example.com') }, { phoneNumber: sha('+6590000000') }] },
  ]));

  // Outcome events — click-only and consented-PII variants.
  const prospect = {
    id: 'validate-smoke',
    email: 'smoke@example.com',
    phone: '+6590000000',
    sourceMetadata: { gcl: { gclid: 'SMOKE_GCLID' } },
  };
  await run('outcome-click-only', 'events:ingest',
    buildOutcomeEnvelope(prospect, 'confirmed_resident', new Date().toISOString(), {
      adIdentifiers: { gclid: 'SMOKE_GCLID' },
      userIdentifiers: [],
    }));
  await run('outcome-consented-pii', 'events:ingest',
    buildOutcomeEnvelope(prospect, 'confirmed_resident', new Date().toISOString(), {
      adIdentifiers: {},
      userIdentifiers: [{ emailAddress: sha('smoke@example.com') }],
    }));

  for (const r of results) console.log(JSON.stringify(r));
  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    console.error(`\n${failed.length} envelope(s) rejected — fix field names before flipping.`);
    process.exit(1);
  }
  console.log('\nAll envelopes validated. (validate-only: nothing was ingested.)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
