import { Router } from 'express';
import { withClient } from '../db/index.js';
import { validateCreateQr, validateListQr } from '../middleware/validation.js';
import { limitCreate, limitList } from '../middleware/rateLimit.js';
import { respond } from '../middleware/observability.js';
import { checkIdempotency, persistIdempotency } from '../lib/idempotency.js';

const router = Router();

router.post('/', limitCreate, validateCreateQr, async (req, res) => {
  const tenantId = req.tenantId;
  const idempotencyKey = req.headers['idempotency-key'] || req.headers['x-idempotency-key'] || null;
  const payload = req.body || {};
  const { code, status = 'active', campaign_id = null, car_id = null, owner_user_id = null } = payload;

  try {
    const verdict = await checkIdempotency(tenantId, idempotencyKey, payload);
    if (verdict.action === 'replay') {
      return respond(res, 200, { data: verdict.response });
    }
    if (verdict.action === 'conflict') {
      return respond(res, 409, { error: 'idempotency_conflict' });
    }

    const row = await withClient(async (client) => {
      const { rows } = await client.query(
        'INSERT INTO leadgen.qr_tags (id, tenant_id, campaign_id, car_id, owner_user_id, code, status) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6) RETURNING *',
        [tenantId, campaign_id, car_id, owner_user_id, code, status]
      );
      return rows[0];
    });

    await persistIdempotency(tenantId, idempotencyKey, payload, row);
    return respond(res, 201, { data: row });
  } catch (e) {
    return respond(res, 500, { error: 'server_error' });
  }
});

router.get('/:id', async (req, res) => {
  const tenantId = req.tenantId;
  const id = req.params.id;
  try {
    const row = await withClient(async (client) => {
      const { rows } = await client.query('SELECT * FROM leadgen.qr_tags WHERE id=$1 AND tenant_id=$2', [id, tenantId]);
      return rows[0];
    });
    if (!row) return respond(res, 404, { error: 'not_found' });
    return respond(res, 200, { data: row });
  } catch (e) {
    return respond(res, 500, { error: 'server_error' });
  }
});

router.get('/', limitList, validateListQr, async (req, res) => {
  const tenantId = req.tenantId;
  const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
  const cursor = req.query.cursor || null;
  const sortParam = String(req.query.sort || 'created_at:desc');
  let [sortField, sortDir] = sortParam.split(':');
  if (!['created_at', 'updated_at', 'code', 'status'].includes(sortField)) sortField = 'created_at';
  if (!['asc', 'desc'].includes((sortDir || '').toLowerCase())) sortDir = 'desc';

  try {
    const rows = await withClient(async (client) => {
      const values = [tenantId];
      let where = 'tenant_id=$1';
      if (cursor) {
        values.push(cursor);
        where += sortDir.toLowerCase() === 'desc' ? ` AND ${sortField} < $2` : ` AND ${sortField} > $2`;
      }
      const { rows } = await client.query(
        `SELECT * FROM leadgen.qr_tags WHERE ${where} ORDER BY ${sortField} ${sortDir.toUpperCase()} LIMIT ${limit + 1}`,
        values
      );
      return rows;
    });

    let nextCursor = null;
    let data = rows;
    if (rows.length > limit) {
      const last = rows[limit - 1];
      data = rows.slice(0, limit);
      nextCursor = last[sortField];
    }
    return respond(res, 200, { data, extra: nextCursor ? { next_cursor: nextCursor } : {} });
  } catch (e) {
    return respond(res, 500, { error: 'server_error' });
  }
});

export default router;


