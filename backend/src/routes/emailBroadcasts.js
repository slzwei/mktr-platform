import express from 'express';
import Joi from 'joi';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import { validate } from '../middleware/validation.js';
import * as emailBroadcastController from '../controllers/emailBroadcastController.js';

export const meta = { path: '/api/email-broadcasts' };

/**
 * Email broadcast push (tracker "emailpush") — ADMIN ONLY, the /api/cohorts
 * posture: broadcasts aggregate cross-campaign PII and SEND marketing mail.
 * Nothing here fires without an explicit admin action; the binding
 * per-recipient consent gate lives in emailBroadcastService (§3.3), not in
 * these schemas. Joi stays local to this file on purpose — the shared
 * validation middleware carries parallel in-flight work.
 */

const uuid = Joi.string().uuid();
const shortStr = (max) => Joi.string().trim().min(1).max(max);

const createSchema = Joi.object({
  cohortId: uuid.required(),
  campaignId: uuid.required(),
  subject: shortStr(200).required(),
  bodyText: shortStr(5000).required(),
  ctaLabel: shortStr(80),
});

const updateSchema = Joi.object({
  cohortId: uuid,
  campaignId: uuid,
  subject: shortStr(200),
  bodyText: shortStr(5000),
  ctaLabel: shortStr(80),
}).min(1);

// `resume` continues an interrupted/stale send over remaining pending rows
// only — it never re-resolves the audience (§3.3).
const sendSchema = Joi.object({
  resume: Joi.boolean(),
});

const router = express.Router();
router.use(authenticateToken, requireAdmin);

router.post('/', validate(createSchema), emailBroadcastController.create);
router.get('/', emailBroadcastController.list);
router.get('/:id', emailBroadcastController.get);
router.put('/:id', validate(updateSchema), emailBroadcastController.update);
router.delete('/:id', emailBroadcastController.destroy);
router.post('/:id/send', validate(sendSchema), emailBroadcastController.send);
router.post('/:id/cancel', emailBroadcastController.cancel);
// Test sends go to the REQUESTING admin's own address — deliberately no `to`
// parameter (an authenticated arbitrary-address relay would be an abuse hole).
router.post('/:id/test', emailBroadcastController.test);
router.get('/:id/recipients', emailBroadcastController.recipients);

export default router;
