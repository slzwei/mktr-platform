const counters = new Map(); // label -> { count, errorCount }
const latencies = new Map(); // label -> array of ms (bounded)

const MAX_SAMPLES = 200;

export function recordObservation(label, latencyMs, statusCode) {
  const key = label || 'unknown';
  const c = counters.get(key) || { count: 0, errorCount: 0 };
  c.count += 1;
  if (statusCode >= 400) c.errorCount += 1;
  counters.set(key, c);

  const arr = latencies.get(key) || [];
  arr.push(Number(latencyMs) || 0);
  if (arr.length > MAX_SAMPLES) arr.shift();
  latencies.set(key, arr);
}

function p95(values) {
  if (!values || values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.floor(0.95 * (sorted.length - 1));
  return sorted[idx];
}

export function getMetricsSnapshot() {
  const snapshot = {};
  for (const [label, meta] of counters.entries()) {
    const arr = latencies.get(label) || [];
    snapshot[label] = {
      count: meta.count,
      error_count: meta.errorCount,
      p95_ms: p95(arr)
    };
  }
  return snapshot;
}


