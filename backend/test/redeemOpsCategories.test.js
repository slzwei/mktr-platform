/**
 * Redeem Ops admin-managed category taxonomy (migration 052).
 * Covers: capability gating (settings.manage), create validation (ci-dup,
 * reserved name), write-path enforcement (unknown → 422, canonicalized casing),
 * rename cascade onto consuming rows, rename-collision → 409, currentValue
 * pass-through (a retired category must not brick unrelated partner edits),
 * merge (cascade + source deletion), and the delete reference guard.
 */
process.env.REDEEM_OPS_ENABLED = 'true'; // must be set before getApp() mounts routes

import request from 'supertest';
import { getApp, closeDb, createTestUser } from './helpers.js';
import { RedeemOpsCategory, PartnerOrganisation } from '../src/models/index.js';
import { makeCategoryService } from '../src/services/redeemOps/categoryService.js';

let app;
let admin, bdm, exec;

beforeAll(async () => {
  app = await getApp();
  admin = await createTestUser({ role: 'admin' }); // implicit super_admin
  bdm = await createTestUser({ role: 'redeem_ops', redeemOpsRole: 'bdm' });
  exec = await createTestUser({ role: 'redeem_ops', redeemOpsRole: 'outreach_exec' });
});

afterAll(async () => {
  await closeDb();
});

const auth = (t) => ({ Authorization: `Bearer ${t}` });
let nameSeq = 0;
const uniq = (base) => `${base} ${Date.now()}-${++nameSeq}`;

const createCategory = (token, name, searchTerms = undefined) =>
  request(app).post('/api/redeem-ops/categories').set(auth(token)).send({
    name,
    ...(searchTerms === undefined ? {} : { searchTerms }),
  });
const createPartner = (token, body) =>
  request(app).post('/api/redeem-ops/partners').set(auth(token)).send(body);
const updatePartner = (token, id, body) =>
  request(app).put(`/api/redeem-ops/partners/${id}`).set(auth(token)).send(body);

describe('read access', () => {
  test('any Redeem Ops principal can list categories (feeds pickers)', async () => {
    const res = await request(app).get('/api/redeem-ops/categories').set(auth(exec.token));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.categories)).toBe(true);
  });
});

describe('create + capability gate', () => {
  test('bdm lacks settings.manage → 403; admin creates → 201', async () => {
    const name = uniq('Pet Grooming');
    expect((await createCategory(bdm.token, name)).status).toBe(403);

    const ok = await createCategory(admin.token, name);
    expect(ok.status).toBe(201);
    expect(ok.body.data.category.name).toBe(name);
    expect(ok.body.data.category.providerSearchTerms).toEqual([name]);
  });

  test('provider search terms are trimmed and deduped case-insensitively', async () => {
    const name = uniq('Local Coffeeshop');
    const ok = await createCategory(admin.token, name, [
      ' kopitiam ', 'KOPITIAM', 'zi char', 'coffeeshop',
    ]);
    expect(ok.status).toBe(201);
    expect(ok.body.data.category.providerSearchTerms).toEqual([
      'kopitiam', 'zi char', 'coffeeshop',
    ]);
  });

  test('case-insensitive duplicate → 409', async () => {
    const name = uniq('Yoga Studio');
    expect((await createCategory(admin.token, name)).status).toBe(201);
    const dup = await createCategory(admin.token, name.toUpperCase());
    expect(dup.status).toBe(409);
  });

  test("reserved 'Uncategorised' → 400 (collides with the analytics null bucket)", async () => {
    expect((await createCategory(admin.token, 'Uncategorised')).status).toBe(400);
    expect((await createCategory(admin.token, 'uncategorized')).status).toBe(400);
  });
});

