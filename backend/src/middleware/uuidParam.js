/**
 * Malformed uuid :params 404 cleanly instead of leaking a Postgres uuid-cast
 * 500 (teardown PR — the "Database Error" panel paper cut, found live when a
 * copied campaign URL lost its final character). Attach per router:
 *   router.param('id', uuidParamGuard('Campaign'));
 * Literal sibling routes (e.g. /slug-availability, /featured-drops) never hit
 * a param handler. Dependency-free and DB-free.
 */
export const UUID_PARAM_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function uuidParamGuard(entityLabel = 'Resource') {
  return function guard(req, res, next, value) {
    if (!UUID_PARAM_RE.test(String(value))) {
      return res.status(404).json({ success: false, message: `${entityLabel} not found` });
    }
    return next();
  };
}
