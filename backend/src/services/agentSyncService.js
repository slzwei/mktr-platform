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
 * @see docs/plans/AGENT_INTEGRATION_PLAN.md for the multi-phase plan.
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

// Every external-provenance column on `users`. One source per user is enforced
// by a DB CHECK (lyfeId IS NULL OR mktrLeadsId IS NULL); the sync reads BOTH so
// it can detect a phone/email match that would cross sources and skip it.
const PROVENANCE_FIELDS = ['lyfeId', 'mktrLeadsId'];

// Single shared advisory lock across ALL agent syncs (Lyfe + mktr-leads). Both
// mutate the same `users` table and the cross-source conflict check reads rows
// owned by the other source, so the two syncs must never run concurrently — a
// shared key (not per-adapter) serialises them. Stable across sessions, per-DB.
const ADVISORY_LOCK_KEY = 'agent_sync';

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

/**
 * One-source-per-user guard (pure). Given a local `users` row matched during a
 * sync, return the name of a CONFLICTING provenance column — the other source's
 * id is already set, so attaching this source's id would violate the
 * single-provenance CHECK and create an ambiguous dual-source row — or null if
 * the row is safe to attach.
 *
 * An externalId match is same-source and always safe (null). Only a phone/email
 * match onto a row owned by a different source is a conflict.
 *
 * @param {object|null} existing               matched local user row
 * @param {boolean}     matchedByExternalId     true if matched via this source's id
 * @param {string[]}    otherProvenanceFields   provenance columns of OTHER sources
 * @returns {string|null} conflicting field name, or null if safe to attach
 */
export function provenanceConflictField(existing, matchedByExternalId, otherProvenanceFields) {
  if (!existing || matchedByExternalId) return null;
  return otherProvenanceFields.find((f) => existing[f]) || null;
}

/** Split a display name into firstName/lastName the way the create path does. */
function splitFullName(fullName) {
  const nameParts = (fullName || '').trim().split(/\s+/);
  return {
    firstName: nameParts[0] || null,
    lastName: nameParts.slice(1).join(' ') || null,
  };
}

/**
 * Compute the update payload for one matched (existing local row, upstream
 * agent) pair — pure, so the per-adapter semantics are unit-testable without a
 * DB. Two adapter flags branch the behaviour:
 *
 *   authoritativeProfile — upstream OWNS profile fields: overwrite fullName
 *     (+ re-derived firstName/lastName), email, and companyName←agency when
 *     they differ. Never null-out email (upstream null ≠ "clear it"). Legacy
 *     (Lyfe) keeps fill-only-when-null + @placeholder.local replacement.
 *
 *   mirrorsIsActive — upstream rows carry a meaningful isActive: mirror flips
 *     both ways (deactivate AND reactivate). Legacy adapters fetch active-only
 *     rosters, so absence — handled by the deactivation phase — is their only
 *     inactive signal.
 *
 * Phone is fill-only for everyone: it's a matching key and unique locally.
 * pending_deletion_at clears whenever the agent is present upstream at all.
 */
