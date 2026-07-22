#!/usr/bin/env node
/**
 * Rollout diff for the marketplace-inheritance flip (plan §4): for every
 * LISTED campaign (marketplace publication flag + slug — the real gate
 * inputs) print the full listing design_config diff flag-OFF vs flag-ON,
 * including the effective title fallback and card image; then diff every
 * ENABLED featured drop's tile title. Reviewed before
 * MARKETPLACE_INHERIT_ENABLED goes on — no live copy changes unseen.
 * Remediation is a page-content edit.
 *
 * Run where DB env exists:  node scripts/marketplace-inherit-diff.js
 */
import { Campaign } from '../src/models/index.js';
import { buildPublicDesignConfig, toDto } from '../src/services/marketplaceService.js';
import { applyListingInheritance, deriveFeaturedDropTitle } from '../src/utils/listingDerivation.js';
import { getStoredMarketplaceListed, getStoredFeaturedDrop } from '../src/utils/designConfigV2Clamp.js';
import { normalizeFeaturedDrop } from '../src/utils/featuredDrop.js';

const campaigns = await Campaign.findAll({
  attributes: ['id', 'slug', 'name', 'status', 'is_active', 'min_age', 'max_age', 'metaPixelId', 'tiktokPixelId', 'design_config'],
});

const show = (v) => (v === undefined ? '(none)' : JSON.stringify(v));

console.log('════ Marketplace listings (flag OFF → ON) ════');
for (const c of campaigns) {
  if (!c.slug || getStoredMarketplaceListed(c.design_config) !== true) continue;
  const before = buildPublicDesignConfig(c.design_config);
  const after = applyListingInheritance({ campaign: c, publicDc: before, rawDc: c.design_config });
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  console.log(`\n■ ${c.name} (${c.slug}) — ${c.status}${c.is_active ? '/active' : '/inactive'}`);
  console.log(`  effective title: ${show(before.name ?? c.name)} → ${show(after.name ?? c.name)}`);
  let changed = false;
  for (const k of keys) {
    const a = JSON.stringify(before[k]);
    const b = JSON.stringify(after[k]);
    if (a !== b) {
      changed = true;
      console.log(`  ${k}: ${show(before[k])} → ${show(after[k])}`);
    }
  }
  if (!changed) console.log('  (no key-level change)');
}

console.log('\n════ Featured drops (tile title, flag OFF → ON) ════');
for (const c of campaigns) {
  const fd = normalizeFeaturedDrop(getStoredFeaturedDrop(c.design_config));
  if (!fd || fd.enabled !== true) continue;
  const before = fd.title || c.name;
  const after = deriveFeaturedDropTitle(c.design_config) || c.name;
  console.log(`■ ${c.name}: ${show(before)} → ${show(after)}${before === after ? '  (unchanged)' : ''}`);
}

// toDto imported to keep the full-DTO path exercised in CI import checks.
void toDto;
process.exit(0);
