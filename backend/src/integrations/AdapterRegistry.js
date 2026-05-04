/**
 * @file AdapterRegistry — singleton registry for platform adapters.
 *
 * Adapters self-register on module load. Core services discover them via
 * `registry.get(id)` or `registry.list()`. Lazy initialisation avoids
 * module-init cycles when adapters depend on services that depend on the
 * registry (e.g., bootstrap.js).
 *
 * Usage:
 *   import { adapterRegistry } from './AdapterRegistry.js';
 *   import './adapters/lyfe/index.js'; // triggers self-registration
 *
 *   const lyfe = adapterRegistry.get('lyfe');
 *   const agents = await lyfe.listAgents();
 *
 * Phase 1: only Lyfe is registered. Phase 3+ adds platform_registry table
 * + dynamic registration based on DB rows.
 *
 * @see ./PlatformAdapter.js for the interface contract.
 */

import { logger } from '../utils/logger.js';

const ADAPTERS = new Map();

/**
 * Register a platform adapter. Throws on duplicate id to prevent silent
 * shadowing during refactors. Use `replace()` instead if intentional.
 *
 * @param {import('./PlatformAdapter.js').PlatformAdapter} adapter
 */
function register(adapter) {
  if (!adapter || typeof adapter.id !== 'string') {
    throw new Error('adapter must expose a string `id`');
  }
  if (typeof adapter.listAgents !== 'function' || typeof adapter.getAgent !== 'function') {
    throw new Error(`adapter '${adapter.id}' must implement listAgents() and getAgent()`);
  }
  if (ADAPTERS.has(adapter.id)) {
    throw new Error(`adapter '${adapter.id}' already registered — use replace() if intentional`);
  }
  ADAPTERS.set(adapter.id, adapter);
  logger.info({ component: 'adapter_registry', adapterId: adapter.id }, `Registered platform adapter '${adapter.id}'`);
}

/**
 * Replace an existing adapter (for tests). Logs a warning to surface the
 * unusual code path.
 */
function replace(adapter) {
  ADAPTERS.set(adapter.id, adapter);
  logger.warn({ component: 'adapter_registry', adapterId: adapter.id }, `Replaced platform adapter '${adapter.id}'`);
}

/**
 * Lookup by id. Throws if not registered.
 *
 * @param {string} id
 * @returns {import('./PlatformAdapter.js').PlatformAdapter}
 */
function get(id) {
  const adapter = ADAPTERS.get(id);
  if (!adapter) {
    const known = Array.from(ADAPTERS.keys()).join(', ') || '(none)';
    throw new Error(`No adapter registered for '${id}'. Known: ${known}`);
  }
  return adapter;
}

/** True if an adapter is registered for `id`. */
function has(id) {
  return ADAPTERS.has(id);
}

/**
 * List all registered adapters. Used by the sync orchestrator to iterate
 * across platforms.
 *
 * @returns {import('./PlatformAdapter.js').PlatformAdapter[]}
 */
function list() {
  return Array.from(ADAPTERS.values());
}

/** Clear all adapters. Test-only; do not call in production code. */
function _resetForTesting() {
  ADAPTERS.clear();
}

export const adapterRegistry = {
  register,
  replace,
  get,
  has,
  list,
  _resetForTesting,
};
