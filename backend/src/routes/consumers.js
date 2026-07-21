import express from 'express';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import * as consumerController from '../controllers/consumerController.js';

export const meta = { path: '/api/consumers' };

const router = express.Router();

// Cross-campaign person journey — ADMIN ONLY, explicitly. The prospects
// detail route is deliberately looser (agents open their own leads); this one
// aggregates a person's history across every campaign and must not be.
router.get('/:id', authenticateToken, requireAdmin, consumerController.getConsumer);

// PDPA person-level erasure (PR C) — admin + explicit body.confirm='ERASE'.
router.post('/:id/erase', authenticateToken, requireAdmin, consumerController.eraseConsumer);

export default router;
