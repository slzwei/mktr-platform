/**
 * @file agentSyncService — platform-agnostic agent sync orchestrator.
 *
 * Phase 1 refactor (2026-05-04): all Lyfe-specific REST, env vars, breaker
 * state, and caching moved behind PlatformAdapter / AdapterRegistry. This
 * file now contains:
 *
 *   - Per-platform sync loop (User upsert, deactivation, drift detection)
 *   - Observability (structured logs, Sentry capture)
 *   - Backwards-compatible re-exports for legacy callers
 *
 * The local `users.lyfeId` column is intentionally retained — Phase 3 will
 * introduce a generic `external_agents` table and `(platform_id, external_id)`
 * pair.
 *
 * @see ../integrations/PlatformAdapter.js for the contract.
 * @see AGENT_INTEGRATION_PLAN.md for the multi-phase plan.
 */

import { Op } from 'sequelize';
import * as Sentry from '@sentry/node';
import User from '../models/User.js';
import { sequelize } from '../database/connection.js';
import { logger } from '../utils/logger.js';
import { adapterRegistry } from '../integrations/AdapterRegistry.js';
import { recordSyncRun } from './syncHealth.js';
// Side-effect import: triggers LyfeAdapter self-registration. Without this
// the registry is empty at first call and `adapterRegistry.get('lyfe')` throws.
import '../integrations/index.js';

// Threshold above which a sync run is treated as suspicious (likely upstream
// data wipe or misconfiguration). Triggers a Sentry warning, does not block.
// Tuned to ~20% per FMEA F12.
const SYNC_DRIFT_DEACTIVATION_RATIO = 0.2;

// Grace window between marking an orphaned agent for deletion and actually
// dropping the row. 24h gives enough time to recover from accidental upstream
// wipes (a subsequent sync clears pending_deletion_at if the agent reappears).
// Per FMEA F09 — closes the read-then-delete race.
const DELETE_GRACE_HOURS = 24;

// ─── Backwards-compat exports ──────────────────────────────────────────────
// Existing callers (lyfeAgentController, prospectService, etc.) import these
// names directly. Keep them working as thin shims to the Lyfe adapter so we
// can change call sites incrementally instead of in one giant PR.

/** @deprecated Use adapterRegistry.get('lyfe').listAgents() directly. */
export async function fetchAgents(filters = {}) {
  const agents = await adapterRegistry.get('lyfe').listAgents(filters);
  return agents.map(toLegacyShape);
}

/** @deprecated Use adapterRegistry.get('lyfe').getAgent(id) directly. */
export async function fetchAgentById(id) {
  const agent = await adapterRegistry.get('lyfe').getAgent(id);
  return toLegacyShape(agent);
}

/** @deprecated Returns []; agent groups are not used in the current Lyfe model. */
export async function fetchAgentGroups() {
  return [];
}

/** @deprecated Use adapterRegistry.get('lyfe').invalidateCache() directly. */
export function invalidateCache() {
  const adapter = adapterRegistry.get('lyfe');
  if (typeof adapter.invalidateCache === 'function') adapter.invalidateCache();
}

/**
 * Pre-Phase-1 callers expected `{ id, name, email, phone, role, avatarUrl,
 * dateOfBirth, createdAt }`. Keep that shape until each call site is migrated
 * to the platform-agnostic ExternalAgent shape.
 */
function toLegacyShape(externalAgent) {
  return {
    id: externalAgent.externalId,
    name: externalAgent.fullName,
    email: externalAgent.email,
    phone: externalAgent.phone,
    role: externalAgent.externalRole,
    avatarUrl: externalAgent.avatarUrl,
    dateOfBirth: externalAgent.dateOfBirth,
    createdAt: externalAgent.createdAt,
  };
}

// ─── Sync orchestrator ─────────────────────────────────────────────────────

/**
 * Sync agents from Lyfe into the local User table.
 *
 * Find-or-creates local users (matched by lyfeId → phone → email),
 * updates stale records, deactivates agents no longer present upstream.
 *
 * Phase 1: hard-coded to the 'lyfe' adapter. Phase 3 generalises this to
 * iterate over `adapterRegistry.list()` once a platform_id column exists
 * on `users` to disambiguate origin.
 *
 * @returns {Promise<{ created: number, updated: number, deactivated: number, skipped: number, total: number }>}
 */
