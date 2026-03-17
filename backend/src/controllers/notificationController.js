import { getNotificationsForUser } from '../services/notifications.js';

// GET /api/notifications
export async function listNotifications(req, res) {
  const limit = Math.min(parseInt(req.query.limit || '15'), 50);
  const since = req.query.since;
  const notifications = await getNotificationsForUser(req.user, { limit, since });
  res.json({ success: true, data: { notifications } });
}
