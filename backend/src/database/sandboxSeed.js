import crypto from 'crypto';
import dotenv from 'dotenv';
import { sequelize } from './connection.js';
import { validateDeployment } from '../config/sandboxValidation.js';
import { isSandbox, flagOn } from '../utils/deployEnv.js';
import {
  User,
  Campaign,
  Prospect,
  LeadPackage,
  LeadPackageAssignment,
} from '../models/index.js';

dotenv.config();

/**
 * `sandbox:seed` — deterministic, idempotent synthetic fixtures.
 *
 * Everything here is invented. No production user, lead, campaign, foreign id,
 * Supabase id, advertising id, pixel or provider transaction id is copied — the
 * only value reused from the real world is the SHAPE of a phone number, and the
 * numbers themselves come from the unused fixed-OTP block
 * `+6580000201`–`+6580000210` (docs/plans/mktr-production-sandbox.md §7.1), which
 * outboundPolicy hard-denies from every live rail.
 *
 * Identity is by stable natural key, so re-running updates in place: a second run
 * creates no duplicates and preserves every id.
 *
 * Addresses use `sandbox.example.com`: `example.com` is IANA-reserved, cannot be
 * registered and publishes no MX, so mail to it is undeliverable by construction
 * — while still being a syntactically valid address the login form accepts. A
 * `.invalid` address is safer on paper and unusable in practice, because it
 * fails the request validator and no seeded user could ever sign in.
 */

const NAMESPACE = 'mktr-sandbox-v1';

