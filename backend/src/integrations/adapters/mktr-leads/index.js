/**
 * @file mktr-leads adapter entry point.
 *
 * Importing this module side-effects: it self-registers `MktrLeadsAdapter` with
 * `adapterRegistry`. Import from `backend/src/integrations/index.js` to ensure
 * registration happens at app boot.
 */

import { adapterRegistry } from '../../AdapterRegistry.js';
import { MktrLeadsAdapter } from './MktrLeadsAdapter.js';

if (!adapterRegistry.has(MktrLeadsAdapter.id)) {
  adapterRegistry.register(MktrLeadsAdapter);
}

export { MktrLeadsAdapter };
