import { GOOGLE_PLACE_CATEGORIES } from './googlePlaceCategories.js';

/**
 * Canonicaliser for Discover's "Restrict Google categories" filter.
 *
 * The Maps actor's `categoryFilterWords` is a CLOSED enum of ~4,000 all-lowercase
 * Google category names — not free text. A value outside it fails the run start
 * with a 400 ("must be equal to one of the allowed values") BEFORE anything is
 * crawled, and Title case alone is enough to miss: "Gymnastics center" is
 * rejected while "gymnastics center" is accepted. Both operators and the AI
 * suggester write these words in prose casing, so every word is folded onto the
 * enum here before it reaches Apify.
 *
 * Folding is deliberately forgiving in ways the actor is not — case, curly
 * apostrophes, "&"/"and", centre/center spelling, plurals — because each of those
 * is the same category to Google. Anything that still doesn't land is a word
 * Google has no category for ("tuition centre", "kids gym"); it is reported back
 * rather than silently sent.
 */

const CENTRE = /\bcentre\b/g;

/** Display-level tidy-up: the string a human typed, minus the noise. */
function clean(raw) {
  return String(raw ?? '')
    .replace(/[‘’ʼ]/g, "'") // curly/modifier apostrophes → straight
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["'`]+|["'`.,;]+$/g, '') // stray quotes/trailing punctuation
    .trim()
    .toLowerCase();
}

/** Aggressive key: everything the enum spells one way and people spell another.
 *  Punctuation (&, /, -, parens, apostrophes) collapses to spaces so
 *  "bed and breakfast" finds "bed & breakfast" and "childrens store" finds
 *  "children's store"; British "centre" folds onto American "center". */
function fold(value) {
  return value
    .replace(/'/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(CENTRE, 'center');
}

/** Naive singulariser for the LAST word only — categories are head-noun phrases
 *  ("nail salons" → "nail salon"), never plural in the enum. */
function singularize(value) {
  const words = value.split(' ');
  const last = words[words.length - 1];
  let head = last;
  if (/[a-z]{2}ies$/.test(last)) head = `${last.slice(0, -3)}y`;
  else if (/(ss|sh|ch|x|z)es$/.test(last)) head = last.slice(0, -2);
  else if (/[^s]s$/.test(last)) head = last.slice(0, -1);
  if (head === last) return null;
  words[words.length - 1] = head;
  return words.join(' ');
}

const EXACT = new Set(GOOGLE_PLACE_CATEGORIES);
// fold key → canonical enum value. Built once; first (alphabetical) writer wins,
// so a collision like "children's store"/"childrens store" resolves stably —
// either spelling is a real category the actor accepts.
const BY_FOLD = new Map();
for (const category of GOOGLE_PLACE_CATEGORIES) {
  const key = fold(category);
  if (!BY_FOLD.has(key)) BY_FOLD.set(key, category);
}

/** One word → the enum value the actor will accept, or null when Google has no
 *  such category. */
export function canonicalPlaceCategory(raw) {
  const value = clean(raw);
  if (!value) return null;
  if (EXACT.has(value)) return value;
  const key = fold(value);
  if (BY_FOLD.has(key)) return BY_FOLD.get(key);
  const singular = singularize(key);
  if (singular && BY_FOLD.has(singular)) return BY_FOLD.get(singular);
  return null;
}

/** Near misses for a word Google doesn't know, so the operator can fix it
 *  instead of guessing. Ranked: contains the whole phrase → shares the head noun
 *  → shares any word; shorter (broader) categories first. Error path only. */
export function suggestPlaceCategories(raw, limit = 3) {
  const value = fold(clean(raw));
  if (!value) return [];
  const words = value.split(' ').filter((w) => w.length > 2);
  if (words.length === 0) return [];
  const head = words[words.length - 1];
  const scored = [];
  for (const category of GOOGLE_PLACE_CATEGORIES) {
    const key = fold(category);
    const keyWords = key.split(' ');
    let score = 0;
    if (key.includes(value)) score = 4;
    else if (keyWords[keyWords.length - 1] === head) score = 3;
    else if (words.some((w) => keyWords.includes(w))) score = 2;
    if (score > 0) scored.push({ category, score });
  }
  scored.sort((a, b) => b.score - a.score
    || a.category.length - b.category.length
    || a.category.localeCompare(b.category));
  return scored.slice(0, limit).map((s) => s.category);
}

/**
 * A whole filter list → what the actor will take and what it won't.
 * Deduped on the canonical value (so "Cafe" and "cafe" collapse to one), order
 * preserved. `dropped` keeps the operator's own spelling — it is what we echo back.
 */
export function resolvePlaceCategoryWords(words) {
  const kept = [];
  const dropped = [];
  const seen = new Set();
  for (const raw of Array.isArray(words) ? words : []) {
    const display = String(raw ?? '').trim();
    if (!display) continue;
    const canonical = canonicalPlaceCategory(display);
    if (!canonical) {
      if (!dropped.includes(display)) dropped.push(display);
      continue;
    }
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    kept.push(canonical);
  }
  return { kept, dropped };
}

/** Staff-facing "these aren't Google categories" sentence, with the closest real
 *  ones appended when we have them. */
export function unknownCategoriesMessage(dropped) {
  const list = dropped.map((w) => `"${w}"`).join(', ');
  const suggestions = [...new Set(dropped.flatMap((w) => suggestPlaceCategories(w, 2)))].slice(0, 4);
  const hint = suggestions.length ? ` Closest real ones: ${suggestions.map((s) => `"${s}"`).join(', ')}.` : '';
  return `Google has no such place ${dropped.length === 1 ? 'category' : 'categories'}: ${list}.${hint}`;
}