describe('write-path enforcement', () => {
  test('partner create with an unknown category → 422', async () => {
    const res = await createPartner(exec.token, {
      tradingName: uniq('Ghost Spa'),
      category: 'Definitely Not A Real Category',
    });
    expect(res.status).toBe(422);
  });

  test('known category is accepted and canonicalized to stored casing', async () => {
    const canonical = uniq('Barbershop');
    expect((await createCategory(admin.token, canonical)).status).toBe(201);

    const res = await createPartner(exec.token, {
      tradingName: uniq('Fades Co'),
      category: canonical.toLowerCase(), // different casing on the way in
    });
    expect(res.status).toBe(201);
    expect(res.body.data.partner.category).toBe(canonical); // stored casing wins
  });

  test('blank category is allowed (stays null)', async () => {
    const res = await createPartner(exec.token, { tradingName: uniq('No Cat Co'), category: '' });
    expect(res.status).toBe(201);
    expect(res.body.data.partner.category).toBeNull();
  });
});

describe('rename cascade', () => {
  test('renaming a category rewrites every consuming partner row', async () => {
    const from = uniq('Naadi');
    const created = await createCategory(admin.token, from);
    const categoryId = created.body.data.category.id;

    const partnerRes = await createPartner(exec.token, { tradingName: uniq('Naadi Bliss'), category: from });
    const partnerId = partnerRes.body.data.partner.id;

    const to = uniq('Nail Salon');
    const rename = await request(app)
      .patch(`/api/redeem-ops/categories/${categoryId}`)
      .set(auth(admin.token))
      .send({ name: to });
    expect(rename.status).toBe(200);

    const partner = await PartnerOrganisation.findByPk(partnerId);
    expect(partner.category).toBe(to);
  });

  test('renaming onto an existing name → 409 (must merge instead)', async () => {
    const a = uniq('Massage');
    const b = uniq('Spa');
    const createdA = await createCategory(admin.token, a);
    await createCategory(admin.token, b);

    const res = await request(app)
      .patch(`/api/redeem-ops/categories/${createdA.body.data.category.id}`)
      .set(auth(admin.token))
      .send({ name: b });
    expect(res.status).toBe(409);
  });

  test('search-term edits persist and a later rename leaves them intact', async () => {
    const from = uniq('Local Cafe');
    const created = await createCategory(admin.token, from);
    const categoryId = created.body.data.category.id;
    const partnerRes = await createPartner(exec.token, {
      tradingName: uniq('Kopi House'), category: from,
    });

    const termsUpdate = await request(app)
      .patch(`/api/redeem-ops/categories/${categoryId}`)
      .set(auth(admin.token))
      .send({ searchTerms: [' kopitiam ', 'KOPITIAM', 'zi char'] });
    expect(termsUpdate.status).toBe(200);
    expect(termsUpdate.body.data.category.providerSearchTerms).toEqual(['kopitiam', 'zi char']);

    const to = uniq('Neighbourhood Coffeeshop');
    const rename = await request(app)
      .patch(`/api/redeem-ops/categories/${categoryId}`)
      .set(auth(admin.token))
      .send({ name: to });
    expect(rename.status).toBe(200);
    expect(rename.body.data.category.providerSearchTerms).toEqual(['kopitiam', 'zi char']);

    const partner = await PartnerOrganisation.findByPk(partnerRes.body.data.partner.id);
    expect(partner.category).toBe(to);

    const reset = await request(app)
      .patch(`/api/redeem-ops/categories/${categoryId}`)
      .set(auth(admin.token))
      .send({ searchTerms: [] });
    expect(reset.status).toBe(200);
    expect(reset.body.data.category.providerSearchTerms).toEqual([to]);
  });
});

