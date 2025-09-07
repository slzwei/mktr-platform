import { randomUUID } from 'crypto';
import { recordObservation } from '../lib/metrics.js';

export function requestLogger() {
  return function requestLoggerMiddleware(req, res, next) {
    const start = Date.now();
    const requestId = req.headers['x-request-id'] || randomUUID();
    res.locals.request_id = requestId;
    res.setHeader('x-request-id', String(requestId));

    function finalize() {
      const latency = Date.now() - start;
      const tenantId = req.tenantId || req.headers['x-tenant-id'] || (req.user && req.user.tid) || null;
      const entry = {
        ts: new Date().toISOString(),
        service: 'leadgen',
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        tenant_id: tenantId,
        request_id: requestId,
        car_id: res.locals.car_id || null,
        driver_id: res.locals.driver_id || null,
        latency_ms: latency,
        outcome: res.statusCode < 400 ? 'success' : 'error'
      };
      try { console.log(JSON.stringify(entry)); } catch {}

      // metrics label is best-effort
      const label = res.locals.metric_label || `${req.method} ${req.baseUrl || ''}${(req.route && req.route.path) || ''}`.trim();
      recordObservation(label, latency, res.statusCode);
    }

    res.on('finish', finalize);
    res.on('close', finalize);
    next();
  };
}

export function respond(res, httpCode, payload) {
  const body = normalizeEnvelope(httpCode, payload);
  return res.status(httpCode).json(body);
}

function normalizeEnvelope(httpCode, { data = undefined, error = undefined, extra = {} } = {}) {
  const ok = httpCode >= 200 && httpCode < 300;
  const base = {
    code: httpCode,
    status: ok ? 'success' : 'error',
    success: ok
  };
  if (ok && typeof data !== 'undefined') base.data = data;
  if (!ok && typeof error !== 'undefined') base.error = error;
  if (extra && typeof extra === 'object') Object.assign(base, extra);
  return base;
}