export function computeSyncUpdate({ adapter, existing, ea, normalizedPhone }) {
  const authoritative = adapter.authoritativeProfile === true;
  const updateData = {};

  if (ea.externalId && !existing[adapter.localIdField]) {
    updateData[adapter.localIdField] = String(ea.externalId);
  }

  if (ea.fullName && (authoritative ? existing.fullName !== ea.fullName : !existing.fullName)) {
    updateData.fullName = ea.fullName;
    if (authoritative) {
      const { firstName, lastName } = splitFullName(ea.fullName);
      updateData.firstName = firstName;
      updateData.lastName = lastName;
    }
  }

  // Backfill upstream role onto pre-Phase-2 rows (external_role was null
  // before migration 025). Once set, sync keeps it in sync if upstream
  // changes role.
  if (ea.externalRole && existing.external_role !== ea.externalRole) {
    updateData.external_role = ea.externalRole;
  }

  // Legacy: fill when null or replace synthetic @placeholder.local emails.
  // Authoritative: overwrite on any difference (but never null-out).
  if (
    ea.email &&
    (authoritative
      ? existing.email !== ea.email
      : !existing.email || existing.email.endsWith('@placeholder.local'))
  ) {
    updateData.email = ea.email;
  }

  if (ea.phone && !existing.phone) {
    updateData.phone = normalizedPhone;
  }

  // agency → companyName. Sync-owned for authoritative rows, so mirroring a
  // cleared upstream agency (null) is intentional.
  if (authoritative && ea.agency !== undefined && (ea.agency || null) !== (existing.companyName || null)) {
    updateData.companyName = ea.agency || null;
  }

  if (adapter.mirrorsIsActive === true && typeof ea.isActive === 'boolean' && existing.isActive !== ea.isActive) {
    updateData.isActive = ea.isActive;
  }

  // Present upstream (in any state) → cancel a pending deletion.
  if (existing.pending_deletion_at) {
    updateData.pending_deletion_at = null;
  }

  return updateData;
}

// ─── Sync orchestrator ─────────────────────────────────────────────────────

/**
 * Run one adapter's sync under the shared advisory lock.
 *
 * ─── Concurrency guard (FMEA F08) ────────────────────────────────────
 * Prevents two orchestrator runs from racing — e.g. the Lyfe cron firing while
 * the mktr-leads cron (or a manual /api/.../agents/sync request) is in flight.
 * The hashtext-based key is stable across sessions, scoped per-DB, and SHARED
 * across all sources so the two syncs never mutate `users` concurrently.
 * Returns cleanly with `locked:false` if another session holds it, so a
 * cron-triggered run doesn't spam errors during manual ops.
 *
 * The lock is held for the lifetime of a TRANSACTION (`pg_try_advisory_xact_lock`)
 * so it is bound to a single connection and auto-released on commit/rollback.
 * The previous session-level `pg_advisory_lock` + manual `pg_advisory_unlock`
 * leaked under Sequelize's connection pool: the unlock frequently ran on a
 * DIFFERENT pooled connection than the acquire, so it was a no-op and the lock
 * stayed held. That made the mktr-leads sync skip with `lock_held` when it ran
 * right after the Lyfe sync on the same cron tick. runSync's own reads/writes
 * use pool connections (committed independently); lockTx exists only to hold the
 * lock for the duration.
 *
 * `options.wait = true` switches from try-lock (skip when held — right for the
 * cron, where the next tick retries) to a BLOCKING `pg_advisory_xact_lock`
 * bounded by lock_timeout. Management actions use this: after writing to the
 * source app they re-sync to refresh the local mirror, and a silent skip there
 * would leave the dashboard stale for up to 10 minutes. On timeout Postgres
 * aborts the wait (SQLSTATE 55P03) and the error propagates to the caller.
 *
 * @returns {Promise<{ created: number, updated: number, deactivated: number, hardDeleted: number, skipped: number, total: number, locked?: boolean }>}
 */
async function syncWithLock(adapterId, { wait = false } = {}) {
  const adapter = adapterRegistry.get(adapterId);
  const localIdField = adapter.localIdField;
  const startedAt = Date.now();

  return await sequelize.transaction(async (lockTx) => {
    if (wait) {
      await sequelize.query(`SET LOCAL lock_timeout = '15s'`, { transaction: lockTx });
      await sequelize.query(
        `SELECT pg_advisory_xact_lock(hashtext(:key))`,
        { replacements: { key: ADVISORY_LOCK_KEY }, transaction: lockTx }
      );
    } else {
      const [{ locked }] = await sequelize.query(
        `SELECT pg_try_advisory_xact_lock(hashtext(:key)) AS locked`,
        { replacements: { key: ADVISORY_LOCK_KEY }, type: sequelize.QueryTypes.SELECT, transaction: lockTx }
      );
      if (!locked) {
        logger.info(
          { event: 'agent_sync_skipped', adapter: adapter.id, reason: 'lock_held' },
          '[AgentSync] another sync run is in progress — skipping'
        );
        return { created: 0, updated: 0, deactivated: 0, hardDeleted: 0, skipped: 0, total: 0, locked: false };
      }
    }

    // Lock auto-releases when this transaction commits (or rolls back on throw).
    return await runSync(adapter, localIdField, startedAt);
  });
}

