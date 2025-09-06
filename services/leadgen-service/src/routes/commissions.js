import { Router } from 'express';
import { withClient } from '../db/index.js';

const router = Router();

router.post('/', async (req, res) => {
  const tenantId = req.tenantId;
  const { prospect_id, agent_id, amount_cents, status = 'pending' } = req.body || {};
  if (!prospect_id || !agent_id || typeof amount_cents !== 'number') {
    return res.status(400).json({ success: false, message: 'prospect_id, agent_id, amount_cents required' });
  }
  try {
    const row = await withClient(async (client) => {
      const { rows } = await client.query(
        'INSERT INTO leadgen.commissions (id, tenant_id, prospect_id, agent_id, amount_cents, status) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5) RETURNING *',
        [tenantId, prospect_id, agent_id, amount_cents, status]
      );
      return rows[0];
    });
    res.status(201).json({ success: true, data: row });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.get('/:id', async (req, res) => {
  const tenantId = req.tenantId;
  const id = req.params.id;
  try {
    const row = await withClient(async (client) => {
      const { rows } = await client.query('SELECT * FROM leadgen.commissions WHERE id=$1 AND tenant_id=$2', [id, tenantId]);
      return rows[0];
    });
    if (!row) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, data: row });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.get('/', async (req, res) => {
  const tenantId = req.tenantId;
  try {
    const rows = await withClient(async (client) => {
      const { rows } = await client.query('SELECT * FROM leadgen.commissions WHERE tenant_id=$1 ORDER BY created_at DESC', [tenantId]);
      return rows;
    });
    res.json({ success: true, data: rows });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

export default router;


