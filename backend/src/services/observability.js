/**
 * In-process metrics for the hot paths (P3-5).
 *
 * The backend has good structured logging and targeted Sentry, but until now
 * nothing counted anything. Several sweeps note conditions that are only
 * visible as an ABSENCE — "a starving rotation shows up as a persistent zero" —
 * and an absence cannot be grepped for. You cannot notice a log line that never
 * gets written. A counter sitting at zero, you can.
 *
 * This is deliberately a small in-process sink rather than a Prometheus client:
 * no new dependency, no scrape endpoint to secure, and it answers the question
 * the sweeps actually raise ("is this number still moving?"). Counters reset on
 * restart, which is the honest limitation — read them as "since this instance
 * came up", and compare snapshots rather than trusting an absolute total.
 *
 * READING THEM
 *
 *   GET /health/metrics  →  { uptimeSeconds, counters, durations }
 *
 * `counters` are monotonic totals; `durations` carry count / min / max / p50 /
 * p95 / total in milliseconds. Both use a flat label suffix
 * (`lead.held{reason=no_funded_agent}`) so a metric name stays one greppable
 * string.
 *
 * WHAT TO LOOK FOR
 *
 *   lead.captured stuck             capture is down, or traffic stopped
 *   lead.held{reason=…} climbing    while lead.delivered stays flat → the
 *                                   starving rotation: leads arrive and nothing
 *                                   routes. This is the zero the sweeps mean.
 *   webhook.delivery.failed rising  relative to .attempted → the receiver is
 *                                   unhealthy. webhook.delivery.duration p95
 *                                   usually climbs first.
 *   external.call.failed{dep=…}     an upstream (WhatsApp, Apify) is degraded
 *                                   before anyone files a ticket.
 */
import { logger } from '../utils/logger.js';

const counters = new Map();
/** name → { count, total, min, max, samples[] }. */
const durations = new Map();

/** Newest N samples per metric, so p50/p95 stay meaningful without growing
 *  without bound on a long-lived process. */
const MAX_SAMPLES = 512;

const startedAt = Date.now();

function getSampleRate() {
  const v = parseFloat(process.env.OBS_SAMPLE_RATE || '0');
  if (Number.isNaN(v) || v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

/**
 * `lead.held` + `{ reason: 'dnc_pending' }` → `lead.held{reason=dnc_pending}`.
 * Labels are sorted so the same set always yields the same key, and empty /
 * null values are dropped rather than becoming the string "undefined".
 */
export function metricKey(name, labels) {
  if (!labels) return name;
  const parts = Object.keys(labels)
    .sort()
    .filter((k) => labels[k] !== null && labels[k] !== undefined && labels[k] !== '')
    .map((k) => `${k}=${String(labels[k])}`);
  return parts.length ? `${name}{${parts.join(',')}}` : name;
}

export function incCounter(name, value = 1, labels = null) {
  const key = metricKey(name, labels);
  counters.set(key, (counters.get(key) || 0) + value);
}

export function timeMs(start) {
  return Date.now() - start;
}

/**
 * Record a latency sample in milliseconds. Silently ignores a nonsense value:
 * an observability call that can fail a request is worse than no observability.
 */
export function observeDuration(name, ms, labels = null) {
  if (!Number.isFinite(ms) || ms < 0) return;
  const key = metricKey(name, labels);
  let d = durations.get(key);
  if (!d) {
    d = { count: 0, total: 0, min: ms, max: ms, samples: [] };
    durations.set(key, d);
  }
  d.count += 1;
  d.total += ms;
  if (ms < d.min) d.min = ms;
  if (ms > d.max) d.max = ms;
  d.samples.push(ms);
  if (d.samples.length > MAX_SAMPLES) d.samples.shift();
}

/**
 * Time an async call, recording latency either way plus a `.failed` counter
 * when it throws. The error is always re-thrown — this measures, never swallows.
 */
export async function timed(name, fn, labels = null) {
  const start = Date.now();
  try {
    const out = await fn();
    observeDuration(name, timeMs(start), labels);
    return out;
  } catch (err) {
    observeDuration(name, timeMs(start), { ...(labels || {}), outcome: 'error' });
    incCounter(`${name}.failed`, 1, labels);
    throw err;
  }
}

export function logEvent(name, data = {}) {
  const rate = getSampleRate();
  if (rate <= 0 || Math.random() > rate) return;
  const payload = { ts: new Date().toISOString(), event: name, ...data };
  try {
    logger.info('observability event', payload);
  } catch (_) {
    // ignore
  }
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

export function getCountersSnapshot() {
  const obj = {};
  for (const [k, v] of counters.entries()) obj[k] = v;
  return obj;
}

export function getDurationsSnapshot() {
  const obj = {};
  for (const [k, d] of durations.entries()) {
    const sorted = [...d.samples].sort((a, b) => a - b);
    obj[k] = {
      count: d.count,
      totalMs: d.total,
      minMs: d.min,
      maxMs: d.max,
      p50Ms: percentile(sorted, 50),
      p95Ms: percentile(sorted, 95),
    };
  }
  return obj;
}

/** Everything GET /health/metrics serves. */
export function getMetricsSnapshot() {
  return {
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    counters: getCountersSnapshot(),
    durations: getDurationsSnapshot(),
  };
}

/** Tests only — the process itself never resets. */
export function resetMetrics() {
  counters.clear();
  durations.clear();
}
