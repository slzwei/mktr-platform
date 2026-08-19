/**
 * Default-deny routing (routeGates.js): the public API surface is EXPLICIT.
 *
 * Every endpoint mounted through loadRoutes must carry a tagged auth gate or
 * be declared in its module's meta.public — an undeclared open route refuses
 * to BOOT (three audit rounds each found endpoints that shipped open: H2, M3,
 * M12). This suite is the RATCHET on top of that boot check: the exact
 * declared-public surface is snapshotted below, so making a new route public
 * is a conscious, reviewable edit to this file — never a silent default.
 */
import { readdir } from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import express from 'express'
import { getApp, closeDb } from './helpers.js'
import { walkRouter, assertRouterGated, tagAuthGate } from '../src/routes/routeGates.js'

const routesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/routes')

// The ENTIRE intentionally-public API surface. Adding a route here requires a
// reason in the module's meta.public comment; removing a gate elsewhere fails
// boot before it fails this test.
const PUBLIC_SURFACE = {
  "analytics.js": [
    "POST /events",
    "POST /referrals",
    // Touchpoint beacon (ads-centralisation §4.3): public browser beacon,
    // own rate bucket, Joi-validated, flag-gated skip, session-id only —
    // never authorization material.
    "POST /touch"
  ],
  "auth.js": [
    "GET /google/config",
    "GET /google/state",
    "GET /invite-info/:token",
    "GET /verify-email/:token",
    "POST /accept-invite",
    "POST /forgot-password",
    "POST /google",
    "POST /google/callback",
    "POST /login",
    "POST /register",
    "POST /reset-password/:token"
  ],
  "campaignPreviews.js": [
    "GET /public/:id",
    "GET /slug/:slug"
  ],
  "campaigns.js": [
    "GET /featured-drops"
  ],
  "contact.js": [
    "POST /"
  ],
  "dnc.js": [
    "POST /check"
  ],
  "externalAdminLeadOps.js": [
    "POST /reassign",
    "POST /return-to-held"
  ],
  "externalAgentPackages.js": [
    "POST /"
  ],
  "externalBilling.js": [
    "POST /hitpay-webhook"
  ],
  "externalHeldLeads.js": [
    "POST /",
    "POST /assign"
  ],
  "externalLeadActivities.js": [
    "POST /"
  ],
  "externalLeadOutcomes.js": [
    "POST /lead-outcomes"
  ],
  "lyfeEntitlementUnlock.js": [
    "POST /entitlement-unlock"
  ],
  "lyfeLeadOutcome.js": [
    "POST /lead-outcome"
  ],
  "lyfeUsersWebhook.js": [
    "POST /users-webhook"
  ],
  "marketplace.js": [
    "GET /campaigns",
    "GET /campaigns/:slug"
  ],
  "meta.js": [
    "GET /oauth/callback",
    "GET /webhook",
    "POST /oauth/data-deletion",
    "POST /oauth/deauthorize",
    "POST /webhook"
  ],
  "prospects.js": [
    "POST /"
  ],
  "redeemOpsDiscovery.js": [
    "POST /discovery/webhook/:secret"
  ],
  "retell.js": [
    "POST /webhook"
  ],
  "rewardClaim.js": [
    "GET /:token"
  ],
  "screeningCallback.js": [
    "GET /:token",
    "POST /:token"
  ],
  "shortlinks.js": [
    "GET /:slug",
    "POST /public/share"
  ],
  "tracker.js": [
    "GET /session",
    "GET /track/:slug"
  ],
  "unsubscribe.js": [
    "GET /",
    "POST /"
  ],
  "verify.js": [
    "POST /check",
    "POST /send"
  ],
  "waitlist.js": [
    "POST /"
  ],
  "whatsappWebhook.js": [
    "GET /webhook",
    "POST /webhook"
  ]
}

beforeAll(async () => {
  await getApp() // proves boot-time enforcement passes on the real app
})

afterAll(async () => {
  await closeDb()
})

async function loadRouteModules() {
  const files = (await readdir(routesDir)).filter(
    (f) => f.endsWith('.js') && f !== 'index.js' && f !== 'routeGates.js'
  )
  const mods = []
  for (const f of files) {
    const mod = await import(path.join(routesDir, f))
    if (mod.meta && mod.default) mods.push({ file: f, meta: mod.meta, router: mod.default })
  }
  return mods
}

describe('default-deny route registration', () => {
  test('every mounted route is gated or explicitly declared public', async () => {
    for (const { file, meta, router } of await loadRouteModules()) {
      expect(() => assertRouterGated({ router, meta, file })).not.toThrow()
    }
  })

  test('the declared public surface matches the snapshot exactly', async () => {
    const actual = {}
    for (const { file, meta } of await loadRouteModules()) {
      if (meta.public?.length) actual[file] = [...meta.public].sort()
    }
    expect(actual).toEqual(PUBLIC_SURFACE)
  })

  test('walker: router-level gates protect everything registered after them', () => {
    const gate = tagAuthGate((req, res, next) => next())
    const r = express.Router()
    r.get('/before', (req, res) => res.end())
    r.use(gate)
    r.post('/after', (req, res) => res.end())
    const routes = walkRouter(r.stack)
    expect(routes).toEqual([
      { sig: 'GET /before', gated: false },
      { sig: 'POST /after', gated: true },
    ])
  })

  test('enforcement: undeclared open route throws; declared passes', () => {
    const r = express.Router()
    r.get('/leak', (req, res) => res.end())
    expect(() => assertRouterGated({ router: r, meta: {}, file: 'fake.js' }))
      .toThrow(/Ungated route\(s\) in fake\.js.*GET \/leak/)
    expect(() =>
      assertRouterGated({ router: r, meta: { public: ['GET /leak'] }, file: 'fake.js' })
    ).not.toThrow()
  })

  test('enforcement: stale and redundant declarations both throw', () => {
    const gate = tagAuthGate((req, res, next) => next())
    const r = express.Router()
    r.get('/secured', gate, (req, res) => res.end())
    expect(() =>
      assertRouterGated({ router: r, meta: { public: ['GET /gone'] }, file: 'fake.js' })
    ).toThrow(/do not exist/)
    expect(() =>
      assertRouterGated({ router: r, meta: { public: ['GET /secured'] }, file: 'fake.js' })
    ).toThrow(/carry an auth gate/)
  })
})
