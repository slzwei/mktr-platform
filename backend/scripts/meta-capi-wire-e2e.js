#!/usr/bin/env node
/**
 * Phase 2 manual gate — wire-up E2E.
 *
 * Runs prospectService.createProspect against mocked DB models so the function
 * completes without a live Postgres, but uses the REAL metaCapiService and
 * REAL Pino logger. This exercises:
 *   - the meta-fields destructure + sourceMetadata merge in createProspect
 *   - the fire-and-forget sendLeadEvent dispatch post-commit
 *   - real Pino redaction config (any accidental token logging would be visible)
 *   - real Meta CAPI dispatch (event lands in Pixel → Test Events tab)
 *
 * Does NOT exercise: Express middleware, dotenv loading in server.js,
 * Joi validation in the route, or the bootstrap path. Those are
 * deferred to staging.
 *
 * Required env:
 *   META_CAPI_ENABLED=true
 *   META_PIXEL_ID, META_CAPI_ACCESS_TOKEN, META_TEST_EVENT_CODE
 *
 * Usage:
 *   node backend/scripts/meta-capi-wire-e2e.js
 *
 * Verification (shell):
 *   node backend/scripts/meta-capi-wire-e2e.js 2>&1 | tee /tmp/wire-e2e.log
 *   grep 'capi.lead.sent' /tmp/wire-e2e.log    # must match
 *   grep -F "$META_CAPI_ACCESS_TOKEN" /tmp/wire-e2e.log    # must NOT match
 *
 * Exit codes:
 *   0  createProspect completed; sendLeadEvent dispatched
 *   1  missing env / config error
 */
import dotenv from 'dotenv';
dotenv.config();

import { makeProspectService } from '../src/services/prospectService.js';

const REQUIRED = ['META_PIXEL_ID', 'META_CAPI_ACCESS_TOKEN', 'META_TEST_EVENT_CODE'];
for (const k of REQUIRED) {
  if (!process.env[k]) {
    console.error(`[wire-e2e] missing env: ${k}`);
    process.exit(1);
  }
}
if (process.env.META_CAPI_ENABLED !== 'true') {
  console.error(`[wire-e2e] META_CAPI_ENABLED must be "true"; got: ${process.env.META_CAPI_ENABLED}`);
  process.exit(1);
}

// Mocked DB layer: just enough to satisfy the createProspect happy path.
const deps = {
  models: {
    Prospect: {
      findOne: async () => null,
      findByPk: async (id) => ({ id, campaign: null, assignedAgent: null }),
      create: async (fields) => ({ id: `wire-${Date.now()}`, ...fields, update: async () => {} }),
    },
    ProspectActivity: { create: async () => ({}) },
    Attribution: { findOne: async () => null },
    Campaign: { findByPk: async () => null },
    QrTag: { findByPk: async () => null, update: async () => [0, []] },
    User: { findByPk: async () => null },
    AgentGroup: { findByPk: async () => null },
    AgentGroupMember: { findAll: async () => [] },
    Commission: {},
  },
  sequelize: {
    transaction: async (cb) => cb({ /* fake tx */ }),
    literal: (s) => ({ literal: s }),
  },
  resolveAssignedAgentId: async () => null,
  getSystemAgentId: async () => null,
  deductLeadCredit: async () => {},
  buildProspectWhere: () => {},
  dispatchEvent: async () => {},
  // sendLeadEvent + logger are NOT overridden — we want the real ones
  AppError: class extends Error { constructor(m, s) { super(m); this.statusCode = s; } },
};

const svc = makeProspectService(deps);

const eventId = `wire-e2e-${Date.now()}`;
const body = {
  firstName: 'Wire',
  lastName: 'E2E',
  email: `wire-e2e-${Date.now()}@mktr.sg`,
  phone: '+6591234567',
  leadSource: 'website',
  // Meta fields posted by the lead-capture form:
  eventId,
  fbp: 'fb.1.000000.111111',
  fbc: 'fb.1.000000.fbclid_wire_e2e',
  eventSourceUrl: 'https://mktr.sg/lead-capture/phase2-wire-e2e',
  // Phase 4: consent flags. consent_contact=true makes em+ph land in CAPI user_data.
  consent_contact: true,
  consent_terms: true,
};

const meta = {
  clientIp: '203.0.113.42',
  clientUserAgent: 'phase2-wire-e2e/1.0',
  eventId: body.eventId,
  fbp: body.fbp,
  fbc: body.fbc,
  eventSourceUrl: body.eventSourceUrl,
};

console.log('[wire-e2e] calling createProspect with eventId:', eventId);
try {
  await svc.createProspect(body, null, { meta });
  console.log('[wire-e2e] createProspect returned; awaiting fire-and-forget CAPI dispatch...');
  // sendLeadEvent is fire-and-forget; give it time to complete + flush logs.
  await new Promise((r) => setTimeout(r, 3000));
  console.log('[wire-e2e] done. Check stdout above for "capi.lead.sent" line.');
  process.exit(0);
} catch (err) {
  console.error('[wire-e2e] unexpected throw from createProspect:', err.message);
  console.error(err.stack);
  process.exit(1);
}
