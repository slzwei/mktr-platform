import { Op } from 'sequelize';
import QRCode from 'qrcode';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { QrTag, Campaign, Car, QrScan, Attribution, Prospect, SessionVisit, User, AgentGroupMember, sequelize } from '../models/index.js';
import { storageService } from './storage.js';
import { AppError } from '../middleware/errorHandler.js';
import { normalizeCustomerHostChoice, customerHostOrigin } from '../utils/customerHost.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsDir = path.join(__dirname, '../../uploads/image');

let _dirEnsured = false;
function ensureQrDir() {
  if (_dirEnsured) return;
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
  _dirEnsured = true;
}

// ---- Internal helpers ----

async function generateQRCodeImage(data, options = {}) {
  const qrOptions = {
    type: 'svg',
    width: options.size || 300,
    margin: 2,
    color: { dark: options.color || '#000000', light: '#FFFFFF' },
    errorCorrectionLevel: 'M',
    ...options
  };
  return QRCode.toString(data, qrOptions);
}

function generateSlug() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 10; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
  return result;
}

function buildOwnerWhere(user, extra = {}) {
  const where = { ...extra };
  if (user.role !== 'admin') where.ownerUserId = user.id;
  return where;
}

async function generateAndStorePng(linkUrl, slug) {
  ensureQrDir();
  const pngBuffer = await QRCode.toBuffer(linkUrl, { width: 600, margin: 2 });
  const fileName = `qr-${slug}.png`;

  if (storageService.isEnabled()) {
    const key = `image/${fileName}`;
    return await storageService.uploadBuffer(key, pngBuffer, 'image/png');
  }

  const filePath = path.join(uploadsDir, fileName);
  fs.writeFileSync(filePath, pngBuffer);
  return `/uploads/image/${fileName}`;
}

// ---- Public API ----

export async function listQrCodes(user, query) {
  const { page = 1, limit = 10, type, status, campaignId, carId, search } = query;
  const offset = (page - 1) * limit;
  const where = buildOwnerWhere(user);

  if (type) where.type = type;
  if (status !== undefined) where.active = status === 'active' || status === true;
  if (campaignId) where.campaignId = campaignId;
  if (carId) where.carId = carId;
  if (search) {
    const sanitizedSearch = String(search).slice(0, 100).replace(/%/g, '\\%').replace(/_/g, '\\_');
    where[Op.or] = [
      // `label` is the canonical field on new rows; `name` is the deprecated
      // legacy alias — both must stay searchable.
      { label: { [Op.iLike]: `%${sanitizedSearch}%` } },
      { name: { [Op.iLike]: `%${sanitizedSearch}%` } },
      { description: { [Op.iLike]: `%${sanitizedSearch}%` } }
    ];
  }

  const { count, rows: qrTags } = await QrTag.findAndCountAll({
    where,
    limit: parseInt(limit),
    offset: parseInt(offset),
    order: [['createdAt', 'DESC']],
    include: [
      { association: 'owner', attributes: ['id', 'firstName', 'lastName', 'email'] },
      { association: 'campaign', attributes: ['id', 'name', 'status'] },
      { association: 'car', attributes: ['id', 'make', 'model', 'plate_number'] },
      // Routing target for round-robin QRs — powers the "Agent / Group" column in the admin UI
      { association: 'agentGroup', attributes: ['id', 'name'] }
    ]
  });

  // Enrich round-robin groups with a member count so the UI can show "N agents"
  // without a second request. One grouped query, skipped entirely when no QR uses a group.
  const groupIds = [...new Set(qrTags.map((qr) => qr.agentGroupId).filter(Boolean))];
  if (groupIds.length > 0) {
    const memberCounts = await AgentGroupMember.count({
      where: { agentGroupId: { [Op.in]: groupIds } },
      group: ['agentGroupId']
    });
    const countByGroup = new Map(memberCounts.map((row) => [row.agentGroupId, Number(row.count)]));
    for (const qr of qrTags) {
      if (qr.agentGroup) {
        qr.agentGroup.setDataValue('memberCount', countByGroup.get(qr.agentGroupId) || 0);
      }
    }
  }

  return {
    qrTags,
    pagination: {
      currentPage: parseInt(page),
      totalPages: Math.ceil(count / limit),
      totalItems: count,
      itemsPerPage: parseInt(limit)
    }
  };
}

