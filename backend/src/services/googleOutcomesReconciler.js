import * as Sentry from '@sentry/node';
import { Prospect } from '../models/index.js';
import { mergeFirstWins } from '../utils/prospectJsonPatch.js';
import { logger } from '../utils/logger.js';

/**
 * Lyfe outcome reconciler (plan google-ads-signal-levers §4.3): the
 * DURABILITY NET for outcome facts. The Lyfe webhook is fire-and-forget at
 * the source (its pg_net trigger discards the response — nothing upstream
 * ever retries), so a missed delivery or a fact-write failure would
 * otherwise lose the outcome forever. This job reads Lyfe's Supabase
 * directly (same service-role env the agent sync uses) and back-fills any
 * missing `sourceMetadata.outcomes` facts — which also BACKFILLS the
 * outcomes that predate this arc entirely.
 *
 * Status mapping (rounds 6–7, pinned against lyfe-app):
 *  - vocabulary: new | contacted | qualified | proposed | won | lost
 *  - DIRECT evidence: current `qualified` implies confirmed_resident;
 *    current `won` implies confirmed_resident + closed_won (the one
 *    implication Lyfe's own semantics commits to). Timestamps approximate
 *    to the row's updated_at (documented).
 *  - HISTORY-FILL for every still-missing key regardless of current status
 *    (Lyfe permits regressions like won → qualified, and `proposed` alone
 *    does NOT imply qualification — the SC/PR dialog only fires on
 *    selecting `qualified`): one batched `lead_activities` query,
 *    `type=eq.status_change`, transitions read from
 *    `metadata.to_status`, fact timestamp = the activity's created_at.
 *    A `proposed` lead with no qualifying transition gets NOTHING — no
 *    false ConfirmedResident ever enters the bidding signal.
 *
 * First-wins merges make webhook, admin, and reconciler writes converge;
 * the reconciler never overwrites. Erased rows are blocked by the atomic
 * write's guard. Never throws.
 */

const KEYS = { CR: 'confirmed_resident', CW: 'closed_won' };

const defaultDeps = { Prospect, fetch: globalThis.fetch, mergeFirstWins };

export function reconcilerConfigured() {
  if (process.env.GOOGLE_ADS_UPLOADS_ENABLED !== 'true') return false;
  if (!process.env.LYFE_SUPABASE_URL) return false;
  if (!process.env.LYFE_SUPABASE_SERVICE_ROLE_KEY) return false;
  return true;
}

function restHeaders() {
  const key = process.env.LYFE_SUPABASE_SERVICE_ROLE_KEY;
  return { apikey: key, Authorization: `Bearer ${key}` };
}

async function restGet(path, d) {
  const base = process.env.LYFE_SUPABASE_URL.replace(/\/$/, '');
  const res = await d.fetch(`${base}/rest/v1/${path}`, { headers: restHeaders() });
  if (!res.ok) {
    throw new Error(`lyfe rest ${res.status}`);
  }
  return res.json();
}

/** Facts a lead's CURRENT status directly implies (timestamps approximate). */
export function directWants(status, updatedAt) {
  if (status === 'qualified') return { [KEYS.CR]: updatedAt };
  if (status === 'won') return { [KEYS.CR]: updatedAt, [KEYS.CW]: updatedAt };
  return {};
}

/** Facts a lead's status_change HISTORY proves (earliest transition wins). */
export function historyWants(activities) {
  const wants = {};
  for (const a of activities || []) {
    const to = a?.metadata?.to_status;
    const at = a?.created_at;
    if (!to || !at) continue;
    if (to === 'qualified' && !wants[KEYS.CR]) wants[KEYS.CR] = at;
    if (to === 'won') {
      if (!wants[KEYS.CR]) wants[KEYS.CR] = at;
      if (!wants[KEYS.CW]) wants[KEYS.CW] = at;
    }
  }
  return wants;
}

const PAGE = 1000;
const MAX_PAGES = 20;

/** Paged stable scan — one PostgREST page loop, ordered by id. */
async function restGetAll(basePath, d) {
  const all = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const sep = basePath.includes('?') ? '&' : '?';
    const rows = await restGet(`${basePath}${sep}limit=${PAGE}&offset=${page * PAGE}`, d);
    all.push(...rows);
    if (rows.length < PAGE) break;
  }
  return all;
}