/** Deterministic RFC-4122-shaped UUID from a stable key — same key, same id, forever. */
export function stableUuid(key) {
  const h = crypto.createHash('sha1').update(`${NAMESPACE}:${key}`).digest();
  const b = Buffer.from(h.subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x50; // version 5
  b[8] = (b[8] & 0x3f) | 0x80; // RFC variant
  const hex = b.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * The permission-boundary cast (plan §7). One seeded user per authorization
 * boundary acceptance needs, each on its own fixed-OTP number.
 */
export const SEED_USERS = [
  { key: 'admin', phone: '+6580000201', email: 'sandbox.admin@sandbox.example.com', firstName: 'Sandbox', lastName: 'Admin', role: 'admin', redeemOpsRole: null },
  { key: 'agent', phone: '+6580000202', email: 'sandbox.agent@sandbox.example.com', firstName: 'Sandbox', lastName: 'Agent', role: 'agent', redeemOpsRole: null },
  { key: 'ops-super', phone: '+6580000203', email: 'sandbox.ops.super@sandbox.example.com', firstName: 'Sandbox', lastName: 'OpsSuper', role: 'redeem_ops', redeemOpsRole: 'super_admin' },
  { key: 'ops-admin', phone: '+6580000204', email: 'sandbox.ops.admin@sandbox.example.com', firstName: 'Sandbox', lastName: 'OpsAdmin', role: 'redeem_ops', redeemOpsRole: 'ops_admin' },
  { key: 'ops-bdm', phone: '+6580000205', email: 'sandbox.ops.bdm@sandbox.example.com', firstName: 'Sandbox', lastName: 'Bdm', role: 'redeem_ops', redeemOpsRole: 'bdm' },
  { key: 'ops-outreach', phone: '+6580000206', email: 'sandbox.ops.outreach@sandbox.example.com', firstName: 'Sandbox', lastName: 'Outreach', role: 'redeem_ops', redeemOpsRole: 'outreach_exec' },
  { key: 'ops-campaign', phone: '+6580000207', email: 'sandbox.ops.campaign@sandbox.example.com', firstName: 'Sandbox', lastName: 'CampaignOps', role: 'redeem_ops', redeemOpsRole: 'campaign_ops' },
  { key: 'ops-redemption', phone: '+6580000208', email: 'sandbox.ops.redemption@sandbox.example.com', firstName: 'Sandbox', lastName: 'RedemptionOps', role: 'redeem_ops', redeemOpsRole: 'redemption_ops' },
  { key: 'ops-analyst', phone: '+6580000209', email: 'sandbox.ops.analyst@sandbox.example.com', firstName: 'Sandbox', lastName: 'Analyst', role: 'redeem_ops', redeemOpsRole: 'analyst' },
  { key: 'consumer', phone: '+6580000210', email: 'sandbox.consumer@sandbox.example.com', firstName: 'Sandbox', lastName: 'Consumer', role: 'customer', redeemOpsRole: null },
];

const SEED_CAMPAIGNS = [
  {
    key: 'standard',
    name: 'Sandbox Standard Campaign',
    slug: 'sandbox-standard',
    status: 'active',
    is_active: true,
    description: 'Synthetic active campaign for the sandbox lead-capture walkthrough.',
    dncCheckAtSubmit: false,
  },
  {
    key: 'dnc',
    name: 'Sandbox DNC Campaign',
    slug: 'sandbox-dnc',
    status: 'active',
    is_active: true,
    description: 'Synthetic active campaign with the DNC consent gate switched on.',
    dncCheckAtSubmit: true,
  },
  {
    key: 'inactive',
    name: 'Sandbox Retired Campaign',
    slug: 'sandbox-retired',
    status: 'paused',
    is_active: false,
    description: 'Synthetic inactive campaign — proves inactive-campaign behaviour.',
    dncCheckAtSubmit: false,
  },
];

/** Lead states acceptance needs: new, held, released, DNC-invalid, delivered. */
const SEED_PROSPECTS = [
  { key: 'new', firstName: 'Ada', lastName: 'Newlead', phone: '+6580000211', leadStatus: 'new', campaign: 'standard', quarantined: false, dncStatus: null },
  { key: 'held', firstName: 'Ben', lastName: 'Heldlead', phone: '+6580000212', leadStatus: 'new', campaign: 'standard', quarantined: true, quarantineReason: 'no_funded_agent', dncStatus: null },
  { key: 'released', firstName: 'Cara', lastName: 'Released', phone: '+6580000213', leadStatus: 'contacted', campaign: 'standard', quarantined: false, dncStatus: 'clear', assign: 'agent' },
  { key: 'invalid', firstName: 'Dan', lastName: 'Outofscope', phone: '+12025550143', leadStatus: 'new', campaign: 'dnc', quarantined: false, dncStatus: 'skipped' },
  { key: 'delivered', firstName: 'Eve', lastName: 'Delivered', phone: '+6580000214', leadStatus: 'qualified', campaign: 'dnc', quarantined: false, dncStatus: 'clear', assign: 'agent', delivered: true },
];

function assertAllowed() {
  if (!isSandbox()) {
    throw new Error('sandbox:seed refuses to run outside DEPLOY_ENV=sandbox — it upserts credentials.');
  }
  if (!flagOn('SANDBOX_SEED_ALLOWED')) {
    throw new Error('sandbox:seed requires the explicit flag SANDBOX_SEED_ALLOWED=true.');
  }
  validateDeployment();
  if (!process.env.SANDBOX_SEED_PASSWORD) {
    throw new Error('SANDBOX_SEED_PASSWORD is required (no default) — supply it from the secret store, never a literal.');
  }
}

async function assertSchemaReady(seq) {
  const [rows] = await seq.query(
    `SELECT to_regclass('public.users')      IS NOT NULL AS users,
            to_regclass('public.campaigns')  IS NOT NULL AS campaigns,
            to_regclass('public.prospects')  IS NOT NULL AS prospects,
            to_regclass('public._sandbox_init') IS NOT NULL AS marker`,
  );
  const state = rows[0] || {};
  if (!state.users || !state.campaigns || !state.prospects) {
    throw new Error('sandbox:seed refuses to run: the schema is missing core tables. Run sandbox:init-db first.');
  }
  if (!state.marker) {
    throw new Error(
      'sandbox:seed refuses to run: this database has no sandbox initialization marker. ' +
      'Only databases created by sandbox:init-db may be seeded.',
    );
  }
}

/** Upsert by primary key so a second run updates in place and mints no duplicates. */
async function upsert(Model, id, values) {
  const existing = await Model.findByPk(id);
  if (existing) {
    await existing.update(values);
    return { row: existing, created: false };
  }
  const row = await Model.create({ id, ...values });
  return { row, created: true };
}

export async function seedSandbox({ log = console } = {}) {
  assertAllowed();
  await sequelize.authenticate();
  await assertSchemaReady(sequelize);

  const password = process.env.SANDBOX_SEED_PASSWORD;
  const summary = { users: { created: 0, updated: 0 }, campaigns: { created: 0, updated: 0 }, prospects: { created: 0, updated: 0 }, packages: { created: 0, updated: 0 } };

  // ── Users ────────────────────────────────────────────────────────────────
  const userIds = {};
  for (const spec of SEED_USERS) {
    const id = stableUuid(`user:${spec.key}`);
    userIds[spec.key] = id;
    const { created } = await upsert(User, id, {
      email: spec.email,
      firstName: spec.firstName,
      lastName: spec.lastName,
      fullName: `${spec.firstName} ${spec.lastName}`,
      role: spec.role,
      redeemOpsRole: spec.redeemOpsRole,
      phone: spec.phone,
      password,
      isActive: true,
      emailVerified: true,
    });
    summary.users[created ? 'created' : 'updated'] += 1;
  }

  // ── Google-bound admins ──────────────────────────────────────────────────
  // Google sign-in cannot CREATE an account in a sandbox (authService's
  // assertGoogleProvisioningAllowed), so the addresses that should be able to
  // use it have to exist first. These carry NO password: they are Google-only,
  // which means the shared seed password can never be used to reach an account
  // that maps to a real person's identity.
  const googleAdmins = String(process.env.SANDBOX_GOOGLE_ADMIN_EMAILS || '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  for (const email of googleAdmins) {
    const id = stableUuid(`user:google:${email}`);
    const existing = await User.findByPk(id);
    const values = {
      email,
      firstName: 'Sandbox',
      lastName: 'Google Admin',
      fullName: 'Sandbox Google Admin',
      role: 'admin',
      isActive: true,
      emailVerified: true,
    };
    if (existing) {
      // Never rewrite the password field here — a re-seed must not turn a
      // Google-only account into a password-reachable one.
      await existing.update(values);
      summary.users.updated += 1;
    } else {
      await User.create({ id, ...values });
      summary.users.created += 1;
    }
    log.log?.(`[sandbox:seed] google-admin ${email}`);
  }

  // ── Campaigns ────────────────────────────────────────────────────────────
  const campaignIds = {};
  for (const spec of SEED_CAMPAIGNS) {
    const id = stableUuid(`campaign:${spec.key}`);
    campaignIds[spec.key] = id;
    const { created } = await upsert(Campaign, id, {
      name: spec.name,
      slug: spec.slug,
      description: spec.description,
      status: spec.status,
      is_active: spec.is_active,
      createdBy: userIds.admin,
      min_age: 21,
      max_age: 70,
      // Brief is REQUIRED at creation in the product; seeded synthetically so the
      // Studio and the form panel have context to work from.
      targetAudience: { objective: 'lead_generation', product: 'insurance', audience: 'sandbox_synthetic', offer: 'none' },
      design_config: { dncCheckAtSubmit: spec.dncCheckAtSubmit, customerHost: 'redeem' },
    });
    summary.campaigns[created ? 'created' : 'updated'] += 1;
  }

  // ── Lead package + credits for one controlled DNC clear-release lifecycle ──
  const packageId = stableUuid('package:sandbox');
  {
    const { created } = await upsert(LeadPackage, packageId, {
      name: 'Sandbox Lead Package',
      description: 'Synthetic credits so the sandbox agent can receive held-lead releases.',
      type: 'basic',
      category: 'sandbox',
      price: 0,
      currency: 'SGD',
      leadCount: 25,
      status: 'active',
      createdBy: userIds.admin,
    });
    summary.packages[created ? 'created' : 'updated'] += 1;
  }
  {
    const { created } = await upsert(LeadPackageAssignment, stableUuid('assignment:agent'), {
      agentId: userIds.agent,
      leadPackageId: packageId,
      status: 'active',
      leadsRemaining: 25,
      leadsTotal: 25,
      purchaseDate: new Date('2026-01-01T00:00:00Z'),
      priceSnapshot: 0,
      source: 'package',
    });
    summary.packages[created ? 'created' : 'updated'] += 1;
  }

  // ── Prospects across every state acceptance exercises ────────────────────
  for (const spec of SEED_PROSPECTS) {
    const id = stableUuid(`prospect:${spec.key}`);
    const { created } = await upsert(Prospect, id, {
      firstName: spec.firstName,
      lastName: spec.lastName,
      email: `sandbox.lead.${spec.key}@sandbox.example.com`,
      phone: spec.phone,
      leadSource: 'website',
      leadStatus: spec.leadStatus,
      campaignId: campaignIds[spec.campaign],
      assignedAgentId: spec.assign ? userIds[spec.assign] : null,
      quarantinedAt: spec.quarantined ? new Date('2026-01-02T00:00:00Z') : null,
      quarantineReason: spec.quarantined ? spec.quarantineReason : null,
      dncStatus: spec.dncStatus,
      sourceMetadata: {
        sandbox: true,
        seedKey: spec.key,
        ...(spec.delivered ? { deliveredToSink: true } : {}),
      },
    });
    summary.prospects[created ? 'created' : 'updated'] += 1;
  }

  log.log?.('[sandbox:seed] complete');
  log.log?.(`[sandbox:seed] users      ${summary.users.created} created / ${summary.users.updated} updated`);
  log.log?.(`[sandbox:seed] campaigns  ${summary.campaigns.created} created / ${summary.campaigns.updated} updated`);
  log.log?.(`[sandbox:seed] packages   ${summary.packages.created} created / ${summary.packages.updated} updated`);
  log.log?.(`[sandbox:seed] prospects  ${summary.prospects.created} created / ${summary.prospects.updated} updated`);
  return summary;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seedSandbox()
    .then(async () => {
      await sequelize.close();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error(`[sandbox:seed] ABORTED: ${err.message}`);
      await sequelize.close().catch(() => {});
      process.exit(1);
    });
}

export default { seedSandbox, stableUuid, SEED_USERS };
