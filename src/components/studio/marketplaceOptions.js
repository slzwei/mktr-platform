/**
 * Marketplace listing option lists shared by the Distribution panel, the
 * classic MarketplacePanel and the AI review panel (pick-row display labels).
 * Derived DIRECTLY from the backend taxonomy (tracker "taxonomy") — adding or
 * removing a category happens in backend/src/utils/marketplaceContent.js and
 * nowhere else. The save clamp re-validates against the same source, so the
 * two can never drift.
 */

import { CONSUMER_CATEGORY_DEFS } from '../../../backend/src/utils/marketplaceContent.js';

export { OFFER_TYPES, MODES } from '../../../backend/src/utils/marketplaceContent.js';

export const CATEGORY_OPTIONS = CONSUMER_CATEGORY_DEFS.map((c) => [c.id, c.label]);
