import { Router } from 'express';
import { withClient } from '../db/index.js';

const router = Router();

// naive in-memory rate limit per IP for scans
const scanCounts = new Map();
const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 60;
setInterval(() => scanCounts.clear(), WINDOW_MS).unref();

router.post('/', async (req, res) => {
  const tenantId = req.tenantId;
  const { qr_tag_id, ip = req.ip, ua = req.headers['user-agent'] || '', geo = null } = req.body || {};
  if (!qr_tag_id) return res.status(400).json({ success: false, message: 'qr_tag_id required' });

  const key = `${tenantId}:${req.ip}`;
  const cnt = (scanCounts.get(key) || 0) + 1;
  scanCounts.set(key, cnt);
  if (cnt > MAX_PER_WINDOW) {
    return res.status(429).json({ success: false, message: 'Rate limit exceeded' });
  }

  try {
    const row = await withClient(async (client) => {
      const { rows } = await client.query(
        'INSERT INTO leadgen.qr_scans (id, tenant_id, qr_tag_id, ts, ip, ua, geo_json) VALUES (gen_random_uuid(), $1, $2, NOW(), $3::inet, $4, $5::jsonb) RETURNING *',
        [tenantId, qr_tag_id, ip || null, ua, geo ? JSON.stringify(geo) : null]
      );
      return rows[0];
    });
    res.status(201).json({ success: true, data: row });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

export default router;


