/**
 * @file externalAdminPackagesController — the MKTR Leads admin app's "Lead Packages".
 *
 * ── Endpoints (mounted at /api/external/admin-packages) ─────────────────────
 *   POST /catalog               → list the package catalog (full fields + assignmentCount)
 *   POST /catalog/create        → create a package template
 *   POST /catalog/update        → update a package template
 *   POST /catalog/delete        → archive-if-assignments-else-hard-delete
 *   POST /assignments           → one agent's assignments (admin DTO, all statuses)
 *   POST /assignments/assign    → assign an ACTIVE package to a mktr-leads agent
 *   POST /assignments/topup     → delta top-up (add N) / absolute correction
 *   POST /assignments/cancel    → cancel an assignment (status → cancelled)
 *   POST /assignments/remove    → destroy an assignment (history lost)
 *   POST /campaigns             → campaign picker list
 *
 * ── Auth ────────────────────────────────────────────────────────────────────
 * HMAC-SHA256 over the RAW BODY using EXTERNAL_APP_SECRET — the SAME scheme as
 * /api/external/held-leads + /api/external/admin-lead-ops (header
 * `X-Webhook-Signature: sha256=<hex>`, freshness on the signed body `timestamp`,
 * ±5 min). NOT the platform JWT. The mktr-leads `mktr-admin-packages` broker edge
 * function (admin-JWT gated, re-checks the live admin role, holds the secret
 * server-side) is the only intended caller. The whole route is gated behind
 * ADMIN_PACKAGES_EXTERNAL_ENABLED so it stays unmounted until provisioned.
 *
 * ── Scope ───────────────────────────────────────────────────────────────────
 * Catalog ops are GLOBAL (the same catalog the MKTR web admin manages — by design).
 * Assignment ops are SCOPED in the service to mktr-leads-sourced agents
 * (User.mktrLeadsId NOT NULL), so an mktr-leads admin can never mutate a
 * Lyfe/internal assignment by a guessed UUID.
 */

import crypto from 'crypto';
import { logger } from '../utils/logger.js';
import {
  getExternalAdminCatalog,
  createPackage,
  updatePackage,
  deletePackage,
  resolveCreator,
  getExternalAdminAgentAssignments,
  assignPackageExternal,
  topUpAssignment,
  cancelAssignment,
  removeAssignmentExternal,
  listCampaignsForPicker,
} from '../services/leadPackageService.js';

const MAX_AGE_MS = 5 * 60 * 1000;
const MAX_FUTURE_MS = 2 * 60 * 1000; // tolerate clock skew
const MAX_BODY_BYTES = 64 * 1024;

function timingSafeHexEq(receivedHex, expectedHex) {
  if (typeof receivedHex !== 'string' || typeof expectedHex !== 'string') return false;
  if (receivedHex.length !== expectedHex.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(receivedHex, 'hex'), Buffer.from(expectedHex, 'hex'));
  } catch {
    return false;
  }
}

/**
 * Verify HMAC + freshness. Returns null on success, or { code, error } to send.
 * Mirrors externalAdminLeadOpsController so all external channels share one wire
 * contract (rawBody is captured by the /api/external/ verify hook in server_internal.js).
 */
function verifyExternalHmac(req) {
  const secret = process.env.EXTERNAL_APP_SECRET;
  if (!secret) {
    logger.error('[external-admin-packages] EXTERNAL_APP_SECRET not configured');
    return { code: 500, error: 'Server misconfigured' };
  }
  if (!req.rawBody || !Buffer.isBuffer(req.rawBody)) {
    logger.error('[external-admin-packages] req.rawBody missing — verify hook not wired for this path');
    return { code: 500, error: 'Server misconfigured' };
  }
  if (req.rawBody.length > MAX_BODY_BYTES) return { code: 413, error: 'Payload too large' };

  const sigHeader = req.headers['x-webhook-signature'] || '';
  if (typeof sigHeader !== 'string' || !sigHeader.startsWith('sha256=')) {
    return { code: 401, error: 'Unauthorized' };
  }
  const expectedHex = crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex');
  if (!timingSafeHexEq(sigHeader.slice(7), expectedHex)) {
    return { code: 401, error: 'Unauthorized' };
  }

  const tsMs = typeof req.body?.timestamp === 'string' ? Date.parse(req.body.timestamp) : NaN;
  if (Number.isNaN(tsMs)) return { code: 401, error: 'Unauthorized' };
  const ageMs = Date.now() - tsMs;
  if (ageMs > MAX_AGE_MS || ageMs < -MAX_FUTURE_MS) return { code: 401, error: 'Unauthorized' };

  return null;
}

/** Express middleware form — apply once on the router so every handler is gated. */
export function requireExternalHmac(req, res, next) {
  const authErr = verifyExternalHmac(req);
  if (authErr) return res.status(authErr.code).json({ success: false, error: authErr.error });
  next();
}

