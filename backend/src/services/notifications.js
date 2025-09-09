import { Op } from 'sequelize';
import { User, Prospect, ProspectActivity, QrScan, QrTag, Car, Campaign, FleetOwner } from '../models/index.js';

function mapUserSignup(u) {
  return {
    id: `user_${u.id}`,
    type: 'user_signup',
    title: 'New user signup',
    message: `${u.fullName || u.email} joined as ${u.role}`,
    createdAt: u.createdAt,
    link: '/AdminUsers',
    meta: { userId: u.id, role: u.role }
  };
}

function mapProspectCreated(a, prospect) {
  return {
    id: `lead_${a.id}`,
    type: 'lead_created',
    title: 'New lead captured',
    message: `${prospect?.firstName || 'Lead'} created${prospect?.campaign ? ` for ${prospect.campaign.name}` : ''}`,
    createdAt: a.createdAt,
    link: '/AdminProspects',
    meta: { prospectId: prospect?.id, campaignId: prospect?.campaignId, assignedAgentId: prospect?.assignedAgentId }
  };
}

function mapQrScan(s, qr, car) {
  return {
    id: `scan_${s.id}`,
    type: 'qr_scan',
    title: 'QR code scanned',
    message: `${qr?.label || qr?.slug || 'QR'} was scanned${car?.plate_number ? ` (car ${car.plate_number})` : ''}`,
    createdAt: s.ts,
    link: '/AdminQRCodes',
    meta: { qrTagId: qr?.id, carId: car?.id, slug: qr?.slug }
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
        include: [{ model: Prospect, as: 'prospect', include: [{ model: Campaign, as: 'campaign' }] }],
        limit,
        order: [['createdAt', 'DESC']]
      }).then(rows => rows.map(a => mapProspectCreated(a, a.prospect)))
    );
    tasks.push(
      QrScan.findAll({
        where: createdSince ? { ts: whereTime } : undefined,
        include: [{ model: QrTag, as: 'qrTag', include: [{ model: Car, as: 'car' }] }],
        limit,
        order: [['ts', 'DESC']]
      }).then(rows => rows.map(s => mapQrScan(s, s.qrTag, s.qrTag?.car)))
    );
  } else if (role === 'agent') {
    tasks.push(
      ProspectActivity.findAll({
        where: { type: 'created', ...(createdSince ? { createdAt: whereTime } : {}) },
        include: [{ model: Prospect, as: 'prospect', where: { assignedAgentId: user.id }, include: [{ model: Campaign, as: 'campaign' }] }],
        limit,
        order: [['createdAt', 'DESC']]
      }).then(rows => rows.map(a => mapProspectCreated(a, a.prospect)))
    );
  } else if (role === 'driver_partner') {
    tasks.push(
      QrScan.findAll({
        where: createdSince ? { ts: whereTime } : undefined,
        include: [{
          model: QrTag, as: 'qrTag', include: [{ model: Car, as: 'car', required: true, where: { current_driver_id: user.id } }]
        }],
        limit,
        order: [['ts', 'DESC']]
      }).then(rows => rows.map(s => mapQrScan(s, s.qrTag, s.qrTag?.car)))
    );
  } else if (role === 'fleet_owner') {
    const fo = await FleetOwner.findOne({ where: { userId: user.id } });
    const fleetOwnerId = fo?.id || null;
    tasks.push(
      QrScan.findAll({
        where: createdSince ? { ts: whereTime } : undefined,
        include: [{
          model: QrTag, as: 'qrTag', include: [{ model: Car, as: 'car', required: true, where: fleetOwnerId ? { fleet_owner_id: fleetOwnerId } : {} }]
        }],
        limit,
        order: [['ts', 'DESC']]
      }).then(rows => rows.map(s => mapQrScan(s, s.qrTag, s.qrTag?.car)))
    );
  } else {
    // Other roles: show nothing for now
  }

  const results = (await Promise.all(tasks)).flat();
  // Sort combined results by created time desc and trim to limit
  const withTime = results.map(r => ({ ...r, _t: new Date(r.createdAt).getTime() }));
  withTime.sort((a, b) => b._t - a._t);
  return withTime.slice(0, limit).map(({ _t, ...r }) => r);
}

export default { getNotificationsForUser };


