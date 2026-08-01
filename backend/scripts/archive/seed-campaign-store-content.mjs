/**
 * One-off prod content seeder for the campaign-first Lead Store (migration 044).
 * UNTRACKED local ops script — content authoring UI on the web platform is still
 * out of scope, so gift/notes/description are seeded via SQL for on-device verify.
 *
 * Usage (password fresh from Render → mktr-backend env DB_PASSWORD; never stored):
 *   DB_PASSWORD=... node scripts/seed-campaign-store-content.mjs --check
 *       → did migration 044 land? (columns + _migrations ledger row) = deploy proof
 *   DB_PASSWORD=... node scripts/seed-campaign-store-content.mjs --list
 *       → campaigns with their buyable-package counts + current gift/notes state
 *   DB_PASSWORD=... node scripts/seed-campaign-store-content.mjs --apply <campaignId>
 *       → seeds the CareShield luggage content onto that campaign (design copy).
 *         gift_price_from_mktr and gift_note are LEFT NULL — set the real price
 *         with --gift-price <number> when known (S$; the app hides the price
 *         line while NULL, which is a designed state).
 *
 * Connects to the EXTERNAL Render Postgres host (the web service's DB_HOST is
 * internal-only). Defaults below match the "mktr-db" service; override via env.
 */
import pg from 'pg';

const HOST = process.env.DB_HOST || 'dpg-d2s2h7nfte5s739gnl7g-a.singapore-postgres.render.com';
const DATABASE = process.env.DB_NAME || 'mktr_db';
const USER = process.env.DB_USER || 'mktr_db_user';
const PASSWORD = process.env.DB_PASSWORD;

const SEED = {
  description:
    'Prospects opted in through our comparison funnel after checking their CPF disability coverage — every signup was promised a free 20″ cabin luggage for attending a review. Most are aged 30–55, employed, and pre-qualified on intent to meet. Expect warm conversations: they asked for this review, you’re not cold calling.',
  giftName: '20″ cabin luggage',
  agentNotes: [
    'Mention the luggage when you confirm the appointment — it’s why they signed up.',
    'Arrange gift collection with MKTR at least 2 days before the appointment.',
    'Bring your rep card and FNA forms — CareShield reviews count as regulated advice.',
  ],
};

const COLUMNS = ['gift_name', 'gift_price_from_mktr', 'gift_note', 'agent_notes'];

function die(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

if (!PASSWORD) die('DB_PASSWORD env var is required (grab it fresh from Render → mktr-backend env).');

const mode = process.argv.includes('--check')
  ? 'check'
  : process.argv.includes('--list')
    ? 'list'
    : process.argv.includes('--apply')
      ? 'apply'
      : null;
if (!mode) die('Pass --check, --list, or --apply <campaignId>.');

const client = new pg.Client({
  host: HOST,
  port: 5432,
  database: DATABASE,
  user: USER,
  password: PASSWORD,
  ssl: { rejectUnauthorized: false },
});

async function checkMigration() {
  const cols = await client.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'campaigns' AND column_name = ANY($1)`,
    [COLUMNS],
  );
  const pkgCol = await client.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'lead_packages' AND column_name = 'is_recommended'`,
  );
  const ledger = await client.query(`SELECT name, "appliedAt" FROM "_migrations" WHERE name LIKE '044%'`);
  const found = cols.rows.map((r) => r.column_name).sort();
  const ok = found.length === COLUMNS.length && pkgCol.rows.length === 1;
  console.log(`campaigns gift/notes columns: ${found.length}/${COLUMNS.length} present (${found.join(', ') || 'none'})`);
  console.log(`lead_packages.is_recommended: ${pkgCol.rows.length === 1 ? 'present' : 'MISSING'}`);
  console.log(
    ledger.rows.length
      ? `_migrations ledger: ${ledger.rows[0].name} applied ${ledger.rows[0].appliedAt?.toISOString?.() ?? ledger.rows[0].appliedAt}`
      : '_migrations ledger: 044 NOT recorded',
  );
  console.log(ok ? '\n✓ migration 044 has landed — safe to --apply' : '\n✗ 044 not applied yet — deploy first');
  return ok;
}

async function listCampaigns() {
  const { rows } = await client.query(`
    SELECT c.id, c.name, c.status, c.gift_name, c.agent_notes,
           left(coalesce(c.description, ''), 60) AS description_head,
           count(lp.id) FILTER (
             WHERE lp.status = 'active' AND lp."isPublic" = true
               AND lp.price > 0 AND coalesce(lp.currency, 'SGD') = 'SGD'
           ) AS buyable_packages
    FROM campaigns c
    LEFT JOIN lead_packages lp ON lp."campaignId" = c.id
    GROUP BY c.id
    ORDER BY max(lp."createdAt") DESC NULLS LAST
  `);
  for (const r of rows) {
    console.log(
      `${r.id}  [${r.status}]  buyable:${r.buyable_packages}  gift:${r.gift_name ?? '—'}  notes:${Array.isArray(r.agent_notes) ? r.agent_notes.length : 0}\n    ${r.name} — ${r.description_head || '(no description)'}`,
    );
  }
}

async function apply() {
  const idx = process.argv.indexOf('--apply');
  const campaignId = process.argv[idx + 1];
  if (!campaignId || campaignId.startsWith('--')) die('--apply needs a campaignId (find it with --list).');
  const priceIdx = process.argv.indexOf('--gift-price');
  const giftPrice = priceIdx > -1 ? Number(process.argv[priceIdx + 1]) : null;
  if (priceIdx > -1 && (!Number.isFinite(giftPrice) || giftPrice <= 0)) die('--gift-price must be a positive number.');

  const before = await client.query(
    `SELECT id, name, gift_name, gift_price_from_mktr, agent_notes, left(coalesce(description,''),60) AS d FROM campaigns WHERE id = $1`,
    [campaignId],
  );
  if (!before.rows.length) die(`No campaign ${campaignId}`);
  console.log('BEFORE:', JSON.stringify(before.rows[0], null, 2));

  const { rows } = await client.query(
    `UPDATE campaigns
        SET description = $2,
            gift_name = $3,
            gift_price_from_mktr = $4,
            agent_notes = $5::jsonb,
            "updatedAt" = now()
      WHERE id = $1
      RETURNING id, name, gift_name, gift_price_from_mktr, agent_notes`,
    [campaignId, SEED.description, SEED.giftName, giftPrice, JSON.stringify(SEED.agentNotes)],
  );
  console.log('AFTER:', JSON.stringify(rows[0], null, 2));
  console.log('\n✓ seeded. gift_note left NULL; gift price ' + (giftPrice ? `set to S$${giftPrice}` : 'left NULL (price line hidden in-app)'));
}

try {
  await client.connect();
  if (mode === 'check') await checkMigration();
  if (mode === 'list') {
    if (await checkMigration()) {
      console.log('');
      await listCampaigns();
    }
  }
  if (mode === 'apply') {
    if (!(await checkMigration())) die('refusing to seed before migration 044 is live.');
    console.log('');
    await apply();
  }
} finally {
  await client.end();
}
