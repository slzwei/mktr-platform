# lead.suppressed consumer plan — lyfe-app (for Shawn to apply in lyfe-app)

**Contract:** `docs/reference/webhook-propagation-contract.md` (mktr-platform repo). Emitter is LIVE-dark; `LYFE_LEAD_SUPPRESSED_ENABLED` stays false until step 5.
**Anchors below were mapped from lyfe-app on 2026-07-21 — RE-VERIFY in-repo before applying** (receiver: `supabase/functions/receive-mktr-lead/index.ts`; migrations: `supabase/migrations/`).

## 1. Migration (canonical location: `lyfe-app/supabase/migrations/`)

```sql
-- leads: suppression columns (timestamp-as-flag matches archived_at house style)
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS do_not_contact_at timestamptz,
  ADD COLUMN IF NOT EXISTS do_not_contact_scope text
    CHECK (do_not_contact_scope IN ('marketing','all') OR do_not_contact_scope IS NULL);

-- Tombstone: suppression that arrived before (or without) its lead —
-- consulted by lead.created/assigned handlers, applied on arrival.
CREATE TABLE IF NOT EXISTS mktr_lead_suppressions (
  source_name text NOT NULL,
  external_id text NOT NULL,
  scope text NOT NULL CHECK (scope IN ('marketing','all')),
  reason text NOT NULL,
  occurred_at timestamptz NOT NULL,
  delivery_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_name, external_id)
);
-- Service-role only: ENFORCED, not commented (Codex diff-round #10) — RLS on
-- with no policies denies app roles; service_role bypasses RLS.
ALTER TABLE mktr_lead_suppressions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON mktr_lead_suppressions FROM anon, authenticated;

-- Activity enum (precedent: 20260427180000 added 'unassignment')
ALTER TYPE lead_activity_type ADD VALUE IF NOT EXISTS 'suppressed';

-- One RPC = the atomic monotonic merge (lyfe has NO delivery-dedup table, so
-- atomicity must live here; Codex #19). search_path pinned (SECURITY DEFINER
-- hygiene, Codex diff-round #10).
CREATE OR REPLACE FUNCTION apply_mktr_lead_suppression(
  p_source_name text, p_external_id text, p_scope text, p_reason text,
  p_occurred_at timestamptz, p_delivery_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_lead leads%ROWTYPE; v_found boolean := false; v_changed boolean := false;
BEGIN
  -- Monotonic tombstone upsert: 'all' dominates; newer occurred_at wins within a scope.
  INSERT INTO mktr_lead_suppressions AS t
    (source_name, external_id, scope, reason, occurred_at, delivery_id)
  VALUES (p_source_name, p_external_id, p_scope, p_reason, p_occurred_at, p_delivery_id)
  ON CONFLICT (source_name, external_id) DO UPDATE SET
    scope = CASE WHEN t.scope = 'all' THEN 'all' ELSE excluded.scope END,
    reason = CASE WHEN t.scope = 'all' AND excluded.scope <> 'all' THEN t.reason ELSE excluded.reason END,
    occurred_at = GREATEST(t.occurred_at, excluded.occurred_at),
    delivery_id = excluded.delivery_id,
    updated_at = now();

  SELECT * INTO v_lead FROM leads
   WHERE external_id = p_external_id AND source_name = p_source_name;
  v_found := FOUND;  -- captured: later statements overwrite FOUND (Codex diff-round #9)
  IF v_found THEN
    -- Effect-idempotent: fires only when the merged state actually CHANGES
    -- (first application, or a marketing→all escalation) — repairs with new
    -- delivery ids must not duplicate activities.
    UPDATE leads SET
      do_not_contact_at = COALESCE(do_not_contact_at, p_occurred_at),
      do_not_contact_scope = CASE
        WHEN do_not_contact_scope = 'all' THEN 'all' ELSE p_scope END,
      updated_at = now()
     WHERE id = v_lead.id
       AND (do_not_contact_at IS NULL
            OR (do_not_contact_scope IS DISTINCT FROM 'all' AND p_scope = 'all'));
    v_changed := FOUND;
    IF v_changed THEN
      INSERT INTO lead_activities (lead_id, user_id, type, description, metadata)
      VALUES (v_lead.id, v_lead.created_by, 'suppressed',
              'Do-not-contact from MKTR (' || p_scope || ')',
              jsonb_build_object('delivery_id', p_delivery_id, 'reason', p_reason, 'scope', p_scope));
    END IF;
  END IF;
  RETURN jsonb_build_object('lead_found', v_found, 'changed', v_changed);
END $$;
REVOKE ALL ON FUNCTION apply_mktr_lead_suppression FROM anon, authenticated;
```

Then `npm run gen:types` + `sync:types` per house rules.

## 2. Edge function (`receive-mktr-lead/index.ts`)

1. `SUPPORTED_EVENTS` gains `'lead.suppressed'` (today it 400s — index.ts:128-131).
2. Handler (model on the `lead.unassigned` branch, :161-202): validate `data.suppression` strictly per contract §3.2 (400 on malformed); call `apply_mktr_lead_suppression(...)` once; ALWAYS 200 on success paths — including lead-not-found (`lead_found:false`), which is the tombstone case, NOT an error.
3. **Lead-arrival hook**: in the `lead.created` / `lead.assigned` insert paths, after upsert, `SELECT ... FROM mktr_lead_suppressions WHERE source_name='mktr' AND external_id=...` — if present, stamp `do_not_contact_at/scope` on the new row (one UPDATE; or fold into the insert). This closes the suppression-before-created race.

## 3. App surface

- Lead list + `[leadId]` detail: render a DNC badge when `do_not_contact_at` set — `all` = red "Erased — do not contact"; `marketing` = amber "No marketing". Gate the call/WhatsApp affordances on the detail screen for scope `all` (hard block with explanation), warn-on-tap for `marketing`.
- Optional phase 2: `notifications` insert to `assigned_to` on suppression of an assigned lead (needs `chk_notification_type` extended with `'lead_suppressed'` — `20260401000000` precedent).

## 4. Synthetic verification (BEFORE the mktr flip — contract §5.2)

lyfe verifies v1 (body-only HMAC + timestamp header, ±5 min): craft the payload from contract §2, sign `sha256=HMAC(secret, rawBody)` with `MKTR_WEBHOOK_SECRET`, POST to the EF. Assert: 200 + tombstone row; re-POST same body → 200, no duplicate activity; then a synthetic `lead.created` for that external_id → lead lands already-flagged.

## 5. Go-live

Flip `LYFE_LEAD_SUPPRESSED_ENABLED=true` on the mktr backend Render service (env change triggers redeploy; the boot pass adds the event to the 'Lyfe App' subscriber and backfills all dark-period pairs). Verify per contract §5.4.

## 6. Later (separate item)

Adopting `lead.deleted` (PR C's documented Lyfe gap) should reuse this exact shape — tombstone precedent, RPC, allowlist entry. Until then, erasures reach lyfe as `lead.suppressed scope:'all'` via the emitter's fallback rule; switching the subscriber to `lead.deleted` handling later automatically stops the fallback pairs for NEW erasures (already-projected pairs are harmless history).
