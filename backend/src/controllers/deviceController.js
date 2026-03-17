import { asyncHandler } from '../middleware/errorHandler.js';
import * as deviceService from '../services/deviceService.js';

export const listDevices = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;
  const result = await deviceService.listDevices(page, limit);
  res.json({ success: true, data: result.data, pagination: result.pagination });
});

export const getDevice = asyncHandler(async (req, res) => {
  const device = await deviceService.getDevice(req.params.id);
  res.json({ success: true, data: device });
});

export const getDeviceLogs = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;

  const result = await deviceService.getDeviceLogs(req.params.id, { page, limit });

  res.json({
    success: true,
    data: result.data,
    pagination: result.pagination
  });
});

export const updateDevice = asyncHandler(async (req, res) => {
  const { campaignIds, status } = req.body;
  const { device, campaignIdsChanged } = await deviceService.updateDevice(
    req.params.id,
    { campaignIds, status }
  );

  // [PUSH] Trigger Real-time Manifest Refresh
  // [FIX] Add 500ms "Integrity Delay" to allow DB transaction to fully propagate/commit
  if (campaignIdsChanged) {
    setTimeout(async () => {
      try {
        const { pushService } = await import('../services/pushService.js');
        pushService.sendEvent(req.params.id, 'REFRESH_MANIFEST', {
          timestamp: Date.now(),
          reason: 'campaign_assignment'
        });
        console.log(`[Device] Sent delayed refresh signal to ${req.params.id}`);
      } catch (e) {
        console.error('[Device] Failed to send delayed refresh', e);
      }
    }, 500);
  }

  res.json({ success: true, data: device });
});