export async function reconcileLyfeOutcomes(deps = {}) {
  const d = { ...defaultDeps, ...deps };
  if (!reconcilerConfigured()) return { ran: false, reason: 'guarded' };
  const summary = { ran: true, leads: 0, factsWritten: 0, historyLookups: 0, errors: 0 };
  try {
    // ALL SIX statuses (M3): the history-fill contract is "every still-
    // missing key regardless of current status" — a missed `won` followed by
    // regression to `new`/`contacted` must still be recoverable.
    const leads = await restGetAll(
      'leads?source_name=eq.mktr&select=id,external_id,status,updated_at&order=id.asc',
      d
    );
    summary.leads = leads.length;
    if (!leads.length) return summary;

    const prospects = await d.Prospect.findAll({
      attributes: ['id', 'sourceMetadata'],
      where: { id: leads.map((l) => l.external_id).filter(Boolean) },
      raw: true,
    });
    const byId = new Map(prospects.map((p) => [p.id, p]));

    // Pass 1: direct evidence + collect history candidates (any lead still
    // missing a key after direct evidence — round-7: regressions included).
    const wantsById = new Map();
    const historyLeadIds = [];
    for (const lead of leads) {
      const prospect = byId.get(lead.external_id);
      if (!prospect) continue;
      const facts = prospect.sourceMetadata?.outcomes || {};
      const wants = {};
      for (const [k, at] of Object.entries(directWants(lead.status, lead.updated_at))) {
        if (!facts[k]) wants[k] = at;
      }
      const stillMissing = [KEYS.CR, KEYS.CW].filter((k) => !facts[k] && !wants[k]);
      if (stillMissing.length) historyLeadIds.push(lead.id);
      if (Object.keys(wants).length) wantsById.set(lead.external_id, { wants, leadId: lead.id });
      else wantsById.set(lead.external_id, { wants: {}, leadId: lead.id });
    }

    // Pass 2: one batched activities query for the candidates.
    if (historyLeadIds.length) {
      summary.historyLookups = historyLeadIds.length;
      // Batched + encoded id filters, the JSON to_status predicate applied
      // SERVER-SIDE (irrelevant transitions must not consume the page), and
      // per-batch pagination (M3).
      const byLead = new Map();
      for (let i = 0; i < historyLeadIds.length; i += 100) {
        const batch = historyLeadIds.slice(i, i + 100);
        const inList = encodeURIComponent(`(${batch.map((id) => `"${id}"`).join(',')})`);
        const activities = await restGetAll(
          `lead_activities?type=eq.status_change&lead_id=in.${inList}` +
            `&metadata->>to_status=in.(qualified,won)` +
            `&select=lead_id,created_at,metadata&order=created_at.asc`,
          d
        );
        for (const a of activities) {
          if (!byLead.has(a.lead_id)) byLead.set(a.lead_id, []);
          byLead.get(a.lead_id).push(a);
        }
      }
      for (const lead of leads) {
        const entry = wantsById.get(lead.external_id);
        if (!entry) continue;
        const prospect = byId.get(lead.external_id);
        const facts = prospect?.sourceMetadata?.outcomes || {};
        const proven = historyWants(byLead.get(lead.id));
        for (const [k, at] of Object.entries(proven)) {
          if (!facts[k] && !entry.wants[k]) entry.wants[k] = at;
        }
      }
    }

    // Pass 3: first-wins merges (one call per prospect).
    for (const [prospectId, { wants }] of wantsById) {
      const keys = Object.keys(wants);
      if (!keys.length) continue;
      const normalized = Object.fromEntries(
        keys.map((k) => [k, new Date(Date.parse(wants[k]) || Date.now()).toISOString()])
      );
      const n = await d.mergeFirstWins(prospectId, ['outcomes'], normalized);
      if (n > 0) summary.factsWritten += keys.length;
    }
    if (summary.factsWritten) logger.info(summary, 'google_outcomes.reconcile.done');
    return summary;
  } catch (err) {
    summary.errors += 1;
    Sentry.captureException(err, { tags: { source: 'google_outcomes_reconcile' } });
    logger.error({ err: err.message }, 'google_outcomes.reconcile.failed');
    return summary;
  }
}