export async function syncAgentsFromLyfe() {
  const adapter = adapterRegistry.get('lyfe');
  const localIdField = adapter.localIdField;
  const startedAt = Date.now();

  // ─── Concurrency guard (FMEA F08) ────────────────────────────────────
  // Prevents two orchestrator runs from racing — e.g., the periodic cron
  // firing while a manual /api/lyfe/agents/sync request is in flight. The
  // hashtext-based key is stable across sessions, scoped per-DB.
  // Returns false if another session holds the lock; we exit cleanly and
  // log so the cron-triggered run doesn't spam errors during manual ops.
  const ADVISORY_LOCK_KEY = 'agent_sync';
  const [{ locked }] = await sequelize.query(
    `SELECT pg_try_advisory_lock(hashtext(:key)) AS locked`,
    { replacements: { key: ADVISORY_LOCK_KEY }, type: sequelize.QueryTypes.SELECT }
  );
  if (!locked) {
    logger.info(
      { event: 'agent_sync_skipped', adapter: adapter.id, reason: 'lock_held' },
      '[AgentSync] another sync run is in progress — skipping'
    );
    return { created: 0, updated: 0, deactivated: 0, hardDeleted: 0, skipped: 0, total: 0, locked: false };
  }

  try {
    return await runSync(adapter, localIdField, startedAt);
  } finally {
    // Always release the advisory lock, even if runSync throws.
    await sequelize.query(
      `SELECT pg_advisory_unlock(hashtext(:key))`,
      { replacements: { key: ADVISORY_LOCK_KEY } }
    ).catch((err) => {
      logger.warn({ err, lockKey: ADVISORY_LOCK_KEY }, '[AgentSync] failed to release advisory lock');
    });
  }
}

/**
 * Inner sync — assumes the caller already holds the advisory lock.
 * Split from `syncAgentsFromLyfe` so the outer wrapper can guarantee
 * lock release via try/finally without indenting 200 lines.
 */
