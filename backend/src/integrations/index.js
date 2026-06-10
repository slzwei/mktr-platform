/**
 * @file Integrations bootstrap — imports trigger adapter self-registration.
 *
 * Import this once at app boot (server_internal.js or bootstrap.js) so all
 * adapters are registered before any service tries to look them up.
 *
 * Adding a platform = adding an import. mktr-leads self-registers regardless of
 * env config; sync/dispatch for it stay no-ops until its env vars are set.
 */

import './adapters/lyfe/index.js';
import './adapters/mktr-leads/index.js';

export { adapterRegistry } from './AdapterRegistry.js';
