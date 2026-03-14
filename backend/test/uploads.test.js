import './setup.js';
import request from 'supertest';
import { getApp, closeDb, createTestUser } from './helpers.js';

let app, adminUser, adminToken;

beforeAll(async () => {
  app = await getApp();
  const admin = await createTestUser({ role: 'admin' });
  adminUser = admin.user;
  adminToken = admin.token;
}, 15000);

afterAll(async () => {
  await closeDb();
});

// ---------------------------------------------------------------------------
// 1. Single file upload
// ---------------------------------------------------------------------------
describe('POST /api/uploads/single', () => {
  it('returns 401 when no auth token provided', async () => {
    const res = await request(app)
      .post('/api/uploads/single')
      .attach('file', Buffer.from('test-content'), 'test.png');

    expect(res.status).toBe(401);
  });

  it('returns 400 when no file attached', async () => {
    const res = await request(app)
      .post('/api/uploads/single')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(400);
  });

  it('uploads a valid image file successfully', async () => {
    // Create a minimal valid PNG buffer (1x1 pixel)
    const pngHeader = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // 1x1
      0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde
    ]);

    const res = await request(app)
      .post('/api/uploads/single?type=image')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', pngHeader, { filename: 'test-upload.png', contentType: 'image/png' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.file).toBeDefined();
    expect(res.body.data.file.originalName).toBe('test-upload.png');
    expect(res.body.data.file.mimetype).toBe('image/png');
    expect(res.body.data.file.url).toBeDefined();
    expect(res.body.data.file.uploadedBy).toBe(adminUser.id);
  });

  it('rejects disallowed MIME type', async () => {
    const res = await request(app)
      .post('/api/uploads/single?type=image')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', Buffer.from('not-an-exe'), { filename: 'bad.exe', contentType: 'application/x-msdownload' });

    expect(res.status).toBe(400);
  });

  it('rejects wrong category MIME type (PDF in image category)', async () => {
    const res = await request(app)
      .post('/api/uploads/single?type=image')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', Buffer.from('%PDF-1.4 test'), { filename: 'doc.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// 2. Multiple file upload
// ---------------------------------------------------------------------------
describe('POST /api/uploads/multiple', () => {
  it('returns 401 when no auth token provided', async () => {
    const res = await request(app)
      .post('/api/uploads/multiple')
      .attach('files', Buffer.from('test'), 'test.png');

    expect(res.status).toBe(401);
  });

  it('returns 400 when no files attached', async () => {
    const res = await request(app)
      .post('/api/uploads/multiple')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(400);
  });

  it('uploads multiple image files successfully', async () => {
    const pngBuf = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde
    ]);

    const res = await request(app)
      .post('/api/uploads/multiple?type=image')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('files', pngBuf, { filename: 'multi1.png', contentType: 'image/png' })
      .attach('files', pngBuf, { filename: 'multi2.png', contentType: 'image/png' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.files).toBeDefined();
    expect(res.body.data.files.length).toBe(2);
    expect(res.body.message).toContain('2 files uploaded');
  });
});

// ---------------------------------------------------------------------------
// 3. Avatar upload
// ---------------------------------------------------------------------------
describe('POST /api/uploads/avatar', () => {
  it('returns 401 when no auth token provided', async () => {
    const res = await request(app)
      .post('/api/uploads/avatar')
      .attach('avatar', Buffer.from('test'), 'avatar.png');

    expect(res.status).toBe(401);
  });

  it('returns 400 when no avatar file attached', async () => {
    const res = await request(app)
      .post('/api/uploads/avatar')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(400);
  });

  it('uploads avatar successfully and updates user record', async () => {
    const pngBuf = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde
    ]);

    const res = await request(app)
      .post('/api/uploads/avatar?type=image')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('avatar', pngBuf, { filename: 'my-avatar.png', contentType: 'image/png' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.avatar).toBeDefined();
    expect(res.body.data.avatar.url).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 4. Delete file
// ---------------------------------------------------------------------------
describe('DELETE /api/uploads/:type/:filename', () => {
  let uploadedFilename;

  beforeAll(async () => {
    // Upload a file first so we can delete it
    const pngBuf = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde
    ]);

    const res = await request(app)
      .post('/api/uploads/single?type=image')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', pngBuf, { filename: 'delete-me.png', contentType: 'image/png' });

    uploadedFilename = res.body.data.file.filename;
  });

  it('returns 401 when no auth token provided', async () => {
    const res = await request(app)
      .delete(`/api/uploads/image/${uploadedFilename}`);

    expect(res.status).toBe(401);
  });

  it('deletes an uploaded file successfully', async () => {
    const res = await request(app)
      .delete(`/api/uploads/image/${uploadedFilename}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toContain('deleted');
  });

  it('returns 404 when file does not exist', async () => {
    const res = await request(app)
      .delete('/api/uploads/image/nonexistent-file.png')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// 5. File info
// ---------------------------------------------------------------------------
describe('GET /api/uploads/info/:type/:filename', () => {
  let uploadedFilename;

  beforeAll(async () => {
    const pngBuf = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde
    ]);

    const res = await request(app)
      .post('/api/uploads/single?type=image')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', pngBuf, { filename: 'info-test.png', contentType: 'image/png' });

    uploadedFilename = res.body.data.file.filename;
  });

  it('returns 401 when no auth token provided', async () => {
    const res = await request(app)
      .get(`/api/uploads/info/image/${uploadedFilename}`);

    expect(res.status).toBe(401);
  });

  it('returns file info for an existing file', async () => {
    const res = await request(app)
      .get(`/api/uploads/info/image/${uploadedFilename}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.file).toBeDefined();
    expect(res.body.data.file.filename).toBe(uploadedFilename);
    expect(res.body.data.file.type).toBe('image');
    expect(typeof res.body.data.file.size).toBe('number');
  });

  it('returns 404 for non-existent file', async () => {
    const res = await request(app)
      .get('/api/uploads/info/image/nonexistent.png')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// 6. List files
// ---------------------------------------------------------------------------
describe('GET /api/uploads/list/:type', () => {
  it('returns 401 when no auth token provided', async () => {
    const res = await request(app)
      .get('/api/uploads/list/image');

    expect(res.status).toBe(401);
  });

  it('lists files in a directory with pagination', async () => {
    const res = await request(app)
      .get('/api/uploads/list/image?page=1&limit=10')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.files).toBeDefined();
    expect(Array.isArray(res.body.data.files)).toBe(true);
    expect(res.body.data.pagination).toBeDefined();
    expect(res.body.data.pagination.currentPage).toBe(1);
  });

  it('returns empty list for non-existent directory', async () => {
    const res = await request(app)
      .get('/api/uploads/list/nonexistent_type')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.files).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 7. Storage usage stats
// ---------------------------------------------------------------------------
describe('GET /api/uploads/stats/usage', () => {
  it('returns 401 when no auth token provided', async () => {
    const res = await request(app)
      .get('/api/uploads/stats/usage');

    expect(res.status).toBe(401);
  });

  it('returns storage usage statistics', async () => {
    const res = await request(app)
      .get('/api/uploads/stats/usage')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.totalUsage).toBeDefined();
    expect(typeof res.body.data.totalUsage.bytes).toBe('number');
    expect(res.body.data.totalUsage.formatted).toBeDefined();
    expect(res.body.data.byType).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 8. Campaign assets upload
// ---------------------------------------------------------------------------
describe('POST /api/uploads/campaign-assets', () => {
  it('returns 400 when no campaignId provided', async () => {
    const pngBuf = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde
    ]);

    const res = await request(app)
      .post('/api/uploads/campaign-assets?type=campaign_media')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('assets', pngBuf, { filename: 'asset.png', contentType: 'image/png' });

    expect(res.status).toBe(400);
  });

  it('returns 400 when no files attached', async () => {
    const res = await request(app)
      .post('/api/uploads/campaign-assets?type=campaign_media')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('campaignId', 'some-campaign-id');

    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// 9. Documents upload
// ---------------------------------------------------------------------------
describe('POST /api/uploads/documents', () => {
  it('returns 400 when entityType or entityId is missing', async () => {
    const pdfBuf = Buffer.from('%PDF-1.4 test document');

    const res = await request(app)
      .post('/api/uploads/documents?type=document')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('documents', pdfBuf, { filename: 'doc.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(400);
  });

  it('returns 401 when no auth token provided', async () => {
    const res = await request(app)
      .post('/api/uploads/documents')
      .attach('documents', Buffer.from('test'), { filename: 'doc.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// 10. Path traversal security check
// ---------------------------------------------------------------------------
describe('Upload security checks', () => {
  it('DELETE rejects path traversal attempt', async () => {
    const res = await request(app)
      .delete('/api/uploads/../../etc/passwd')
      .set('Authorization', `Bearer ${adminToken}`);

    // Should not be 200 (either 400 for security check or 404 for not found)
    expect([400, 404]).toContain(res.status);
  });

  it('GET info rejects path traversal attempt', async () => {
    const res = await request(app)
      .get('/api/uploads/info/../../etc/passwd')
      .set('Authorization', `Bearer ${adminToken}`);

    expect([400, 404]).toContain(res.status);
  });
});
