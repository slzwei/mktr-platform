import { getApp, closeDb, createTestUser, createTestCampaign } from './helpers.js';
import { sequelize, Campaign } from '../src/models/index.js';
import { up } from '../src/database/migrations/087-campaign-category-backfill.js';

/**
 * 087 backfill semantics on real Postgres: v2 docs get the nested
 * distribution.marketplace.category (parents created when absent), v1/flat
 * docs get the root key, existing categories are NEVER overwritten, and the
 * whole thing is idempotent. Rows are keyed by the REAL production UUIDs the
 * migration targets — anything else must be untouched.
 */

const PET_HOTEL = '35b723aa-27be-44af-b9ba-d9f53ef48e01'; // → family_lifestyle
const RETELL_CS = '88cde84b-4805-40fa-8866-c0eb806a5dee'; // → financial_education
const FP_10 = '2821c916-9d6c-4b76-b103-805f45195b21'; // → family_lifestyle

let admin;

beforeAll(async () => {
  await getApp();
  admin = await createTestUser({ role: 'admin' });
});

afterAll(async () => {
  await closeDb();
});

const reload = async (id) => (await Campaign.findByPk(id)).design_config;

test('backfills version-aware, respects existing values, and is idempotent', async () => {
  // v2 doc WITHOUT a marketplace object — parents must be created.
  await createTestCampaign(admin.user.id, {
    id: PET_HOTEL,
    name: 'Backfill Pet Hotel',
    design_config: { version: 2, distribution: { host: 'redeem' } },
  });
  // v2 doc with an OPERATOR-SET category — the guard must keep it.
  await createTestCampaign(admin.user.id, {
    id: RETELL_CS,
    name: 'Backfill Retell',
    design_config: { version: 2, distribution: { marketplace: { category: 'dining' } } },
  });
  // Flat/v1-shaped doc — the ELSE branch writes the root key.
  await createTestCampaign(admin.user.id, {
    id: FP_10,
    name: 'Backfill FP10',
    design_config: {},
  });

  await up(sequelize.getQueryInterface());

  const petHotel = await reload(PET_HOTEL);
  expect(petHotel.distribution.marketplace.category).toBe('family_lifestyle');
  expect(petHotel.distribution.host).toBe('redeem'); // siblings preserved

  const retell = await reload(RETELL_CS);
  expect(retell.distribution.marketplace.category).toBe('dining'); // NOT overwritten

  const fp10 = await reload(FP_10);
  expect(fp10.category).toBe('family_lifestyle'); // v1 root key

  // Idempotent rerun changes nothing.
  await up(sequelize.getQueryInterface());
  expect((await reload(PET_HOTEL)).distribution.marketplace.category).toBe('family_lifestyle');
  expect((await reload(RETELL_CS)).distribution.marketplace.category).toBe('dining');
});
