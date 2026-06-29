/**
 * Web unified-timeline helpers (Phase 2). Lets the mktr.sg web Activity Timeline show the SAME
 * merged history as the mktr-leads app: MKTR ProspectActivity (lifecycle) + the lead's Supabase
 * lead_activities (agent engagement), deduped across the cross-mirror tags.
 *
 * The merge mirrors the mktr-leads `mktr-lead-timeline` edge function, but in the OTHER direction —
 * here the MKTR backend pulls the Supabase half (via the mktr-lead-activities-export EF) and merges.
 * The web normalises each tagged row client-side (src/utils/leadTimeline.js), same canonical model.
 */
import crypto from 'crypto';

/**
 * Fetch a lead's Supabase lead_activities via the HMAC-authed export EF. Never throws — a miss
 * (no URL, timeout, non-2xx) returns `{ rows: [], ok: false }` so the caller degrades to
 * ProspectActivity-only. `ok` gates the cross-mirror dedup (only dedup when BOTH stores answered).
 */
export async function fetchLeadActivitiesFromSupabase(externalId, { timeoutMs = 2500 } = {}) {
  const url = process.env.SUPABASE_LEAD_ACTIVITIES_URL;
  const secret = process.env.EXTERNAL_APP_SECRET;
  if (!url || !secret || !externalId) return { rows: [], ok: false };

  const payload = JSON.stringify({ timestamp: new Date().toISOString(), externalId });
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Webhook-Signature': `sha256=${signature}` },
      body: payload,
      signal: controller.signal,
    });
    if (!resp.ok) return { rows: [], ok: false };
    const body = await resp.json().catch(() => ({}));
    // Only treat it as "Supabase answered" when we actually got the array — a non-2xx (incl. the
    // EF's 500 on a query error) or a malformed body keeps ok=false so dedup never drops MKTR rows.
    if (!Array.isArray(body.activities)) return { rows: [], ok: false };
    return { rows: body.activities, ok: true };
  } catch {
    return { rows: [], ok: false };
  } finally {
    clearTimeout(timer);
  }
}

const tsOf = (x) => {
  const v = x.origin === 'mktr' ? x.row.createdAt : x.row.created_at;
  const t = Date.parse(v);
  return Number.isNaN(t) ? 0 : t;
};

/**
 * Merge ProspectActivity (lifecycle) + lead_activities (engagement) into ONE newest-first list of
 * `{ origin, row }`. Dedup the cross-mirror rows on BOTH sides — but ONLY when the Supabase half
 * actually answered (`ok`); on a miss, keep all ProspectActivity (incl. its outcome mirrors) so the
 * web never loses lifecycle. id tie-break for cross-DB clock ties.
 */
export function mergeProspectTimeline(prospectActivities, leadActivities, { ok = true } = {}) {
  const mktr = (prospectActivities || []).map((a) => ({
    id: a.id,
    type: a.type,
    description: a.description ?? null,
    actorUserId: a.actorUserId ?? null,
    metadata: a.metadata ?? null,
    createdAt: a.createdAt,
  }));
  const app = (leadActivities || []).map((a) => ({
    id: a.id,
    type: a.type,
    description: a.description ?? null,
    metadata: a.metadata ?? null,
    created_at: a.created_at,
  }));

  const mktrRows = ok ? mktr.filter((r) => r.metadata?.source !== 'mktr-leads') : mktr;
  const appRows = ok ? app.filter((r) => r.metadata?.source !== 'mktr') : app;

  return [
    ...mktrRows.map((row) => ({ origin: 'mktr', row })),
    ...appRows.map((row) => ({ origin: 'app', row })),
  ].sort((a, b) => tsOf(b) - tsOf(a) || String(b.row.id).localeCompare(String(a.row.id)));
}