// Resolve the customer-host CHOICE ('redeem' | 'mktr') for a QR's (effective)
// campaign. Unbound QRs (no campaign) → 'redeem' (the default host).
async function resolveQrTargetHost(campaignId) {
  if (!campaignId) return 'redeem';
  const campaign = await Campaign.findByPk(campaignId, { attributes: ['id', 'design_config'] });
  return normalizeCustomerHostChoice(campaign?.design_config?.customerHost);
}

export async function createQrCode(body, user) {
  const { label, tags = [], type, campaignId, carId,
          agentAssignmentMode, agentGroupId,
          assignedAgentPhone, assignedAgentEmail, assignedAgentName } = body;

  // Validate campaign access + capture its customer host (redeem default).
  let targetHost = 'redeem';
  if (campaignId) {
    const campaign = await Campaign.findOne({
      where: {
        id: campaignId,
        [Op.or]: [
          { createdBy: user.id },
          ...(user.role === 'admin' ? [{}] : [])
        ]
      }
    });
    if (!campaign) throw new AppError('Campaign not found or access denied', 404);
    targetHost = normalizeCustomerHostChoice(campaign.design_config?.customerHost);
  }

  // Validate car access
  if (carId) {
    const car = await Car.findByPk(carId, {
      include: [{ association: 'fleetOwner', where: { userId: user.id } }]
    });
    if (!car && user.role !== 'admin') {
      throw new AppError('Car not found or access denied', 404);
    }
  }

  // Idempotent car QR: update existing if present. If a campaign reassignment
  // moves the QR to a different customer host, re-bake the image so the printed
  // code points at the right host.
  if (type === 'car' && carId) {
    const existing = await QrTag.findOne({ where: { type: 'car', carId } });
    if (existing) {
      const effectiveTargetHost = campaignId ? targetHost : (existing.targetHost || 'redeem');
      const updates = {
        campaignId: campaignId || existing.campaignId,
        active: true,
        label: label || existing.label,
        tags
      };
      if (existing.slug && effectiveTargetHost !== (existing.targetHost || 'redeem')) {
        const linkUrl = `${customerHostOrigin(effectiveTargetHost)}/t/${existing.slug}`;
        updates.targetHost = effectiveTargetHost;
        updates.qrCode = await generateQRCodeImage(linkUrl);
        updates.qrImageUrl = await generateAndStorePng(linkUrl, existing.slug);
      }
      await existing.update(updates);
      return { qrTag: existing, updated: true };
    }
  }

  // Generate unique slug
  let slug = generateSlug();
  let retry = 0;
  while (await QrTag.findOne({ where: { slug } })) {
    slug = generateSlug();
    if (++retry > 5) break;
  }

  const publicBase = customerHostOrigin(targetHost);
  const linkUrl = `${publicBase}/t/${slug}`;
  const svg = await generateQRCodeImage(linkUrl);
  const publicUrl = await generateAndStorePng(linkUrl, slug);

  // Resolve assignedAgentId from phone for the FK (dual-write)
  let resolvedAgentId = null;
  if (assignedAgentPhone) {
    const agent = await User.findOne({
      where: { phone: assignedAgentPhone, role: 'agent', isActive: true },
      attributes: ['id']
    });
    if (agent) resolvedAgentId = agent.id;
  }

  const qrTag = await QrTag.create({
    slug,
    label: label || null,
    tags,
    type: type || null,
    campaignId: campaignId || null,
    carId: carId || null,
    ownerUserId: user.id,
    active: true,
    qrCode: svg,
    qrImageUrl: publicUrl,
    targetHost,
    agentAssignmentMode: agentAssignmentMode || 'direct',
    agentGroupId: agentGroupId || null,
    assignedAgentId: resolvedAgentId,
    assignedAgentPhone: assignedAgentPhone || null,
    assignedAgentEmail: assignedAgentEmail || null,
    assignedAgentName: assignedAgentName || null
  });

  return { qrTag, updated: false };
}

