/**
 * @file syncHealth — runtime snapshot of last-sync state per adapter.
 *
 * Surfaced by `GET /health/sync`. Used by:
 *   - Uptime monitors / Render alert rules
 *   - Sentry stale-sync alert (P0.4) once cron heartbeat is wired
 *   - Operational debugging
 *
 * Phase 2: returns last in-process run only. Phase 3 will persist a
 * `sync_runs` table and read from there for cross-restart durability.
 */

import { adapterRegistry } from '../integrations/AdapterRegistry.js';

const lastRuns = new Map(); // adapterId -> { startedAt, durationMs, status, ... }

/**
 * Record a completed sync run. Called by syncAgentsFromLyfe on completion.
 *
 * @param {string} adapterId
 * @param {object} info  { startedAt, durationMs, status, counts }
 */
export function recordSyncRun(adapterId, info) {
  lastRuns.set(adapterId, { ...info, recordedAt: new Date().toISOString() });
}

/**
 * Snapshot all adapters with their last-known sync state.
 * Adapters with no run record return `{ status: 'never_run' }`.
 *
 * @returns {Promise<object>}
 */
export async function getSyncHealthSnapshot() {
  const adapters = adapterRegistry.list();
  const now = Date.now();

  const adapterStates = adapters.map((adapter) => {
    const run = lastRuns.get(adapter.id);
    if (!run) {
      return { id: adapter.id, status: 'never_run' };
    }

    const ageMs = run.startedAt ? now - run.startedAt : null;
    const stale = ageMs != null && ageMs > 30 * 60 * 1000; // 30 min

    return {
      id: adapter.id,
      status: run.status,
      lastRun: {
        startedAt: run.startedAt ? new Date(run.startedAt).toISOString() : null,
        durationMs: run.durationMs ?? null,
        ageMs,
        stale,
      },
      counts: run.counts ?? null,
      error: run.error ?? null,
    };
  });

  const anyStale = adapterStates.some((a) => a.lastRun?.stale);
  const anyFailed = adapterStates.some((a) => a.status === 'failed');

  return {
    status: anyFailed ? 'failed' : anyStale ? 'stale' : 'ok',
    timestamp: new Date().toISOString(),
    adapters: adapterStates,
  };
}
