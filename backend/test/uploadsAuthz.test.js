/**
 * P1-5 regression: the file-administration half of /api/uploads.
 *
 * DELETE /:type/:filename, GET /info, GET /list and GET /stats carried
 * authenticateToken and no role gate, and uploadService has no ownership
 * concept — so any authenticated principal, including a self-registered
 * customer, could enumerate every uploaded file and unlink any of them
 * (campaign heroes, avatars, verification documents).
 *
 * Two more holes closed here: /api/uploads was missing from the internal-route
 * host guard (reachable from the public redeem.sg origin), and the traversal
 * check was prefix-only, so a SIBLING directory sharing the prefix
 * (uploads-x vs uploads) passed it.
 */
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { getApp, closeDb, createTestUser } from './helpers.js';
import { deleteFile, getFileInfo, listFiles } from '../src/services/uploadService.js';

let app, admin, agent, customer, filename;

const uploadsDir = path.join(process.cwd(), 'uploads');
const probes = [];

beforeAll(async () => {
  app = await getApp();
  admin = await createTestUser({ role: 'admin' });
  agent = await createTestUser({ role: 'agent' });
  customer = await createTestUser({ role: 'customer' });

  const dir = path.join(uploadsDir, 'images');
  fs.mkdirSync(dir, { recursive: true });
  filename = `p1-5-probe-${uuidv4()}.png`;
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  probes.push(filePath);
});

afterAll(async () => {
  for (const p of probes) {
    try { fs.unlinkSync(p); } catch { /* already gone */ }
  }
  await closeDb();
});

const auth = (token) => ({ Authorization: `Bearer ${token}` });

describe('file-administration routes are admin-only', () => {
  it('a customer cannot list uploaded files', async () => {
    const res = await request(app).get('/api/uploads/list/images').set(auth(customer.token));
    expect(res.status).toBe(403);
  });

  it('an agent cannot list uploaded files', async () => {
    const res = await request(app).get('/api/uploads/list/images').set(auth(agent.token));
    expect(res.status).toBe(403);
  });

  it('a customer cannot read file info', async () => {
    const res = await request(app).get(`/api/uploads/info/images/${filename}`).set(auth(customer.token));
    expect(res.status).toBe(403);
  });

  it('a customer cannot read storage stats', async () => {
    const res = await request(app).get('/api/uploads/stats/usage').set(auth(customer.token));
    expect(res.status).toBe(403);
  });

  it('a customer cannot delete someone else’s file — and the file survives', async () => {
    const res = await request(app).delete(`/api/uploads/images/${filename}`).set(auth(customer.token));
    expect(res.status).toBe(403);
    expect(fs.existsSync(path.join(uploadsDir, 'images', filename))).toBe(true);
  });

  it('an admin still gets the full surface', async () => {
    const list = await request(app).get('/api/uploads/list/images').set(auth(admin.token));
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body.data.files)).toBe(true);

    const info = await request(app).get(`/api/uploads/info/images/${filename}`).set(auth(admin.token));
    expect(info.status).toBe(200);
    expect(info.body.data.file.filename).toBe(filename);

    const stats = await request(app).get('/api/uploads/stats/usage').set(auth(admin.token));
    expect(stats.status).toBe(200);

    const del = await request(app).delete(`/api/uploads/images/${filename}`).set(auth(admin.token));
    expect(del.status).toBe(200);
    expect(fs.existsSync(path.join(uploadsDir, 'images', filename))).toBe(false);
  });
});

describe('the internal-route host guard covers /api/uploads', () => {
  it('rejects an uploads call arriving from the redeem.sg origin', async () => {
    const res = await request(app)
      .get('/api/uploads/stats/usage')
      .set(auth(admin.token))
      .set('Origin', 'https://redeem.sg')
      .set('X-Forwarded-Host', 'redeem.sg');

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/only available on mktr\.sg/i);
  });
});

describe('traversal guard rejects sibling-directory escapes', () => {
  // path.resolve('/app/uploads-x').startsWith('/app/uploads') is TRUE — the old
  // prefix check let every one of these through to the filesystem.
  it.each(['../uploads-x', '../../etc', '..'])('rejects type=%s', async (type) => {
    await expect(getFileInfo(type, 'passwd')).rejects.toMatchObject({ statusCode: 400 });
    await expect(deleteFile(type, 'passwd')).rejects.toMatchObject({ statusCode: 400 });
    await expect(listFiles(type)).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects a filename that climbs out', async () => {
    await expect(getFileInfo('images', '../../package.json')).rejects.toMatchObject({ statusCode: 400 });
  });

  it('still allows a legitimate path inside uploads/', async () => {
    await expect(listFiles('images')).resolves.toHaveProperty('files');
  });
});
