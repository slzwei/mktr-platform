const counters = new Map();

function getSampleRate() {
  const v = parseFloat(process.env.OBS_SAMPLE_RATE || '0');
  if (Number.isNaN(v) || v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

export function incCounter(name, value = 1) {
  const cur = counters.get(name) || 0;
  counters.set(name, cur + value);
}

export function timeMs(start) {
  return Date.now() - start;
}

export function logEvent(name, data = {}) {
  const rate = getSampleRate();
  if (rate <= 0 || Math.random() > rate) return;
  const payload = { ts: new Date().toISOString(), event: name, ...data };
  try {
    console.log(JSON.stringify(payload));
  } catch (_) {
    // ignore
  }
}

export function getCountersSnapshot() {
  const obj = {};
  for (const [k, v] of counters.entries()) obj[k] = v;
  return obj;
}


