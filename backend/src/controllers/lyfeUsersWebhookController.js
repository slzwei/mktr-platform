/**
 * @file lyfeUsersWebhookController — receives push notifications from Lyfe
 * Supabase when rows in `public.users` change (INSERT / UPDATE / DELETE).
 *
 * Closes the polling lag (up to 10 min) for agent activations and
 * deactivations. Polling stays as the safety net (FMEA F18) — push +
 * polling is the production-grade pattern.
 *
 * ── Wire format (sent by `notify_mktr_user_change` trigger in Lyfe) ────
 *
 *   POST /api/integrations/lyfe/users-webhook
 *   Content-Type: application/json
 *   X-Webhook-Signature: sha256=<hex hmac of raw body using LYFE_USERS_WEBHOOK_SECRET>
 *   X-Webhook-Timestamp: <ISO 8601 timestamp; rejected if ±5 min outside server clock>
 *   {
 *     "type": "INSERT" | "UPDATE" | "DELETE",
 *     "table": "users",
 *     "record":     { id, full_name, email, phone, role, is_active, is_test_data } | null,
 *     "old_record": { id, role, is_active, is_test_data } | null
 *   }
 *
 * For INSERT: record present, old_record null
 * For UPDATE: both present
 * For DELETE: record null, old_record present
 *
 * ── Auth (HMAC since 2026-05-12, audit Sprint 2.1) ─────────────────────
 *
 * The legacy `Authorization: Bearer <secret>` mode was removed because
 * (a) it provides no body integrity — a MITM could flip is_active values
 * without invalidating the token, (b) no replay protection, (c) the secret
 * appears in every successful request, increasing log-leakage surface.
 *
 * HMAC-SHA256 over the raw body matches the inverse direction
 * (MKTR→Lyfe via `receive-mktr-lead`) which was already hardened.
 *
 * ── Idempotency ────────────────────────────────────────────────────────
 *
 * Same event applied twice = same result. The receiver does row-level
 * UPSERT/UPDATE — if the trigger fires twice (network retry), nothing
 * breaks.
 *
 * ── Filtering ──────────────────────────────────────────────────────────
 *
 * Lyfe trigger pre-filters to role IN (agent, manager, director) AND
 * is_test_data = false. Receiver double-checks defensively in case the
 * trigger filter is loosened in the future.
 */

import crypto from 'crypto';
import * as Sentry from '@sentry/node';
import User from '../models/User.js';
import { logger } from '../utils/logger.js';
import { adapterRegistry } from '../integrations/AdapterRegistry.js';
import { recordSyncRun } from '../services/syncHealth.js';
import '../integrations/index.js';

const ASSIGNABLE_ROLES = new Set(['agent', 'manager', 'director']);
const TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000;

function unauthorized(res, reason) {
  logger.warn({ event: 'lyfe_users_webhook_unauthorized', reason }, '[lyfe-users-webhook] auth failed');
  return res.status(401).json({ success: false, error: 'Unauthorized' });
}

function badRequest(res, reason) {
  return res.status(400).json({ success: false, error: reason });
}

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
 * Apply a single Lyfe user change locally. Mirrors the per-row logic in
 * `agentSyncService.syncAgentsFromLyfe` so the two paths stay consistent
 * and idempotent (a webhook + a polling sync touching the same row both
 * arrive at the same final state).
 */
async function applyUpsert(adapter, lyfeUser) {
  const localIdField = adapter.localIdField;
  const externalId = String(lyfeUser.id);
  const fullName = lyfeUser.full_name || null;
  const externalRole = lyfeUser.role || null;
  const email = lyfeUser.email || null;
  const phone = lyfeUser.phone ? String(lyfeUser.phone).replace(/\D/g, '') : null;
  const isActive = lyfeUser.is_active !== false;

  const existing = await User.findOne({ where: { [localIdField]: externalId } });

  if (existing) {
    const updateData = {};
    if (fullName && fullName !== existing.fullName) updateData.fullName = fullName;
    if (externalRole && externalRole !== existing.external_role) updateData.external_role = externalRole;
    if (email && (!existing.email || existing.email.endsWith('@placeholder.local'))) {
      updateData.email = email;
    }
    if (phone && !existing.phone) updateData.phone = phone;
    if (existing.isActive !== isActive) updateData.isActive = isActive;
    // If they came back, clear the deletion timer.
    if (existing.pending_deletion_at && isActive) updateData.pending_deletion_at = null;

    if (Object.keys(updateData).length > 0) {
      await existing.update(updateData);
      return { action: 'updated', userId: existing.id };
    }
    return { action: 'unchanged', userId: existing.id };
  }

  const nameParts = (fullName || '').trim().split(/\s+/);
  const created = await User.create({
    [localIdField]: externalId,
    email,
    firstName: nameParts[0] || null,
    lastName: nameParts.slice(1).join(' ') || null,
    fullName,
    phone,
    role: 'agent',
    external_role: externalRole,
    isActive,
    emailVerified: false,
    approvalStatus: 'approved',
  });
  return { action: 'created', userId: created.id };
}

