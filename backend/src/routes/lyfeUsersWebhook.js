/**
 * Lyfe → MKTR push channel for user-table changes.
 *
 * Mounted at `/api/integrations/lyfe/users-webhook` (POST). Auth is
 * per-request via Bearer token, NOT the platform JWT — this endpoint is
 * called by Postgres triggers in Lyfe Supabase, which can't carry a
 * user JWT.
 *
 * Path is deliberately separate from `/api/lyfe/*` because that prefix
 * is owned by `lyfeAgents.js`, which applies `authenticateToken` at
 * router level — middleware runs before path matching, so a sibling
 * unauthenticated route under the same prefix would 401.
 */

import express from 'express';
import { handleLyfeUsersWebhook } from '../controllers/lyfeUsersWebhookController.js';

export const meta = { path: '/api/integrations/lyfe' };

const router = express.Router();

router.post('/users-webhook', express.json({ limit: '64kb' }), handleLyfeUsersWebhook);

export default router;
