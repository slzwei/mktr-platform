/**
 * @file Lyfe adapter entry point.
 *
 * Importing this module side-effects: it self-registers `LyfeAdapter` with
 * `adapterRegistry`. Import from `backend/src/integrations/index.js` to ensure
 * registration happens at app boot.
 */

import { adapterRegistry } from '../../AdapterRegistry.js';
import { LyfeAdapter } from './LyfeAdapter.js';

if (!adapterRegistry.has(LyfeAdapter.id)) {
  adapterRegistry.register(LyfeAdapter);
}

export { LyfeAdapter };