export async function getQrCode(id, user) {
  const where = buildOwnerWhere(user, { id });

  const qrTag = await QrTag.findOne({
    where,
    include: [
      { association: 'owner', attributes: ['id', 'firstName', 'lastName', 'email'] },
      { association: 'campaign', attributes: ['id', 'name', 'status', 'type'] },
      { association: 'car', attributes: ['id', 'make', 'model', 'plate_number', 'color'] },
      { association: 'prospects', attributes: ['id', 'firstName', 'lastName', 'email', 'leadStatus', 'createdAt'] }
    ]
  });

  if (!qrTag) throw new AppError('QR code not found', 404);
  return qrTag;
}

const QR_UPDATE_FIELDS = [
  'label', 'tags', 'active', 'location', 'placement', 'description',
  'agentAssignmentMode', 'agentGroupId',
  'assignedAgentId', 'assignedAgentPhone', 'assignedAgentEmail', 'assignedAgentName',
  'campaignId'
];

export async function updateQrCode(id, body, user) {
  const { regenerateCode, ...rawData } = body;
  const where = buildOwnerWhere(user, { id });
  const qrTag = await QrTag.findOne({ where });
  if (!qrTag) throw new AppError('QR code not found or access denied', 404);

  // Whitelist allowed fields
  const updateData = Object.fromEntries(
    Object.entries(rawData).filter(([k]) => QR_UPDATE_FIELDS.includes(k))
  );

  // Resolve assignedAgentId from phone when phone is being updated (dual-write)
  if (updateData.assignedAgentPhone && !updateData.assignedAgentId) {
    const agent = await User.findOne({
      where: { phone: updateData.assignedAgentPhone, role: 'agent', isActive: true },
      attributes: ['id']
    });
    if (agent) updateData.assignedAgentId = agent.id;
  }
  // Clear assignedAgentId when phone is explicitly set to null
  if ('assignedAgentPhone' in updateData && !updateData.assignedAgentPhone) {
    updateData.assignedAgentId = null;
  }

  // Resolve the effective customer host from the (possibly updated) campaign.
  // Regenerate the QR image when explicitly requested OR when a host-affecting
  // reassignment changes which host the code points at.
  const effectiveCampaignId =
    'campaignId' in updateData ? updateData.campaignId : qrTag.campaignId;
  const effectiveTargetHost = await resolveQrTargetHost(effectiveCampaignId);
  const hostChanged = effectiveTargetHost !== (qrTag.targetHost || 'redeem');

  if (regenerateCode || hostChanged) {
    const linkUrl = `${customerHostOrigin(effectiveTargetHost)}/t/${qrTag.slug}`;
    updateData.qrCode = await generateQRCodeImage(linkUrl);
    updateData.qrImageUrl = await generateAndStorePng(linkUrl, qrTag.slug);
    updateData.targetHost = effectiveTargetHost;
  }

  await qrTag.update(updateData);
  return qrTag;
}