/**
 * Apply a delete. Two-phase: deactivate immediately, mark for deletion
 * if no prospects attached. Hard delete still happens via the periodic
 * sync's grace-window check — webhook never hard-deletes (defensive
 * against trigger replay or operator error in Lyfe).
 */
async function applyDelete(adapter, lyfeUser) {
  const localIdField = adapter.localIdField;
  const externalId = String(lyfeUser.id);

  const existing = await User.findOne({ where: { [localIdField]: externalId } });
  if (!existing) {
    return { action: 'noop_not_present', userId: null };
  }

  const updateData = { isActive: false };
  if (!existing.pending_deletion_at) updateData.pending_deletion_at = new Date();

  await existing.update(updateData);
  return { action: 'deactivated', userId: existing.id };
}

export async function handleLyfeUsersWebhook(req, res) {
  // ── Auth: HMAC-SHA256 of raw body + timestamp window ────────────────
  const secret = process.env.LYFE_USERS_WEBHOOK_SECRET;
  if (!secret) {
    logger.error('[lyfe-users-webhook] LYFE_USERS_WEBHOOK_SECRET not configured');
    return res.status(500).json({ success: false, error: 'Server misconfigured' });
  }

  // rawBody is captured by the verify hook in server_internal.js for paths
  // under /api/integrations/lyfe/. Without it we cannot compute the HMAC
  // over the exact bytes the trigger signed.
  if (!req.rawBody || !Buffer.isBuffer(req.rawBody)) {
    logger.error('[lyfe-users-webhook] req.rawBody missing — verify hook not wired for this path');
    return res.status(500).json({ success: false, error: 'Server misconfigured' });
  }

  const sigHeader = req.headers['x-webhook-signature'] || '';
  if (typeof sigHeader !== 'string' || !sigHeader.startsWith('sha256=')) {
    return unauthorized(res, 'missing_or_malformed_signature');
  }
  const receivedHex = sigHeader.slice(7);
  const expectedHex = crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex');
  if (!timingSafeHexEq(receivedHex, expectedHex)) {
    return unauthorized(res, 'bad_signature');
  }

  const tsHeader = req.headers['x-webhook-timestamp'];
  if (typeof tsHeader !== 'string' || !tsHeader) {
    return unauthorized(res, 'missing_timestamp');
  }
  const tsMs = Date.parse(tsHeader);
  if (Number.isNaN(tsMs)) {
    return unauthorized(res, 'invalid_timestamp');
  }
  if (Math.abs(Date.now() - tsMs) > TIMESTAMP_TOLERANCE_MS) {
    return unauthorized(res, 'timestamp_outside_window');
  }

  // ── Payload validation ─────────────────────────────────────────────
  const { type, table, record, old_record: oldRecord } = req.body || {};
  if (!type || !table) return badRequest(res, 'missing type or table');
  if (table !== 'users') return badRequest(res, 'unsupported table');
  if (!['INSERT', 'UPDATE', 'DELETE'].includes(type)) return badRequest(res, 'unsupported type');

  const subject = type === 'DELETE' ? oldRecord : record;
  if (!subject || !subject.id) return badRequest(res, 'missing record id');

  // Defensive double-filter: only mirror agent-class users, not test data.
  // The trigger should already enforce this, but if someone widens the
  // trigger filter we don't want to start mirroring candidates.
  if (!ASSIGNABLE_ROLES.has(subject.role)) {
    return res.status(200).json({ success: true, action: 'skipped_non_assignable_role', role: subject.role });
  }
  if (subject.is_test_data === true) {
    return res.status(200).json({ success: true, action: 'skipped_test_data' });
  }

  const startedAt = Date.now();
  const adapter = adapterRegistry.get('lyfe');

  try {
    let result;
    if (type === 'DELETE') {
      result = await applyDelete(adapter, subject);
    } else {
      result = await applyUpsert(adapter, subject);
    }

    logger.info(
      {
        event: 'lyfe_users_webhook_applied',
        type,
        externalId: subject.id,
        action: result.action,
        durationMs: Date.now() - startedAt,
      },
      `[lyfe-users-webhook] ${type} ${subject.id} → ${result.action}`
    );

    // Surface in /health/sync so operators can see push events too.
    recordSyncRun(`${adapter.id}-push`, {
      startedAt,
      durationMs: Date.now() - startedAt,
      status: 'ok',
      counts: { type, action: result.action, externalId: subject.id },
    });

    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    logger.error(
      { event: 'lyfe_users_webhook_failed', type, externalId: subject.id, err },
      '[lyfe-users-webhook] failed to apply change'
    );
    Sentry.captureException(err, {
      tags: { component: 'lyfe_users_webhook', service: 'mktr-backend' },
      extra: { type, externalId: subject.id },
    });
    return res.status(500).json({ success: false, error: err?.message || 'apply failed' });
  }
}