describe('currentValue pass-through', () => {
  test('a retired category does not block an unrelated edit on a partner that still has it', async () => {
    const name = uniq('Florist');
    const created = await createCategory(admin.token, name);
    const categoryId = created.body.data.category.id;

    const partnerRes = await createPartner(exec.token, { tradingName: uniq('Petal Co'), category: name });
    const partnerId = partnerRes.body.data.partner.id;

    // Retire the category — it leaves the active list / pickers.
    const retire = await request(app)
      .patch(`/api/redeem-ops/categories/${categoryId}`)
      .set(auth(admin.token))
      .send({ isActive: false });
    expect(retire.status).toBe(200);

    // Editing an unrelated field must still succeed: the SPA sends category on
    // every save, and its unchanged (now-retired) value passes through. (admin
    // edits any row — this isolates category validation from ownership scoping.)
    const edit = await updatePartner(admin.token, partnerId, {
      tradingName: 'Petal Co Renamed',
      category: name,
      notes: 'touched an unrelated field',
    });
    expect(edit.status).toBe(200);

    const partner = await PartnerOrganisation.findByPk(partnerId);
    expect(partner.category).toBe(name); // retained, not nulled or rejected
  });
});

describe('merge', () => {
  test('merge moves consuming rows to the target and deletes the source', async () => {
    const source = uniq('Nails');
    const target = uniq('Nail Bar');
    const createdSource = await createCategory(admin.token, source, ['common alias', 'manicure']);
    const createdTarget = await createCategory(admin.token, target, ['Common Alias', 'nail studio']);

    const partnerRes = await createPartner(exec.token, { tradingName: uniq('Tips Co'), category: source });
    const partnerId = partnerRes.body.data.partner.id;

    const res = await request(app)
      .post(`/api/redeem-ops/categories/${createdSource.body.data.category.id}/merge`)
      .set(auth(admin.token))
      .send({ targetId: createdTarget.body.data.category.id });
    expect(res.status).toBe(200);
    expect(res.body.data.rowsMoved).toBeGreaterThanOrEqual(1);

    const partner = await PartnerOrganisation.findByPk(partnerId);
    expect(partner.category).toBe(target);
    expect(await RedeemOpsCategory.findByPk(createdSource.body.data.category.id)).toBeNull();
    const mergedTarget = await RedeemOpsCategory.findByPk(createdTarget.body.data.category.id);
    expect(mergedTarget.providerSearchTerms).toEqual([
      'Common Alias', 'nail studio', 'manicure', source,
    ]);
  });

  test('merging a category into itself → 400', async () => {
    const created = await createCategory(admin.token, uniq('Cafe'));
    const id = created.body.data.category.id;
    const res = await request(app)
      .post(`/api/redeem-ops/categories/${id}/merge`)
      .set(auth(admin.token))
      .send({ targetId: id });
    expect(res.status).toBe(400);
  });
});

describe('resolveCategoryForSearch', () => {
  const categoryService = makeCategoryService();

  test('known category returns canonical name and provider terms', async () => {
    const name = uniq('Searchable Cafe');
    await createCategory(admin.token, name, ['kopitiam', 'zi char']);
    await expect(categoryService.resolveCategoryForSearch(name.toLowerCase())).resolves.toEqual({
      name,
      searchTerms: ['kopitiam', 'zi char'],
    });
  });

  test('unknown category returns the same 422 used by category writes', async () => {
    await expect(categoryService.resolveCategoryForSearch(uniq('Unknown Search Category')))
      .rejects.toMatchObject({ statusCode: 422 });
  });

  test('legacy null terms fall back to the canonical name', async () => {
    const name = uniq('Legacy Search Category');
    await RedeemOpsCategory.create({ name, providerSearchTerms: null });
    await expect(categoryService.resolveCategoryForSearch(name)).resolves.toEqual({
      name,
      searchTerms: [name],
    });
  });
});

describe('delete reference guard', () => {
  test('unreferenced category deletes; referenced one → 409', async () => {
    const unused = await createCategory(admin.token, uniq('Unused'));
    expect((await request(app)
      .delete(`/api/redeem-ops/categories/${unused.body.data.category.id}`)
      .set(auth(admin.token))).status).toBe(200);

    const used = await createCategory(admin.token, uniq('Used'));
    await createPartner(exec.token, { tradingName: uniq('User Co'), category: used.body.data.category.name });
    const res = await request(app)
      .delete(`/api/redeem-ops/categories/${used.body.data.category.id}`)
      .set(auth(admin.token));
    expect(res.status).toBe(409);
  });
});
