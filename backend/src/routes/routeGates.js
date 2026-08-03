/**
 * Default-deny route registration.
 *
 * Every endpoint mounted through loadRoutes must either carry a TAGGED auth
 * gate in its middleware chain (authenticateToken, requireRole closures,
 * requireRedeemOps, requireExternalHmac — anything marked mktrAuthGate) or be
 * explicitly declared in its module's `meta.public` array. An undeclared,
 * ungated route fails the BOOT, not a review: three audit rounds each found
 * endpoints that shipped open (H2, M3, M12) because nothing structural made
 * "gated" the default.
 *
 * `meta.public` is the reviewable allowlist: auth flows, the public capture
 * funnel, token-authenticated claim/callback links, and webhook receivers
 * that verify signatures INSIDE the handler. Declarations are strict — one
 * that matches no live route also fails boot, so the list cannot rot.
 */

/** Mark a middleware (or each element of an array) as an auth gate. */
export function tagAuthGate(fn) {
  if (Array.isArray(fn)) { fn.forEach(tagAuthGate); return fn; }
  fn.mktrAuthGate = true;
  return fn;
}

const isGate = (handle) => typeof handle === 'function' && handle.mktrAuthGate === true;

/** Flatten an express router into [{ sig, gated }] — router-level gates
 *  (router.use(gate)) protect every route registered after them. */
export function walkRouter(stack, inheritedGate = false, out = []) {
  let gated = inheritedGate;
  for (const layer of stack || []) {
    if (layer.route) {
      const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
      const routeGated = gated || layer.route.stack.some((l) => isGate(l.handle));
      for (const method of Object.keys(layer.route.methods)) {
        for (const p of paths) out.push({ sig: `${method.toUpperCase()} ${p}`, gated: routeGated });
      }
    } else if (layer.handle?.stack) {
      walkRouter(layer.handle.stack, gated, out); // nested router inherits gates
    } else if (isGate(layer.handle)) {
      gated = true;
    }
  }
  return out;
}

/** Boot-time enforcement — throws with the exact offenders. */
export function assertRouterGated({ router, meta, file }) {
  const routes = walkRouter(router.stack);
  const declared = new Set(meta.public || []);

  const undeclared = routes.filter((r) => !r.gated && !declared.has(r.sig)).map((r) => r.sig);
  if (undeclared.length > 0) {
    throw new Error(
      `Ungated route(s) in ${file} with no meta.public declaration: ${undeclared.join(', ')}. ` +
      'Add an auth gate (authenticateToken / requireRedeemOps / requireExternalHmac / requireRole) ' +
      "or declare the route in the module's meta.public with a comment saying why it is public."
    );
  }

  const live = new Set(routes.map((r) => r.sig));
  const stale = [...declared].filter((sig) => !live.has(sig));
  if (stale.length > 0) {
    throw new Error(
      `meta.public in ${file} declares route(s) that do not exist: ${stale.join(', ')}. ` +
      'Remove the stale declaration.'
    );
  }

  // A declaration for a route that is actually gated is a lie waiting to
  // mislead the next reader — declarations must mean exactly one thing.
  const gatedSigs = new Set(routes.filter((r) => r.gated).map((r) => r.sig));
  const redundant = [...declared].filter((sig) => gatedSigs.has(sig));
  if (redundant.length > 0) {
    throw new Error(
      `meta.public in ${file} declares route(s) that carry an auth gate: ${redundant.join(', ')}. ` +
      'Remove the declaration (the gate governs) or the gate (and keep the declaration).'
    );
  }
}
