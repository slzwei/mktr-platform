import { Router } from 'express';
import { withClient } from '../db/index.js';

const router = Router();

router.get('/', async (req, res) => {
  const tenantId = req.tenantId;
  try {
    const rows = await withClient(async (client) => {
      const { rows } = await client.query('SELECT id, email, name FROM public.users WHERE tenant_id=$1 AND ARRAY[\'agent\'] && COALESCE(roles, ARRAY[]::text[])', [tenantId]);
      return rows;
    });
    res.json({ success: true, data: rows });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

export default router;


