import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { getNotificationsForUser } from '../services/notifications.js';

const router = express.Router();

// GET /api/notifications
router.get('/', authenticateToken, asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '15'), 50);
  const since = req.query.since;
  const notifications = await getNotificationsForUser(req.user, { limit, since });
  res.json({ success: true, data: { notifications } });
}));

export default router;


