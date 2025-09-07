import crypto from 'crypto';
import { sequelize } from '../database/connection.js';
import Device from '../models/Device.js';

async function main() {
  const deviceKey = process.env.TEST_DEVICE_KEY || 'test-device-key';
  const tenantId = process.env.TENANT_DEFAULT || '00000000-0000-0000-0000-000000000000';
  const secretHash = crypto.createHash('sha256').update(deviceKey).digest('hex');
  await sequelize.authenticate();
  await Device.sync({ alter: false });
  const [row, created] = await Device.findOrCreate({ where: { secretHash }, defaults: { tenantId, status: 'active', model: 'tablet-ci' } });
  console.log(JSON.stringify({ ok: true, created, device_id: row.id, tenant_id: row.tenantId }));
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });


