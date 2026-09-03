import express from 'express';
import Joi from 'joi';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import { validate } from '../middleware/validation.js';
import { uuidParamGuard } from '../middleware/uuidParam.js';
import * as rsvpController from '../controllers/rsvpController.js';
import { LIMITS } from '../utils/rsvpLayout.js';

/**
 * RSVP pages — ADMIN surface (docs/plans/rsvp-pages.md §5.1). Ships dark: the
 * router is not mounted until RSVP_ENABLED=true.
 *
 * `router.use(authenticateToken, requireAdmin)` sits ahead of EVERY route on
 * purpose. Default-deny routing (routeGates.js) only proves a gate is TAGGED —
 * a lone authenticateToken would boot happily and let agents export attendee
 * lists. All global admins may access all events; there is no per-creator
 * ownership model.
 *
 * Joi here is the loud 400 at the boundary; the binding rules (slug shape +
 * reserved roots, closesAt parsing, the layout clamp, frozen fields) live in
 * rsvpService and apply to every write path. No stripUnknown: admin clients
 * that drift fail loudly.
 */
export const meta = { path: '/api/rsvp', flag: 'RSVP_ENABLED' };

const router = express.Router();

router.use(authenticateToken, requireAdmin);
router.param('id', uuidParamGuard('RSVP event'));

const createSchema = Joi.object({
  title: Joi.string().trim().min(1).max(LIMITS.title).required(),
  organiserName: Joi.string().trim().max(LIMITS.title).allow('').optional(),
  slug: Joi.string().trim().max(60).allow('', null).optional(),
});

const patchSchema = Joi.object({
  title: Joi.string().trim().min(1).max(LIMITS.title),
  organiserName: Joi.string().trim().max(LIMITS.title).allow(''),
  slug: Joi.string().trim().max(60).allow('', null),
  capacity: Joi.number().integer().min(1).max(100000).allow(null),
  closesAt: Joi.string().trim().max(40).allow('', null),
  // The clamp sanitises the document; Joi only insists it is an object.
  layout: Joi.object().unknown(true),
}).min(1);

router.get('/', rsvpController.listEvents);
router.get('/slug-availability', rsvpController.checkSlugAvailability);
router.post('/', validate(createSchema), rsvpController.createEvent);
router.get('/:id', rsvpController.getEvent);
router.patch('/:id', validate(patchSchema), rsvpController.updateEvent);
router.post('/:id/publish', rsvpController.publishEvent);
router.post('/:id/close', rsvpController.closeEvent);
// Drafts with no responses only — live events wait for the audited purge (§8.4, P3).
router.delete('/:id', rsvpController.deleteEvent);
router.get('/:id/responses', rsvpController.listResponses);

export default router;
