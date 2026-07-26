import { SOURCE_RANK, FACT_KEYS, FRESH_WINDOW_DAYS } from './factTaxonomy.js';

/**
 * resolveCurrentFacts — the total, deterministic "what do we currently
 * believe about this person" function
 * (docs/plans/consumer-profile-enrichment.md §3.4).
 *
 * Pure: rows in → resolved map out. No I/O, no clock — callers pass rows
 * already scoped to one consumer (prospect-join ∪ manual rows, non-deleted).
 *
 * Precedence (Codex R2 #8 / R3 #8 — total order, fresh-scoped THROUGHOUT):
 *   1. Drop superseded/retracted rows (activation §3.1 guarantees only the
 *      current revision/pipeline rows remain active — never inferred here).
 *   2. Per key: newest = max sourceEventAt; the FRESH SET = rows within
 *      FRESH_WINDOW_DAYS of newest. Every later step draws only from it —
 *      this IS the recency override: an old explicit answer loses
 *      eligibility rather than a tie-break (lives change).
 *   3. Scalars: winner = max by (source rank, confidence, sourceEventAt, id).
 *      The id tiebreak (string compare) makes the order total.
 *   4. Collections: baseline = fresh complete:true winner by the same tuple
 *      ({v:[], complete:true} = explicitly none). Partials = fresh,
 *      non-complete, sourceEventAt AFTER the baseline's, sorted by the
 *      tuple, first-wins dedupe; baseline entries win dupes. No baseline ⇒
 *      deduped union of fresh partials. Output ordering is canonical so
 *      resolution is order-independent.
 */

const rankOf = (o) => SOURCE_RANK[o.source] ?? 0;
const timeOf = (o) => new Date(o.sourceEventAt).getTime();

/** Total-order comparator: rank, then confidence, then sourceEventAt, then id. */
function tupleCompare(a, b) {
  if (rankOf(a) !== rankOf(b)) return rankOf(a) - rankOf(b);
  if (a.confidence !== b.confidence) return a.confidence - b.confidence;
  if (timeOf(a) !== timeOf(b)) return timeOf(a) - timeOf(b);
  return String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0;
}

const childDedupeKey = (c) => `${c.birth_year_band ?? 'unknown'}|${c.gender ?? 'unknown'}`;

function canonicalChildren(children) {
  return [...children].sort((a, b) => {
    const ka = `${a.birth_year_band ?? '~'}|${a.gender ?? '~'}`;
    const kb = `${b.birth_year_band ?? '~'}|${b.gender ?? '~'}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}

function resolveCollection(kind, fresh) {
  const completes = fresh.filter((o) => o.value?.complete === true);
  const baseline = completes.length ? completes.reduce((a, b) => (tupleCompare(a, b) >= 0 ? a : b)) : null;
  const partials = fresh
    .filter((o) => o.value?.complete !== true)
    .filter((o) => (baseline ? timeOf(o) > timeOf(baseline) : true))
    .sort((a, b) => tupleCompare(b, a)); // strongest first — first-wins dedupe

  const basis = [];
  if (kind === 'children') {
    const seen = new Map(); // dedupeKey → child
    if (baseline) {
      basis.push(baseline.id);
      for (const c of baseline.value.v) seen.set(childDedupeKey(c), c);
    }
    for (const p of partials) {
      let contributed = false;
      for (const c of p.value.v) {
        const k = childDedupeKey(c);
        if (!seen.has(k)) { seen.set(k, c); contributed = true; }
      }
      if (contributed) basis.push(p.id);
    }
    return { merged: { v: canonicalChildren([...seen.values()]), complete: Boolean(baseline?.value?.complete) }, baseline, basis };
  }

  // 'strings' collections (pets, coverage, interest tags)
  const seen = new Set();
  if (baseline) {
    basis.push(baseline.id);
    for (const s of baseline.value.v) seen.add(s);
  }
  for (const p of partials) {
    let contributed = false;
    for (const s of p.value.v) {
      if (!seen.has(s)) { seen.add(s); contributed = true; }
    }
    if (contributed) basis.push(p.id);
  }
  return { merged: { v: [...seen].sort(), complete: Boolean(baseline?.value?.complete) }, baseline, basis };
}

/**
 * @param {Array} observations — rows for ONE consumer (plain objects or model
 *   instances; needs id, key, value, confidence, source, sourceEventAt,
 *   supersededAt, retractedAt).
 * @returns {Object} key → { value, source, confidence, sourceEventAt,
 *   observationId, basis: [ids…] } — collections carry the merged value, the
 *   baseline's meta (or the strongest partial's when no baseline), and every
 *   contributing id in basis.
 */
export function resolveCurrentFacts(observations) {
  const active = observations.filter((o) => !o.supersededAt && !o.retractedAt && FACT_KEYS[o.key]);
  const byKey = new Map();
  for (const o of active) {
    if (!byKey.has(o.key)) byKey.set(o.key, []);
    byKey.get(o.key).push(o);
  }

  const resolved = {};
  for (const [key, rows] of byKey) {
    const newest = Math.max(...rows.map(timeOf));
    const fresh = rows.filter((o) => newest - timeOf(o) <= FRESH_WINDOW_DAYS * 86_400_000);
    const kind = FACT_KEYS[key].collection;

    if (!kind) {
      const winner = fresh.reduce((a, b) => (tupleCompare(a, b) >= 0 ? a : b));
      resolved[key] = {
        value: winner.value,
        source: winner.source,
        confidence: winner.confidence,
        sourceEventAt: winner.sourceEventAt,
        observationId: winner.id,
        basis: [winner.id],
      };
      continue;
    }

    const { merged, baseline, basis } = resolveCollection(kind, fresh);
    if (!basis.length) continue; // e.g. only complete:false rows all pre-baseline — cannot happen, but stay safe
    const meta = baseline ?? fresh.filter((o) => basis.includes(o.id)).sort((a, b) => tupleCompare(b, a))[0];
    resolved[key] = {
      value: merged,
      source: meta.source,
      confidence: meta.confidence,
      sourceEventAt: meta.sourceEventAt,
      observationId: meta.id,
      basis,
    };
  }
  return resolved;
}
