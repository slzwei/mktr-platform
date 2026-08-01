import { Op } from 'sequelize';
import { User, Prospect, ProspectActivity, QrScan, QrTag, Campaign } from '../models/index.js';

function roleLabel(role) {
  return role || 'user';
}

function maskPhone(phone) {
  if (!phone) return '';
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length <= 4) return digits;
  return `${'*'.repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
}

function shortHost(ref) {
  try {
    const u = new URL(ref);
    return u.host;
  } catch (_) {
    return null;
  }
}

function mapUserSignup(u) {
  const via = u.googleSub ? 'Google' : 'email/password';
  const status = u.approvalStatus || (u.isActive ? 'active' : 'inactive');
  return {
    id: `user_${u.id}`,
    type: 'user_signup',
    title: `User signup: ${roleLabel(u.role)}`,
    message: `${u.fullName || u.email} (${u.email}) • status: ${status} • via ${via}`,
    createdAt: u.createdAt,
    link: '/AdminUsers',
    meta: { userId: u.id, role: u.role, avatarUrl: u.avatarUrl || null }
  };
}

function mapProspectCreated(a, prospect) {
  const name = [prospect?.firstName, prospect?.lastName].filter(Boolean).join(' ') || 'Lead';
  const campaignName = prospect?.campaign?.name ? ` for ${prospect.campaign.name}` : '';
  const phoneMasked = maskPhone(prospect?.phone);
  const src = prospect?.leadSource || a?.metadata?.leadSource || 'unknown';
  const agentName = prospect?.assignedAgent?.fullName || prospect?.assignedAgent?.email || 'TBD';
  const qr = prospect?.qrTag;
  const qrInfo = qr?.label || qr?.slug ? ` • QR: ${qr?.label || qr?.slug}` : '';
  return {
    id: `lead_${a.id}`,
    type: 'lead_created',
    title: `New lead${campaignName}`,
    message: `${name}${phoneMasked ? ` (${phoneMasked})` : ''} • source: ${src} • assigned: ${agentName}${qrInfo}`,
    createdAt: a.createdAt,
    link: '/AdminProspects',
    meta: {
      prospectId: prospect?.id,
      campaignId: prospect?.campaignId,
      assignedAgentId: prospect?.assignedAgentId,
      qrTagId: qr?.id
    }
  };
}

function mapQrScan(s, qr) {
  const where = s.geoCity ? ` in ${s.geoCity}` : '';
  const host = shortHost(s.referer);
  const from = host ? ` from ${host}` : '';
  const campaignName = qr?.campaign?.name ? ` • ${qr.campaign.name}` : '';
  return {
    id: `scan_${s.id}`,
    type: 'qr_scan',
    title: `QR scanned: ${qr?.label || qr?.slug || 'QR'}`,
    message: `${s.device || 'device'}${where}${from}${campaignName}`,
    createdAt: s.ts,
    link: '/AdminQRCodes',
    meta: { qrTagId: qr?.id, slug: qr?.slug, campaignId: qr?.campaignId }
  };
}

export async function getNotificationsForUser(user, { limit = 15, since } = {}) {
  const createdSince = since ? new Date(since) : null;
  const whereTime = createdSince ? { [Op.gte]: createdSince } : undefined;

  if (!user || !user.role) return [];

  const role = user.role;
  const tasks = [];

  if (role === 'admin') {
    // Admin sees everything: recent user signups, leads, qr scans
    tasks.push(
      User.findAll({
        where: createdSince ? { createdAt: whereTime } : undefined,
        limit,
        order: [['createdAt', 'DESC']]
      }).then(rows => rows.map(mapUserSignup))
    );
    tasks.push(
      ProspectActivity.findAll({
        where: { type: 'created', ...(createdSince ? { createdAt: whereTime } : {}) },
        include: [{
          model: Prospect,
          as: 'prospect',
          include: [
            { model: Campaign, as: 'campaign' },
            { model: QrTag, as: 'qrTag' },
            { model: User, as: 'assignedAgent' }
          ]
        }],
        limit,
        order: [['createdAt', 'DESC']]
      }).then(rows => rows.map(a => mapProspectCreated(a, a.prospect)))
    );
    tasks.push(
      QrScan.findAll({
        where: createdSince ? { ts: whereTime } : undefined,
        include: [{ model: QrTag, as: 'qrTag', include: [{ model: Campaign, as: 'campaign' }] }],
        limit,
        order: [['ts', 'DESC']]
      }).then(rows => rows.map(s => mapQrScan(s, s.qrTag)))
    );
  } else if (role === 'agent') {
    tasks.push(
      ProspectActivity.findAll({
        where: { type: 'created', ...(createdSince ? { createdAt: whereTime } : {}) },
        include: [{
          model: Prospect,
          as: 'prospect',
          where: { assignedAgentId: user.id },
          include: [
            { model: Campaign, as: 'campaign' },
            { model: QrTag, as: 'qrTag' },
            { model: User, as: 'assignedAgent' }
          ]
        }],
        limit,
        order: [['createdAt', 'DESC']]
      }).then(rows => rows.map(a => mapProspectCreated(a, a.prospect)))
    );
  } else {
    // Other roles (including the retired driver/fleet ones): nothing.
  }

  const results = (await Promise.all(tasks)).flat();
  // Sort combined results by created time desc and trim to limit
  const withTime = results.map(r => ({ ...r, _t: new Date(r.createdAt).getTime() }));
  withTime.sort((a, b) => b._t - a._t);
  return withTime.slice(0, limit).map(({ _t, ...r }) => r);
}

export default { getNotificationsForUser };


