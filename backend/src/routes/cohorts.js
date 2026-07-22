import express from 'express';
import Joi from 'joi';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import { validate } from '../middleware/validation.js';
import { CONSUMER_CATEGORIES } from '../utils/marketplaceContent.js';
import * as cohortController from '../controllers/cohortController.js';

export const meta = { path: '/api/cohorts' };

/**
 * Cohort builder (tracker "cohortapi") — ADMIN ONLY, like /api/consumers:
 * cohorts aggregate cross-campaign PII and drive marketing pushes.
 *
 * Joi here gives live requests loud 400s with field detail; the BINDING
 * validation (incl. the §9.5-2 minAge≥18 floor) lives in
 * cohortService.normalizeDefinition, which also re-checks definitions loaded
 * back out of the DB. Schemas stay in this file on purpose — the shared
 * validation middleware carries parallel in-flight work.
 */

const uuid = Joi.string().uuid();
const shortStr = (max) => Joi.string().trim().min(1).max(max);

const definitionSchema = Joi.object({
  filters: Joi.object({
    campaignIds: Joi.array().items(uuid).max(50),
    drawIds: Joi.array().items(uuid).max(50),
    anyDraw: Joi.boolean(),
    campaignTags: Joi.array().items(shortStr(64)).max(20),
    campaignCategories: Joi.array()
      .items(Joi.string().valid(...CONSUMER_CATEGORIES))
      .max(CONSUMER_CATEGORIES.length),
    attributes: Joi.object({
      postalPrefixes: Joi.array().items(Joi.string().pattern(/^[0-9]{2,6}$/)).max(20),
      incomes: Joi.array().items(shortStr(64)).max(20),
      educations: Joi.array().items(shortStr(64)).max(20),
      genders: Joi.array().items(shortStr(32)).max(10),
    }),
  }),
  ageGate: Joi.object({
    // §9.5-2: 18 is a FLOOR, not a default — under-18 cohorts are
    // inexpressible (the service enforces the same rule bindingly).
    minAge: Joi.number().integer().min(18).max(120),
    maxAge: Joi.number().integer().min(18).max(120).allow(null),
  }),
  marketingContext: Joi.object({
    campaignId: uuid.allow(null),
  }),
});

const channelSchema = Joi.string().valid('all', 'email', 'whatsapp', 'sms', 'voice');

const previewSchema = Joi.object({
  definition: definitionSchema.required(),
  channel: channelSchema,
});

const createSchema = Joi.object({
  name: shortStr(120).required(),
  description: Joi.string().allow('', null).max(2000),
  definition: definitionSchema.required(),
});

const updateSchema = Joi.object({
  name: shortStr(120),
  description: Joi.string().allow('', null).max(2000),
  definition: definitionSchema,
}).min(1);

const router = express.Router();
router.use(authenticateToken, requireAdmin);

router.post('/preview', validate(previewSchema), cohortController.preview);
router.get('/facets', cohortController.facets); // before /:id — 'facets' is a valid path segment
router.post('/', validate(createSchema), cohortController.create);
router.get('/', cohortController.list);
router.get('/:id', cohortController.get);
router.put('/:id', validate(updateSchema), cohortController.update);
router.delete('/:id', cohortController.archive);
router.get('/:id/members', cohortController.members);

export default router;
