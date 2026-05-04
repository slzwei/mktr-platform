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
import { logger } from '../utils/logger.js';
import { adapterRegistry } from '../integrations/AdapterRegistry.js';
// Side-effect import: triggers LyfeAdapter self-registration. Without this
// the registry is empty at first call and `adapterRegistry.get('lyfe')` throws.
import '../integrations/index.js';

// Threshold above which a sync run is treated as suspicious (likely upstream
// data wipe or misconfiguration). Triggers a Sentry warning, does not block.
// Tuned to ~20% per FMEA F12.
const SYNC_DRIFT_DEACTIVATION_RATIO = 0.2;

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
      if (ea.email && (!existing.email || existing.email.endsWith('@placeholder.local'))) {
        updateData.email = ea.email;
      }
      if (ea.phone && !existing.phone) {
        updateData.phone = normalizedPhone;
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
        email: ea.email || `lyfe_${ea.externalId || normalizedPhone}@placeholder.local`,
        firstName,
        lastName,
        fullName: ea.fullName || null,
        phone: normalizedPhone,
        role: 'agent',
        isActive: true,
        emailVerified: false,
        approvalStatus: 'approved',
      });
      created++;
    }
  }

  // Deactivate local agents whose external id is no longer in the upstream set.
  const activeExternalIds = externalAgents.map((a) => String(a.externalId)).filter(Boolean);
  let deactivated = 0;

  try {
    if (activeExternalIds.length > 0) {
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
    throw err;
  }

  const result = { created, updated, deactivated, skipped, total: externalAgents.length };
  const durationMs = Date.now() - startedAt;

  // Successful sync — emit structured log for observability dashboards.
  // Field shape (event + last_sync_at + counts) is the contract relied on by
  // any downstream alert configured to track sync freshness.
  logger.info(
    { event: 'agent_sync_complete', adapter: adapter.id, last_sync_at: Date.now(), durationMs, ...result },
    `[AgentSync] complete in ${durationMs}ms: ${created} created, ${updated} updated, ${deactivated} deactivated, ${skipped} skipped`
  );

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
