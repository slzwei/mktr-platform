#!/usr/bin/env node
/**
 * Regenerate the Google-place-category allowlist used by Discover's
 * "Restrict Google categories" filter.
 *
 * The Apify Maps actor (compass/crawler-google-places) validates its
 * `categoryFilterWords` input against a CLOSED enum of ~4,000 all-lowercase
 * Google category names. Anything outside it — including the same word in
 * Title case — fails the run start with a 400 before a single place is
 * crawled, so we mirror the enum locally and canonicalise operator/AI input
 * against it. This script pulls the enum from the actor's latest build and
 * rewrites the generated module.
 *
 * Dev-time only (never runs in the Render image). No token needed — the actor
 * is public.
 *
 *   node backend/scripts/refresh-place-categories.mjs
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ACTOR = 'compass~crawler-google-places';
const API = 'https://api.apify.com/v2';
const OUT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../src/services/redeemOps/discovery/googlePlaceCategories.js',
);

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} → ${res.status} ${await res.text().catch(() => '')}`.slice(0, 300));
  return res.json();
}

const actor = await getJson(`${API}/acts/${ACTOR}`);
const build = actor?.data?.taggedBuilds?.latest;
if (!build?.buildId) throw new Error('Actor has no tagged "latest" build');

const { data } = await getJson(`${API}/actor-builds/${build.buildId}`);
const schema = typeof data?.inputSchema === 'string' ? JSON.parse(data.inputSchema) : data?.inputSchema;
const field = schema?.properties?.categoryFilterWords;
const values = field?.items?.enum || field?.enum;
if (!Array.isArray(values) || values.length < 1000) {
  throw new Error(`categoryFilterWords enum missing or suspiciously small (${values?.length ?? 0}) — schema changed?`);
}

const offenders = values.filter((v) => typeof v !== 'string' || v !== v.toLowerCase());
if (offenders.length) throw new Error(`Enum is no longer all-lowercase strings: ${offenders.slice(0, 5).join(', ')}`);

const sorted = [...new Set(values)].sort();
const quoted = sorted.map((v) => `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`);
// Wrap at ~96 cols so the generated file stays greppable in review.
const lines = [];
let line = ' ';
for (const item of quoted) {
  if (line.length + item.length + 2 > 96) { lines.push(line); line = ' '; }
  line += ` ${item},`;
}
if (line.trim()) lines.push(line);

writeFileSync(OUT, `/**
 * Google Maps place categories the Apify actor accepts in \`categoryFilterWords\`
 * — a CLOSED, all-lowercase enum. A value outside it (including the SAME word in
 * Title case) 400s the run start: "must be equal to one of the allowed values".
 *
 * GENERATED FILE — do not hand-edit. Refresh with:
 *   node backend/scripts/refresh-place-categories.mjs
 *
 * Source: apify.com/${ACTOR.replace('~', '/')} build ${build.buildNumber} (${build.finishedAt.slice(0, 10)}).
 */
export const GOOGLE_PLACE_CATEGORIES = Object.freeze([
${lines.join('\n')}
]);

export default GOOGLE_PLACE_CATEGORIES;
`);

process.stdout.write(`Wrote ${sorted.length} categories from build ${build.buildNumber} → ${OUT}\n`);
