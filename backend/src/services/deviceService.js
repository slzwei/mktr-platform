import { Device, Campaign, BeaconEvent, Impression, DeviceCampaignAssignment, CampaignMediaItem } from '../models/index.js';
import { AppError } from '../middleware/errorHandler.js';

/**
 * List devices with hydrated campaign data (reads from join table).
 */
export async function listDevices(page = 1, limit = 50) {
  const offset = (page - 1) * limit;
  const { count, rows: devices } = await Device.findAndCountAll({
    include: [{
      association: 'assignedCampaigns',
      attributes: ['id', 'name', 'status', 'type'],
      through: { attributes: ['sortOrder'] }
    }],
    order: [['lastSeenAt', 'DESC']],
    limit,
    offset,
    distinct: true
  });

  const devicesWithCampaigns = devices.map(d => {
    const deviceJson = d.toJSON();

    // Sort by join-table sortOrder and strip the through metadata
    const sorted = (deviceJson.assignedCampaigns || [])
      .sort((a, b) => (a.DeviceCampaignAssignment?.sortOrder ?? 0) - (b.DeviceCampaignAssignment?.sortOrder ?? 0));

    deviceJson.campaigns = sorted.map(c => ({
      id: c.id,
      name: c.name,
      status: c.status,
      type: c.type
    }));

    // Keep campaignIds in the response for backward compat
    deviceJson.campaignIds = sorted.map(c => c.id);

    delete deviceJson.assignedCampaigns;
    return deviceJson;
  });

  return {
    data: devicesWithCampaigns,
    pagination: {
      currentPage: page,
      totalPages: Math.ceil(count / limit),
      totalItems: count,
      itemsPerPage: limit
    }
  };
}

/**
 * Get a single device by ID.
 */
export async function getDevice(id) {
  const device = await Device.findByPk(id);
  if (!device) {
    throw new AppError('Device not found', 404);
  }
  return device;
}

/**
 * Get merged device logs (beacon events + impressions), paginated.
 */
export async function getDeviceLogs(id, { page = 1, limit = 50 }) {
  if (page > 20) {
    throw new AppError('Log history depth exceeded. Please filter by date (future feature).', 400);
  }

  const device = await Device.findByPk(id);
  if (!device) {
    throw new AppError('Device not found', 404);
  }

  const fetchLimit = page * limit;

  // 1. Fetch Standard Logs (BeaconEvents)
  const beaconLogsPromise = BeaconEvent.findAll({
    where: { deviceId: id },
    order: [['createdAt', 'DESC']],
    limit: fetchLimit
  });

  // 2. Fetch Playback Logs (Impressions)
  const impressionsPromise = Impression.findAll({
    where: { deviceId: id },
    order: [['occurredAt', 'DESC']],
    limit: fetchLimit,
    include: [{
      model: Campaign,
      as: 'campaign',
      attributes: ['name']
    }]
  });

  const [beaconLogs, impressions] = await Promise.all([beaconLogsPromise, impressionsPromise]);

  // 3. Transform Impressions to "Log" format
  const playbackLogs = impressions.map(imp => ({
    id: `imp_${imp.id}`,
    type: 'PLAYBACK',
    createdAt: imp.occurredAt,
    deviceId: imp.deviceId,
    payload: {
      assetId: imp.adId,
      mediaType: imp.mediaType,
      durationMs: imp.durationMs,
      campaignId: imp.campaignId,
      campaignName: imp.campaign?.name || 'Unknown Campaign'
    }
  }));

  // 4. Merge
  const allLogs = [...beaconLogs.map(l => l.toJSON()), ...playbackLogs];

  // 5. Sort Descending
  allLogs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  // 6. Paginate (Slice)
  const startIndex = (page - 1) * limit;
  const endIndex = startIndex + limit;
  const paginatedLogs = allLogs.slice(startIndex, endIndex);

  return {
    data: paginatedLogs,
    pagination: {
      page,
      limit,
      total: (page * limit) + (allLogs.length > fetchLimit ? 100 : 0),
      pages: 20
    }
  };
}

/**
 * Update device (assign campaigns, change status).
 * Returns updated device JSON and whether campaignIds changed (for push notification).
 *
 * Dual-write strategy: writes to both the JSON column (backward compat) and the
 * device_campaign_assignments join table (new canonical source).
 */
export async function updateDevice(id, { campaignIds, status }) {
  const device = await Device.findByPk(id);
  if (!device) {
    throw new AppError('Device not found', 404);
  }

  // Validation: Check if campaigns exist and have media
  if (campaignIds && Array.isArray(campaignIds) && campaignIds.length > 0) {
    const campaigns = await Campaign.findAll({
      where: { id: campaignIds },
      include: [{
        model: CampaignMediaItem,
        as: 'mediaItems',
        attributes: ['id']
      }]
    });

    if (campaigns.length !== campaignIds.length) {
      throw new AppError('One or more campaigns not found', 400);
    }

    const emptyMedia = campaigns.find(c => !c.mediaItems || c.mediaItems.length === 0);
    if (emptyMedia) {
      throw new AppError(
        `Campaign "${emptyMedia.name}" has no media. All assigned campaigns must have media content.`,
        400
      );
    }
  }

  // Whitelist updates (dual-write: keep JSON column in sync)
  const updates = {};
  if (campaignIds !== undefined) {
    updates.campaignIds = campaignIds;
    updates.campaignId = null;
  }
  if (status !== undefined) updates.status = status;

  await device.update(updates);

  // Dual-write: sync join table when campaignIds change
  if (campaignIds !== undefined) {
    await DeviceCampaignAssignment.destroy({ where: { deviceId: id } });
    if (campaignIds.length > 0) {
      const rows = campaignIds.map((cId, idx) => ({
        deviceId: id,
        campaignId: cId,
        sortOrder: idx
      }));
      await DeviceCampaignAssignment.bulkCreate(rows, { ignoreDuplicates: true });
    }
  }

  // Fetch fresh names for response
  const finalCampaignIds = updates.campaignIds || device.campaignIds || [];
  const finalCampaigns = await Campaign.findAll({
    where: { id: finalCampaignIds },
    attributes: ['id', 'name']
  });

  const deviceJson = device.toJSON();
  deviceJson.campaigns = finalCampaigns;

  return {
    device: deviceJson,
    campaignIdsChanged: campaignIds !== undefined
  };
}
