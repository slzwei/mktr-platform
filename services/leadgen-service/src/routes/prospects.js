import { Router } from 'express';
import { withClient } from '../db/index.js';

const router = Router();

router.post('/', async (req, res) => {
  const tenantId = req.tenantId;
  const { qr_tag_id = null, campaign_id = null, assigned_agent_id = null, status = 'new', payload_json = {}, verified_at = null } = req.body || {};
  try {
    const row = await withClient(async (client) => {
      const { rows } = await client.query(
        'INSERT INTO leadgen.prospects (id, tenant_id, qr_tag_id, campaign_id, assigned_agent_id, status, payload_json, verified_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6::jsonb, $7) RETURNING *',
        [tenantId, qr_tag_id, campaign_id, assigned_agent_id, status, JSON.stringify(payload_json), verified_at]
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
      const { rows } = await client.query('SELECT * FROM leadgen.prospects WHERE id=$1 AND tenant_id=$2', [id, tenantId]);
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
      const { rows } = await client.query('SELECT * FROM leadgen.prospects WHERE tenant_id=$1 ORDER BY created_at DESC', [tenantId]);
      return rows;
    });
    res.json({ success: true, data: rows });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

export default router;


