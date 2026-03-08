import { randomUUID } from 'crypto';

/**
 * Attach a unique request ID to every request.
 * Uses the incoming X-Request-Id header if present (from a load balancer),
 * otherwise generates a new UUID v4.
 */
export function requestId(req, res, next) {
  req.id = req.headers['x-request-id'] || randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
}
