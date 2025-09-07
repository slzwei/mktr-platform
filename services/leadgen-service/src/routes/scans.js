import { Router } from 'express';
import { withClient } from '../db/index.js';
import { respond } from '../middleware/observability.js';

const router = Router();

// naive in-memory rate limit per IP for scans
const scanCounts = new Map();
const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 60;
setInterval(() => scanCounts.clear(), WINDOW_MS).unref();

router.post('/', async (req, res) => {
  const tenantId = req.tenantId;
  const { qr_tag_id, ip = req.ip, ua = req.headers['user-agent'] || '', geo = null } = req.body || {};
  if (!qr_tag_id) return respond(res, 400, { error: 'qr_tag_id required' });

  const key = `${tenantId}:${req.ip}`;
  const cnt = (scanCounts.get(key) || 0) + 1;
  scanCounts.set(key, cnt);
  if (cnt > MAX_PER_WINDOW) {
    res.setHeader('Retry-After', '60');
    return respond(res, 429, { error: 'rate_limit' });
  }

  try {
    const row = await withClient(async (client) => {
      const { rows } = await client.query(
        'INSERT INTO leadgen.qr_scans (id, tenant_id, qr_tag_id, ts, ip, ua, geo_json) VALUES (gen_random_uuid(), $1, $2, NOW(), $3::inet, $4, $5::jsonb) RETURNING *',
        [tenantId, qr_tag_id, ip || null, ua, geo ? JSON.stringify(geo) : null]
      );
      return rows[0];
    });

    // Attribution: resolve car_id from qr_tags, then resolve current driver via monolith cars assignment fields at scan timestamp
    try {
      const attribution = await withClient(async (client) => {
        const { rows: tagRows } = await client.query('SELECT car_id FROM leadgen.qr_tags WHERE id=$1 AND tenant_id=$2', [qr_tag_id, tenantId]);
        const carId = tagRows[0]?.car_id || null;
        if (!carId) return { car_id: null, driver_id: null };
        // Query monolith public.cars for current driver fields around ts; fallback to current_driver_id when start/end not suitable
        const { rows: carRows } = await client.query('SELECT current_driver_id, assignment_start, assignment_end FROM public.cars WHERE id=$1', [carId]);
        const car = carRows[0];
        if (!car) return { car_id: carId, driver_id: null };
        const ts = new Date(row.ts);
        const startOk = car.assignment_start ? new Date(car.assignment_start) <= ts : true;
        const endOk = car.assignment_end ? new Date(car.assignment_end) >= ts : true;
        const driverId = (startOk && endOk) ? car.current_driver_id : car.current_driver_id; // best available
        return { car_id: carId, driver_id: driverId };
      });
      if (attribution.car_id) res.locals.car_id = attribution.car_id;
      if (attribution.driver_id) res.locals.driver_id = attribution.driver_id;
    } catch {}

    return respond(res, 201, { data: row });
  } catch (e) {
    return respond(res, 500, { error: 'server_error' });
  }
});

export default router;