/**
 * Sync agents from Lyfe into the local User table.
 *
 * Find-or-creates local users (matched by lyfeId → phone → email),
 * updates stale records, deactivates agents no longer present upstream.
 *
 * @returns {Promise<{ created: number, updated: number, deactivated: number, skipped: number, total: number }>}
 */
export async function syncAgentsFromLyfe(options = {}) {
  return syncWithLock('lyfe', options);
}

/**
 * Sync agents from mktr-leads into the local User table — same contract as
 * {@link syncAgentsFromLyfe}, keyed on `mktrLeadsId`. Shares the advisory lock
 * so it never races the Lyfe sync. A phone/email match onto a Lyfe-owned row is
 * SKIPPED (one source per user), never merged. Throws if the mktr-leads env is
 * not configured (the client raises a 500) — callers env-gate before invoking.
 *
 * @returns {Promise<{ created: number, updated: number, deactivated: number, skipped: number, total: number }>}
 */
export async function syncAgentsFromMktrLeads(options = {}) {
  return syncWithLock('mktr_leads', options);
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
      attributes: [
        // Both provenance fields (not just localIdField) so the loop can detect
        // a phone/email match that would cross sources and skip it.
        'id', ...PROVENANCE_FIELDS, 'phone', 'email', 'firstName', 'lastName',
        'fullName', 'companyName', 'isActive', 'external_role', 'pending_deletion_at',
      ],
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

  // byExternalId keys on THIS source's id only, so an externalId match is
  // always same-source and safe to merge. The other source's column(s) are the
  // ones a phone/email match must not collide with.
  const byExternalId = new Map(
    allAgents.filter((a) => a[localIdField]).map((a) => [a[localIdField], a])
  );
  const byPhone = new Map(allAgents.filter((a) => a.phone).map((a) => [a.phone, a]));
  const byEmail = new Map(allAgents.filter((a) => a.email).map((a) => [a.email.toLowerCase(), a]));
  const otherProvenanceFields = PROVENANCE_FIELDS.filter((f) => f !== localIdField);

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const ea of externalAgents) {
    if (!ea.phone && !ea.email) {
      skipped++;
      continue;
    }

    const normalizedPhone = ea.phone ? String(ea.phone).replace(/\D/g, '') : null;
    const externalIdMatch = ea.externalId ? byExternalId.get(String(ea.externalId)) : null;
    const phoneEmailMatch =
      (normalizedPhone ? byPhone.get(normalizedPhone) : null) ||
      (ea.email ? byEmail.get(ea.email.toLowerCase()) : null);
    let existing = externalIdMatch || phoneEmailMatch;

    // One-source-per-user (Codex review): a phone/email match that lands on a
    // row already owned by a DIFFERENT external source must NOT be merged — it
    // would violate the single-provenance CHECK and create an ambiguous
    // dual-source row that each sync could then fight over (cross-source
    // deactivation). An externalId match is same-source and exempt. Skip +
    // structured-alert so the collision is visible without blocking the run.
    const conflictingField = provenanceConflictField(existing, Boolean(externalIdMatch), otherProvenanceFields);
    if (conflictingField) {
      skipped++;
      logger.warn(
        {
          event: 'agent_sync_provenance_conflict',
          adapter: adapter.id,
          localIdField,
          conflictingField,
          matchedUserId: existing.id,
        },
        `[AgentSync] upstream agent's phone/email matches a ${conflictingField}-owned user — skipping to preserve one-source-per-user`
      );
      Sentry.captureMessage('agent_sync_provenance_conflict', {
        level: 'warning',
        tags: { component: 'agent_sync', adapter: adapter.id },
        extra: { conflictingField, matchedUserId: existing.id, localIdField },
      });
      continue;
    }

    try {
      if (existing) {
        // Per-adapter fill-vs-overwrite + is_active mirroring semantics live in
        // the pure helper (see its doc block).
        const updateData = computeSyncUpdate({ adapter, existing, ea, normalizedPhone });

        if (Object.keys(updateData).length > 0) {
          await existing.update(updateData);
          updated++;
        } else {
          skipped++;
        }
      } else {
        const { firstName, lastName } = splitFullName(ea.fullName);

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
          companyName: adapter.authoritativeProfile === true ? ea.agency || null : null,
          // Mirroring adapters list inactive rows too — honour their state.
          // Legacy adapters send active-only rosters, so created = active.
          isActive: adapter.mirrorsIsActive === true ? ea.isActive !== false : true,
          emailVerified: false,
          approvalStatus: 'approved',
        });
        created++;
      }
    } catch (err) {
      // One bad row (e.g. a unique-constraint collision on an authoritative
      // email overwrite) must not abort the rest of the run.
      skipped++;
      logger.error(
        { event: 'agent_sync_row_failed', adapter: adapter.id, externalId: ea.externalId, err },
        '[AgentSync] row upsert failed — skipping'
      );
    }
  }

  // ─── Two-phase delete-aware deactivation (FMEA F09) ────────────────────
  // Keyed on ABSENCE from the fetched upstream set. What absence means is
  // adapter-dependent:
  //   - legacy active-only adapters (Lyfe): the set is the ACTIVE roster, so a
  //     deactivated upstream agent is "absent" → deactivated (and eventually
  //     deleted) locally. Their only inactive signal is absence.
  //   - mirrorsIsActive adapters (mktr-leads): the set contains active AND
  //     inactive rows — is_active flips are mirrored row-wise in the upsert
  //     loop above, and only truly-gone rows (account deleted, role promoted
  //     to admin) reach this block. A merely-deactivated agent is present
  //     upstream, so it is never pending-deleted — protecting its CASCADE-
  //     linked lead_package_assignments from silent destruction.
  // Phase 1: deactivate agents missing upstream. If they have no attached
  // prospects, also mark pending_deletion_at = NOW().
  // Phase 2: agents whose pending_deletion_at is older than DELETE_GRACE_MS
  // AND still missing upstream AND still no prospects → hard DELETE.
  // Agents with attached prospects are NEVER hard-deleted; they remain
  // inactive forever to preserve lead-history FK integrity.
  const upstreamExternalIds = externalAgents.map((a) => String(a.externalId)).filter(Boolean);
  let deactivated = 0;
  let hardDeleted = 0;

  try {
    if (upstreamExternalIds.length > 0) {
      // 1. Bulk-deactivate currently-active agents missing from upstream.
      const [deactivatedCount] = await User.update(
        { isActive: false },
        {
          where: {
            role: 'agent',
            isActive: true,
            [localIdField]: { [Op.notIn]: upstreamExternalIds, [Op.ne]: null },
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
            AND "${localIdField}" NOT IN (:upstreamExternalIds)
            AND pending_deletion_at IS NULL
            AND id NOT IN (SELECT DISTINCT "assignedAgentId" FROM prospects WHERE "assignedAgentId" IS NOT NULL)
            AND id NOT IN (SELECT DISTINCT "agentId" FROM wallet_ledger)`,
        { replacements: { upstreamExternalIds } }
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
               AND "${localIdField}" NOT IN (:upstreamExternalIds)
               AND pending_deletion_at IS NOT NULL
               AND pending_deletion_at < NOW() - INTERVAL '${DELETE_GRACE_HOURS} hours'
               AND id NOT IN (SELECT DISTINCT "assignedAgentId" FROM prospects WHERE "assignedAgentId" IS NOT NULL)
               AND id NOT IN (SELECT DISTINCT "agentId" FROM wallet_ledger)
            RETURNING id
         )
         SELECT COUNT(*)::int AS count FROM deleted`,
        { replacements: { upstreamExternalIds }, type: sequelize.QueryTypes.SELECT }
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
