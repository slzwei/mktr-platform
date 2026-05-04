/**
 * @file Integrations bootstrap — imports trigger adapter self-registration.
 *
 * Import this once at app boot (server_internal.js or bootstrap.js) so all
 * adapters are registered before any service tries to look them up.
 *
 * Phase 1: only Lyfe is registered. Adding a platform = adding an import.
 */

import './adapters/lyfe/index.js';

export { adapterRegistry } from './AdapterRegistry.js';
