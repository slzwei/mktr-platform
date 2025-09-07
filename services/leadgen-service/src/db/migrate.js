import { withClient, SCHEMA } from './index.js';
import { ensureIdempotencyTable } from '../lib/idempotency.js';

async function ensureSchema(client) {
  await client.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);
}

async function createTables(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${SCHEMA}.qr_tags (
      id uuid PRIMARY KEY,
      tenant_id uuid NOT NULL,
      campaign_id uuid NULL,
      car_id uuid NULL,
      owner_user_id uuid NULL,
      code text UNIQUE NOT NULL,
      status text NOT NULL,
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_qr_tags_tenant ON ${SCHEMA}.qr_tags(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_qr_tags_campaign ON ${SCHEMA}.qr_tags(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_qr_tags_car ON ${SCHEMA}.qr_tags(car_id);
    CREATE INDEX IF NOT EXISTS idx_qr_tags_owner ON ${SCHEMA}.qr_tags(owner_user_id);
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS ${SCHEMA}.qr_scans (
      id uuid PRIMARY KEY,
      tenant_id uuid NOT NULL,
      qr_tag_id uuid NOT NULL REFERENCES ${SCHEMA}.qr_tags(id),
      ts timestamptz DEFAULT now(),
      ip inet NULL,
      ua text NULL,
      geo_json jsonb NULL
    );
    CREATE INDEX IF NOT EXISTS idx_qr_scans_tenant ON ${SCHEMA}.qr_scans(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_qr_scans_tag ON ${SCHEMA}.qr_scans(qr_tag_id);
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS ${SCHEMA}.prospects (
      id uuid PRIMARY KEY,
      tenant_id uuid NOT NULL,
      qr_tag_id uuid NULL,
      campaign_id uuid NULL,
      assigned_agent_id uuid NULL,
      status text NOT NULL,
      payload_json jsonb NOT NULL,
      verified_at timestamptz NULL,
      created_at timestamptz DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_prospects_tenant ON ${SCHEMA}.prospects(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_prospects_qr ON ${SCHEMA}.prospects(qr_tag_id);
    CREATE INDEX IF NOT EXISTS idx_prospects_campaign ON ${SCHEMA}.prospects(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_prospects_agent ON ${SCHEMA}.prospects(assigned_agent_id);
    CREATE INDEX IF NOT EXISTS idx_prospects_status ON ${SCHEMA}.prospects(status);
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS ${SCHEMA}.commissions (
      id uuid PRIMARY KEY,
      tenant_id uuid NOT NULL,
      prospect_id uuid NOT NULL REFERENCES ${SCHEMA}.prospects(id),
      agent_id uuid NOT NULL,
      amount_cents integer NOT NULL,
      status text NOT NULL,
      created_at timestamptz DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_commissions_tenant ON ${SCHEMA}.commissions(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_commissions_prospect ON ${SCHEMA}.commissions(prospect_id);
    CREATE INDEX IF NOT EXISTS idx_commissions_agent ON ${SCHEMA}.commissions(agent_id);
    CREATE INDEX IF NOT EXISTS idx_commissions_status ON ${SCHEMA}.commissions(status);
  `);

  // Idempotency keys table in leadgen schema
  await ensureIdempotencyTable(client);
}

async function tableIsEmpty(client, fqtn) {
  const { rows } = await client.query(`SELECT COUNT(*)::int AS c FROM ${fqtn}`);
  return rows[0].c === 0;
}

async function copyDevDataIfEmpty(client) {
  // Map monolith tables into leadgen schema only when empty; keep IDs
  const qrTagsEmpty = await tableIsEmpty(client, `${SCHEMA}.qr_tags`);
  if (qrTagsEmpty) {
    await client.query(`
      INSERT INTO ${SCHEMA}.qr_tags (id, tenant_id, campaign_id, car_id, owner_user_id, code, status, created_at, updated_at)
      SELECT id, tenant_id, "campaignId", "carId", "ownerUserId", COALESCE("slug", id::text) AS code,
             CASE WHEN active THEN 'active' ELSE 'inactive' END AS status,
             NOW(), NOW()
      FROM public.qr_tags
      ON CONFLICT (id) DO NOTHING;
    `);
  }

  const qrScansEmpty = await tableIsEmpty(client, `${SCHEMA}.qr_scans`);
  if (qrScansEmpty) {
    await client.query(`
      INSERT INTO ${SCHEMA}.qr_scans (id, tenant_id, qr_tag_id, ts, ip, ua, geo_json)
      SELECT id,
             (SELECT tenant_id FROM public.qr_tags t WHERE t.id = s."qrTagId") AS tenant_id,
             s."qrTagId", s.ts, NULL::inet, s.ua,
             jsonb_build_object('referer', s.referer, 'device', s.device, 'geoCity', s."geoCity", 'botFlag', s."botFlag", 'isDuplicate', s."isDuplicate")
      FROM public.qr_scans s
      ON CONFLICT (id) DO NOTHING;
    `);
  }

  const prospectsEmpty = await tableIsEmpty(client, `${SCHEMA}.prospects`);
  if (prospectsEmpty) {
    await client.query(`
      INSERT INTO ${SCHEMA}.prospects (id, tenant_id, qr_tag_id, campaign_id, assigned_agent_id, status, payload_json, verified_at, created_at)
      SELECT id, tenant_id, "qrTagId", "campaignId", "assignedAgentId",
             LOWER(COALESCE("leadStatus"::text, 'new')) AS status,
             jsonb_build_object(
               'firstName', "firstName", 'lastName', "lastName", 'email', email, 'phone', phone,
               'company', company, 'jobTitle', "jobTitle", 'source', "leadSource",
               'score', score, 'interests', interests::jsonb, 'notes', notes,
               'location', location::jsonb, 'preferences', preferences::jsonb
             ) AS payload_json,
             "conversionDate" AS verified_at,
             COALESCE("createdAt", NOW()) AS created_at
      FROM public.prospects
      ON CONFLICT (id) DO NOTHING;
    `);
  }

  const commissionsEmpty = await tableIsEmpty(client, `${SCHEMA}.commissions`);
  if (commissionsEmpty) {
    await client.query(`
      INSERT INTO ${SCHEMA}.commissions (id, tenant_id, prospect_id, agent_id, amount_cents, status, created_at)
      SELECT id, tenant_id, COALESCE("prospectId", gen_random_uuid()), "agentId",
             ROUND((COALESCE(amount, 0) * 100))::int AS amount_cents,
             LOWER(COALESCE(status::text, 'pending')) AS status,
             COALESCE("earnedDate", NOW()) AS created_at
      FROM public.commissions
      ON CONFLICT (id) DO NOTHING;
    `);
  }
}

export default async function migrate() {
  await withClient(async (client) => {
    // Ensure required extensions (dev)
    try { await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto'); } catch {}
    try { await client.query('CREATE EXTENSION IF NOT EXISTS uuid-ossp'); } catch {}
    await ensureSchema(client);
    await createTables(client);
    await copyDevDataIfEmpty(client);
  });
}

if (process.argv[1] && process.argv[1].endsWith('migrate.js')) {
  migrate().then(() => {
    console.log(`[leadgen:migrate] ok schema=${SCHEMA}`);
    process.exit(0);
  }).catch((e) => {
    console.error('[leadgen:migrate] failed', e);
    process.exit(1);
  });
}