/** Map a thrown error to a safe response (AppError → its code/message; else 500 generic). */
function sendError(res, err, op) {
  const status = err?.statusCode && err.statusCode < 500 ? err.statusCode : 500;
  const message = status < 500 ? err.message : 'Internal server error';
  logger.error(`[external-admin-packages] ${op} failed`, { error: err?.message || String(err) });
  return res.status(status).json({ success: false, error: message });
}

// ── Catalog ───────────────────────────────────────────────────────────────────

export async function catalogList(req, res) {
  try {
    const data = await getExternalAdminCatalog();
    return res.json({ success: true, ...data });
  } catch (err) {
    return sendError(res, err, 'catalog.list');
  }
}

export async function catalogCreate(req, res) {
  const { actorMktrUserId, name, price, leadCount, campaignId, type, status, description, isPublic, qualityScore, validityPeriod, agentCommission } =
    req.body || {};
  if (!name || price === undefined || price === null || leadCount === undefined || leadCount === null) {
    return res.status(400).json({ success: false, error: 'name, price and leadCount are required' });
  }
  try {
    const createdBy = await resolveCreator(actorMktrUserId);
    const data = await createPackage({
      name, price, leadCount, campaignId: campaignId ?? null, type,
      status, description, isPublic, qualityScore, validityPeriod, agentCommission, createdBy,
    });
    return res.status(201).json({ success: true, ...data });
  } catch (err) {
    return sendError(res, err, 'catalog.create');
  }
}

export async function catalogUpdate(req, res) {
  const { id, ...fields } = req.body || {};
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ success: false, error: 'id is required' });
  }
  try {
    const data = await updatePackage(id, fields);
    return res.json({ success: true, ...data });
  } catch (err) {
    return sendError(res, err, 'catalog.update');
  }
}

/** Archive-if-assignments-else-hard-delete. Both catalog.archive and catalog.delete map here. */
export async function catalogDelete(req, res) {
  const { id } = req.body || {};
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ success: false, error: 'id is required' });
  }
  try {
    const data = await deletePackage(id);
    return res.json({ success: true, ...data });
  } catch (err) {
    return sendError(res, err, 'catalog.delete');
  }
}

// ── Assignments ─────────────────────────────────────────────────────────────

export async function assignmentsList(req, res) {
  const { agentMktrUserId } = req.body || {};
  if (!agentMktrUserId || typeof agentMktrUserId !== 'string') {
    return res.status(400).json({ success: false, error: 'agentMktrUserId is required' });
  }
  try {
    const data = await getExternalAdminAgentAssignments(agentMktrUserId);
    return res.json({ success: true, ...data });
  } catch (err) {
    return sendError(res, err, 'assignment.list');
  }
}

export async function assignmentsAssign(req, res) {
  const { agentMktrUserId, packageId, leadsTotalOverride } = req.body || {};
  if (!agentMktrUserId || !packageId) {
    return res.status(400).json({ success: false, error: 'agentMktrUserId and packageId are required' });
  }
  try {
    const result = await assignPackageExternal({ agentMktrUserId, packageId, leadsTotalOverride });
    const codeByStatus = { assigned: 201, exists: 200, package_inactive: 409, invalid_agent: 400 };
    const code = codeByStatus[result.status] || 500;
    return res.status(code).json({ success: code < 400, ...result });
  } catch (err) {
    return sendError(res, err, 'assignment.assign');
  }
}

export async function assignmentsTopup(req, res) {
  const { assignmentId, addLeads, setRemaining } = req.body || {};
  if (!assignmentId) {
    return res.status(400).json({ success: false, error: 'assignmentId is required' });
  }
  if (addLeads === undefined && setRemaining === undefined) {
    return res.status(400).json({ success: false, error: 'addLeads or setRemaining is required' });
  }
  try {
    const data = await topUpAssignment({ assignmentId, addLeads, setRemaining });
    return res.json({ success: true, ...data });
  } catch (err) {
    return sendError(res, err, 'assignment.topup');
  }
}

export async function assignmentsCancel(req, res) {
  const { assignmentId } = req.body || {};
  if (!assignmentId) {
    return res.status(400).json({ success: false, error: 'assignmentId is required' });
  }
  try {
    const data = await cancelAssignment(assignmentId);
    return res.json({ success: true, ...data });
  } catch (err) {
    return sendError(res, err, 'assignment.cancel');
  }
}

export async function assignmentsRemove(req, res) {
  const { assignmentId } = req.body || {};
  if (!assignmentId) {
    return res.status(400).json({ success: false, error: 'assignmentId is required' });
  }
  try {
    const data = await removeAssignmentExternal(assignmentId);
    return res.json({ success: true, ...data });
  } catch (err) {
    return sendError(res, err, 'assignment.remove');
  }
}

// ── Campaigns ─────────────────────────────────────────────────────────────────

export async function campaignsList(req, res) {
  const { selectedId } = req.body || {};
  try {
    const data = await listCampaignsForPicker(typeof selectedId === 'string' ? selectedId : null);
    return res.json({ success: true, ...data });
  } catch (err) {
    return sendError(res, err, 'campaigns.list');
  }
}