export async function deleteQrCode(id, user) {
  const where = buildOwnerWhere(user, { id });
  const qrTag = await QrTag.findOne({ where });
  if (!qrTag) throw new AppError('QR code not found or access denied', 404);

  // Remove local PNG if present
  try {
    if (qrTag.qrImageUrl) {
      const fileRel = qrTag.qrImageUrl.replace(/^\/+/, '');
      const filePath = path.join(__dirname, '../../', fileRel);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
  } catch (_) { /* non-fatal */ }

  // Cascade: null out FK references before deletion
  await Prospect.update({ qrTagId: null, attributionId: null }, { where: { qrTagId: qrTag.id } });
  await Attribution.destroy({ where: { qrTagId: qrTag.id } });
  await QrScan.destroy({ where: { qrTagId: qrTag.id } });

  await qrTag.destroy();
}

export async function recordScan(id, metadata = {}) {
  const qrTag = await QrTag.findByPk(id);
  if (!qrTag) throw new AppError('QR code not found', 404);
  if (qrTag.status !== 'active') throw new AppError('QR code is not active', 400);

  // today is derived from Date, not user input — safe to interpolate
  const today = new Date().toISOString().split('T')[0];

  await qrTag.update({
    scanCount: sequelize.literal('"scanCount" + 1'),
    lastScanned: new Date(),
    analytics: sequelize.literal(`
      jsonb_set(
        COALESCE(analytics::jsonb, '{"dailyScans":{}}'),
        ARRAY['dailyScans', '${today}'],
        to_jsonb(COALESCE((analytics->'dailyScans'->>'${today}')::int, 0) + 1)
      )
    `)
  });

  return { scanCount: (qrTag.scanCount || 0) + 1, destinationUrl: qrTag.destinationUrl };
}

export async function getAnalytics(id, user) {
  const where = buildOwnerWhere(user, { id });
  const qrTag = await QrTag.findOne({ where });
  if (!qrTag) throw new AppError('QR code not found or access denied', 404);

  const totalScans = await QrScan.count({
    where: { qrTagId: qrTag.id, botFlag: false, isDuplicate: false }
  });

  const attributions = await Attribution.findAll({
    where: { qrTagId: qrTag.id },
    attributes: ['sessionId'],
    order: [['lastTouchAt', 'DESC']]
  });
  const sessionIds = [...new Set(attributions.map(a => a.sessionId).filter(Boolean))];

  let landings = 0;
  if (sessionIds.length > 0) {
    const visits = await SessionVisit.findAll({ where: { sessionId: sessionIds } });
    for (const v of visits) {
      const events = Array.isArray(v.eventsJson) ? v.eventsJson : [];
      if (events.some(ev => ev?.type === 'landing')) landings++;
    }
  }

  const leads = await Prospect.count({ where: { qrTagId: qrTag.id } });

  return { summary: { totalScans, landings, leads } };
}

export async function getQrImageForDownload(id, user) {
  const where = buildOwnerWhere(user, { id });
  const qrTag = await QrTag.findOne({ where });
  if (!qrTag) throw new AppError('QR code not found or access denied', 404);

  if (!qrTag.qrImageUrl) throw new AppError('QR image not available', 404);

  return {
    imageUrl: qrTag.qrImageUrl,
    fileName: `qr-code-${qrTag.slug || 'code'}.png`
  };
}

export async function bulkOperateQrCodes(operation, qrTagIds, data, user) {
  if (!operation || !qrTagIds || !Array.isArray(qrTagIds)) {
    throw new AppError('Operation and qrTagIds array are required', 400);
  }

  const where = buildOwnerWhere(user, { id: { [Op.in]: qrTagIds } });
  const qrTags = await QrTag.findAll({ where });

  if (qrTags.length !== qrTagIds.length) {
    throw new AppError('Some QR codes not found or access denied', 404);
  }

  let message;
  switch (operation) {
    case 'activate':
      await QrTag.update({ status: 'active' }, { where });
      message = `${qrTags.length} QR codes activated`;
      break;
    case 'deactivate':
      await QrTag.update({ status: 'inactive' }, { where });
      message = `${qrTags.length} QR codes deactivated`;
      break;
    case 'archive':
      await QrTag.update({ status: 'archived' }, { where });
      message = `${qrTags.length} QR codes archived`;
      break;
    case 'update': {
      // Exclude assignment + host/image fields from bulk update: campaignId and
      // targetHost change which host the QR points at (needs per-row regen), and
      // slug/qrCode/qrImageUrl must never be mass-overwritten.
      const BULK_EXCLUDE = ['agentAssignmentMode', 'agentGroupId',
        'assignedAgentId', 'assignedAgentPhone', 'assignedAgentEmail', 'assignedAgentName', 'roundRobinIndex',
        'campaignId', 'slug', 'qrCode', 'qrImageUrl', 'targetHost'];
      const safeData = Object.fromEntries(
        Object.entries(data || {}).filter(([k]) => !BULK_EXCLUDE.includes(k))
      );
      await QrTag.update(safeData, { where });
      message = `${qrTags.length} QR codes updated`;
      break;
    }
    default:
      throw new AppError('Invalid operation', 400);
  }

  return { message, affectedCount: qrTags.length };
}