async function runSync(adapter, localIdField, startedAt) {
  let externalAgents;
  let allAgents;
  try {
    if (typeof adapter.invalidateCache === 'function') adapter.invalidateCache();
    externalAgents = await adapter.listAgents();

    // Pre-fetch all local agents into maps for O(1) lookups instead of
    // per-agent findOne queries.
    allAgents = await User.findAll({
      where: { role: 'agent' },
      attributes: ['id', localIdField, 'phone', 'email', 'firstName', 'lastName', 'fullName', 'isActive'],
    });
  } catch (err) {
    logger.error({ event: 'agent_sync_failed', stage: 'fetch', err }, '[AgentSync] failed before sync loop');
    Sentry.captureMessage('agent_sync_failed', {
      level: 'error',
      tags: { component: 'agent_sync', adapter: adapter.id, stage: 'fetch' },
      extra: { error: err?.message, durationMs: Date.now() - startedAt },
    });
    recordSyncRun(adapter.id, { startedAt, durationMs: Date.now() - startedAt, status: 'failed', error: err?.message, stage: 'fetch' });
    throw err;
  }

  const byExternalId = new Map(
    allAgents.filter((a) => a[localIdField]).map((a) => [a[localIdField], a])
  );
  const byPhone = new Map(allAgents.filter((a) => a.phone).map((a) => [a.phone, a]));
  const byEmail = new Map(allAgents.filter((a) => a.email).map((a) => [a.email.toLowerCase(), a]));

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const ea of externalAgents) {
    if (!ea.phone && !ea.email) {
      skipped++;
      continue;
    }

    const normalizedPhone = ea.phone ? String(ea.phone).replace(/\D/g, '') : null;
    let existing =
      (ea.externalId ? byExternalId.get(String(ea.externalId)) : null) ||
      (normalizedPhone ? byPhone.get(normalizedPhone) : null) ||
      (ea.email ? byEmail.get(ea.email.toLowerCase()) : null);

    if (existing) {
      const updateData = {};
      if (ea.externalId && !existing[localIdField]) updateData[localIdField] = String(ea.externalId);
      if (ea.fullName && !existing.fullName) updateData.fullName = ea.fullName;
      // Backfill upstream role onto pre-Phase-2 rows (external_role was
      // null before migration 025). Once set, sync keeps it in sync if
      // upstream changes role.
      if (ea.externalRole && existing.external_role !== ea.externalRole) {
        updateData.external_role = ea.externalRole;
      }
      // Replace synthetic @placeholder.local emails (legacy from pre-Phase-2)
      // when upstream now provides a real one. Don't overwrite a real email.
      if (ea.email && (!existing.email || existing.email.endsWith('@placeholder.local'))) {
        updateData.email = ea.email;
      }
      if (ea.phone && !existing.phone) {
        updateData.phone = normalizedPhone;
      }
      // If the agent had been marked for deletion and is back in the
      // upstream set, clear the timer.
      if (existing.pending_deletion_at) {
        updateData.pending_deletion_at = null;
      }

      if (Object.keys(updateData).length > 0) {
        await existing.update(updateData);
        updated++;
      } else {
        skipped++;
      }
    } else {
      const nameParts = (ea.fullName || '').trim().split(/\s+/);
      const firstName = nameParts[0] || null;
      const lastName = nameParts.slice(1).join(' ') || null;

      await User.create({
        [localIdField]: ea.externalId ? String(ea.externalId) : null,
        // Post-migration 025 email is nullable. Don't fabricate
        // @placeholder.local — leave NULL so downstream UIs render '(no
        // email)' instead of a synthetic value that looks real.
        email: ea.email || null,
        firstName,
        lastName,
        fullName: ea.fullName || null,
        phone: normalizedPhone,
        role: 'agent',
        external_role: ea.externalRole || null,
        isActive: true,
        emailVerified: false,
        approvalStatus: 'approved',
      });
      created++;
    }
  }

  // ─── Two-phase delete-aware deactivation (FMEA F09) ────────────────────
  // Phase 1: deactivate agents missing upstream. If they have no attached
  // prospects, also mark pending_deletion_at = NOW().
  // Phase 2: agents whose pending_deletion_at is older than DELETE_GRACE_MS
  // AND still missing upstream AND still no prospects → hard DELETE.
  // Agents with attached prospects are NEVER hard-deleted; they remain
  // inactive forever to preserve lead-history FK integrity.
  const activeExternalIds = externalAgents.map((a) => String(a.externalId)).filter(Boolean);
  let deactivated = 0;
  let hardDeleted = 0;

  try {
    if (activeExternalIds.length > 0) {
      // 1. Bulk-deactivate currently-active agents missing from upstream.
      const [deactivatedCount] = await User.update(
        { isActive: false },
        {
          where: {
            role: 'agent',
            isActive: true,
            [localIdField]: { [Op.notIn]: activeExternalIds, [Op.ne]: null },
          },
        }
      );
      deactivated = deactivatedCount;

      // 2. Mark fresh orphans (no prospects) for deletion. Use raw SQL
      //    for the prospect-attachment check to avoid loading every row.
      await sequelize.query(
        `UPDATE users
            SET pending_deletion_at = NOW()
          WHERE role = 'agent'
            AND "isActive" = false
            AND "${localIdField}" IS NOT NULL
            AND "${localIdField}" NOT IN (:activeExternalIds)
            AND pending_deletion_at IS NULL
            AND id NOT IN (SELECT DISTINCT "assignedAgentId" FROM prospects WHERE "assignedAgentId" IS NOT NULL)`,
        { replacements: { activeExternalIds } }
      );

      // 3. Hard-delete agents whose grace window expired AND still no
      //    prospects (re-check at delete time to close the read-then-delete
      //    race).
      const [{ count: deletedCount }] = await sequelize.query(
        `WITH deleted AS (
            DELETE FROM users
             WHERE role = 'agent'
               AND "isActive" = false
               AND "${localIdField}" IS NOT NULL
               AND "${localIdField}" NOT IN (:activeExternalIds)
               AND pending_deletion_at IS NOT NULL
               AND pending_deletion_at < NOW() - INTERVAL '${DELETE_GRACE_HOURS} hours'
               AND id NOT IN (SELECT DISTINCT "assignedAgentId" FROM prospects WHERE "assignedAgentId" IS NOT NULL)
            RETURNING id
         )
         SELECT COUNT(*)::int AS count FROM deleted`,
        { replacements: { activeExternalIds }, type: sequelize.QueryTypes.SELECT }
      );
      hardDeleted = deletedCount || 0;
    }
  } catch (err) {
    logger.error(
      { event: 'agent_sync_failed', stage: 'deactivate', err },
      '[AgentSync] failed during deactivation'
    );
    Sentry.captureMessage('agent_sync_failed', {
      level: 'error',
      tags: { component: 'agent_sync', adapter: adapter.id, stage: 'deactivate' },
      extra: { error: err?.message, created, updated, durationMs: Date.now() - startedAt },
    });
    recordSyncRun(adapter.id, { startedAt, durationMs: Date.now() - startedAt, status: 'failed', error: err?.message, stage: 'deactivate' });
    throw err;
  }

  const result = { created, updated, deactivated, hardDeleted, skipped, total: externalAgents.length };
  const durationMs = Date.now() - startedAt;

  // Successful sync — emit structured log for observability dashboards.
  // Field shape (event + last_sync_at + counts) is the contract relied on by
  // any downstream alert configured to track sync freshness.
  logger.info(
    { event: 'agent_sync_complete', adapter: adapter.id, last_sync_at: Date.now(), durationMs, ...result },
    `[AgentSync] complete in ${durationMs}ms: ${created} created, ${updated} updated, ${deactivated} deactivated, ${hardDeleted} hard-deleted, ${skipped} skipped`
  );
  recordSyncRun(adapter.id, { startedAt, durationMs, status: 'ok', counts: result });

  // Drift detection (FMEA F12): if a single sync run deactivates a large
  // proportion of agents, something is wrong upstream (mass-wipe, schema
  // change, env-var rotation pointing at wrong project). Warn, don't block.
  const baseline = allAgents.filter((a) => a.isActive && a[localIdField]).length;
  if (baseline > 0 && deactivated / baseline > SYNC_DRIFT_DEACTIVATION_RATIO) {
    const ratio = (deactivated / baseline).toFixed(2);
    logger.warn(
      { event: 'agent_sync_drift_warning', adapter: adapter.id, deactivated, baseline, ratio },
      `[AgentSync] drift: ${deactivated}/${baseline} (${ratio}) agents deactivated this run`
    );
    Sentry.captureMessage('agent_sync_drift_warning', {
      level: 'warning',
      tags: { component: 'agent_sync', adapter: adapter.id },
      extra: { deactivated, baseline, ratio, ...result },
    });
  }

  return result;
}
