# lead.suppressed consumer plan — lyfe-app (for Shawn to apply in lyfe-app)

**Contract:** `docs/reference/webhook-propagation-contract.md` (mktr-platform repo). Emitter is LIVE-dark; `LYFE_LEAD_SUPPRESSED_ENABLED` stays false until step 5.
**Anchors below were mapped from lyfe-app on 2026-07-21 — RE-VERIFY in-repo before applying** (receiver: `supabase/functions/receive-mktr-lead/index.ts`; migrations: `supabase/migrations/`).

## 1. Migration — v1, APPLIED 2026-07-21, **SUPERSEDED by §7's v2** (do not re-apply this SQL: its DELETE-based lift and unconditional merge recreate the watermark bug — Codex resub-round-2 #3)

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

## 7. Resubscribe lift (v3, 2026-07-22) — APPLIED

Contract §6 v2 (state rows — Codex resub-round #2). Migration `20260722110000`: `'resubscribed'` enum value; `mktr_lead_suppressions.state` ('suppressed'|'lifted', default suppressed); `apply_mktr_lead_suppression` v2 (strictly-newer wins, EQUAL watermark applies only over a lifted row — ties → suppressed; `'all'` latch; stamps lead only when applying); NEW `apply_mktr_lead_unsuppression` (row missing → INSERT lifted pre-arrival hold; `'all'`/stale → no-op; strictly newer → state='lifted' + clear lead marketing-scope columns + activity). Rows are NEVER deleted — the watermark must survive repairs. EF: `'lead.unsuppressed'` allowlisted + handler; arrival hook stamps only from `state='suppressed'`. Badge/gate clear automatically (columns null).

**Full v2 SQL as applied (lyfe-app `supabase/migrations/20260722110000_mktr_lead_unsuppression.sql`):**

```sql
-- lead.unsuppressed consumer support + watermark rework (resubscribe lift,
-- contract §6 — mktr-platform/docs/reference/webhook-propagation-contract.md).
--
-- v2 of the suppression state model (Codex resub-round #2): the tombstone is
-- now a PERSISTENT per-lead state row — never deleted — carrying
-- state ('suppressed'|'lifted') + the occurred_at WATERMARK. Deleting it on
-- lift would destroy the watermark, letting a repaired delivery of an OLDER
-- lead.suppressed re-suppress a lifted person forever, and discarding lifts
-- that arrive before their suppression. Merge rules:
--   - scope 'all' (erasure) is a latch: marketing events never touch it;
--   - suppression applies when strictly newer, OR on an equal watermark when
--     the row is lifted (ties resolve toward suppressed — fail-safe);
--   - lift applies only when strictly newer, and INSERTS a lifted row when
--     none exists (the pre-arrival watermark hold);
--   - lead columns stamp only from a resulting suppressed state; lifts clear
--     marketing-scope columns only.
-- Idempotent throughout; safe under db push after MCP apply.

ALTER TYPE public.lead_activity_type ADD VALUE IF NOT EXISTS 'resubscribed';

ALTER TABLE public.mktr_lead_suppressions
  ADD COLUMN IF NOT EXISTS state text NOT NULL DEFAULT 'suppressed';
DO $$ BEGIN
  ALTER TABLE public.mktr_lead_suppressions
    ADD CONSTRAINT chk_mls_state CHECK (state IN ('suppressed', 'lifted'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- v2 suppression merge (replaces 20260721160000's version).
CREATE OR REPLACE FUNCTION public.apply_mktr_lead_suppression(
  p_source_name text, p_external_id text, p_scope text, p_reason text,
  p_occurred_at timestamptz, p_delivery_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_t mktr_lead_suppressions%ROWTYPE; v_lead leads%ROWTYPE;
        v_apply boolean := false; v_found boolean := false; v_changed boolean := false;
BEGIN
  -- Insert-or-LOCK claim (Codex resub-round-3 #1): a fresh insert returns the
  -- row (we hold its lock for this txn); otherwise lock the existing row FOR
  -- UPDATE so every per-lead merge — including concurrent unordered
  -- deliveries — serializes here. Decisions below run against the LOCKED row.
  INSERT INTO mktr_lead_suppressions
    (source_name, external_id, scope, reason, occurred_at, delivery_id, state)
  VALUES (p_source_name, p_external_id, p_scope, p_reason, p_occurred_at, p_delivery_id, 'suppressed')
  ON CONFLICT (source_name, external_id) DO NOTHING
  RETURNING * INTO v_t;
  IF FOUND THEN
    v_apply := true;
  ELSE
    SELECT * INTO v_t FROM mktr_lead_suppressions
     WHERE source_name = p_source_name AND external_id = p_external_id
     FOR UPDATE;
  END IF;
  IF v_apply THEN
    NULL; -- fresh insert: applied
  ELSIF v_t.scope = 'all' THEN
    -- Latch: an erasure row never downgrades. Same-scope 'all' refreshes the
    -- watermark forward only.
    IF p_scope = 'all' AND p_occurred_at > v_t.occurred_at THEN
      UPDATE mktr_lead_suppressions
         SET reason = p_reason, occurred_at = p_occurred_at,
             delivery_id = p_delivery_id, updated_at = now()
       WHERE source_name = p_source_name AND external_id = p_external_id;
    END IF;
    v_apply := false; -- lead already latched; no re-stamp needed
  ELSIF p_scope = 'all' THEN
    -- Erasure outranks any marketing state regardless of timestamps.
    UPDATE mktr_lead_suppressions
       SET scope = 'all', state = 'suppressed', reason = p_reason,
           occurred_at = p_occurred_at, delivery_id = p_delivery_id, updated_at = now()
     WHERE source_name = p_source_name AND external_id = p_external_id;
    v_apply := true;
  ELSIF p_occurred_at > v_t.occurred_at
        OR (p_occurred_at = v_t.occurred_at AND v_t.state = 'lifted') THEN
    -- Marketing vs marketing: strictly newer wins; ties resolve toward
    -- suppressed (fail-safe direction).
    UPDATE mktr_lead_suppressions
       SET state = 'suppressed', reason = p_reason,
           occurred_at = p_occurred_at, delivery_id = p_delivery_id, updated_at = now()
     WHERE source_name = p_source_name AND external_id = p_external_id;
    v_apply := true;
  END IF;

  IF v_apply THEN
    SELECT * INTO v_lead FROM leads
     WHERE external_id = p_external_id AND source_name = p_source_name;
    v_found := FOUND;
    IF v_found THEN
      UPDATE leads SET
        do_not_contact_at = COALESCE(do_not_contact_at, p_occurred_at),
        do_not_contact_scope = CASE
          WHEN do_not_contact_scope = 'all' THEN 'all' ELSE p_scope END,
        updated_at = now()
       WHERE id = v_lead.id
         AND (do_not_contact_at IS NULL
              OR (do_not_contact_scope IS DISTINCT FROM 'all' AND p_scope = 'all')
              OR do_not_contact_scope IS NULL);
      v_changed := FOUND;
      IF v_changed THEN
        INSERT INTO lead_activities (lead_id, user_id, type, description, metadata)
        VALUES (v_lead.id, v_lead.created_by, 'suppressed',
                'Do-not-contact from MKTR (' || p_scope || ')',
                jsonb_build_object('source', 'mktr', 'delivery_id', p_delivery_id,
                                   'reason', p_reason, 'scope', p_scope));
      END IF;
    END IF;
  END IF;
  RETURN jsonb_build_object('applied', v_apply, 'lead_found', v_found, 'changed', v_changed);
END $$;

-- The lift.
CREATE OR REPLACE FUNCTION public.apply_mktr_lead_unsuppression(
  p_source_name text, p_external_id text, p_occurred_at timestamptz, p_delivery_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_t mktr_lead_suppressions%ROWTYPE; v_lead leads%ROWTYPE;
        v_found boolean := false; v_changed boolean := false;
BEGIN
  -- Insert-or-LOCK claim (Codex resub-round-3 #1): fresh insert = the
  -- pre-arrival watermark hold (an older suppression delivery can no longer
  -- re-apply later); otherwise the merge runs against the FOR-UPDATE-locked
  -- row, serializing concurrent unordered deliveries.
  INSERT INTO mktr_lead_suppressions
    (source_name, external_id, scope, reason, occurred_at, delivery_id, state)
  VALUES (p_source_name, p_external_id, 'marketing', 'resubscribe', p_occurred_at, p_delivery_id, 'lifted')
  ON CONFLICT (source_name, external_id) DO NOTHING
  RETURNING * INTO v_t;
  IF FOUND THEN
    RETURN jsonb_build_object('applied', true, 'lead_found', false, 'changed', false);
  END IF;
  SELECT * INTO v_t FROM mktr_lead_suppressions
   WHERE source_name = p_source_name AND external_id = p_external_id
   FOR UPDATE;
  IF v_t.scope <> 'marketing' OR p_occurred_at <= v_t.occurred_at THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'latched_or_stale');
  END IF;

  UPDATE mktr_lead_suppressions
     SET state = 'lifted', reason = 'resubscribe',
         occurred_at = p_occurred_at, delivery_id = p_delivery_id, updated_at = now()
   WHERE source_name = p_source_name AND external_id = p_external_id;

  SELECT * INTO v_lead FROM leads
   WHERE external_id = p_external_id AND source_name = p_source_name;
  v_found := FOUND;
  IF v_found AND v_lead.do_not_contact_scope = 'marketing' THEN
    UPDATE leads SET
      do_not_contact_at = NULL,
      do_not_contact_scope = NULL,
      updated_at = now()
     WHERE id = v_lead.id;
    v_changed := true;
    INSERT INTO lead_activities (lead_id, user_id, type, description, metadata)
    VALUES (v_lead.id, v_lead.created_by, 'resubscribed',
            'Person re-consented via MKTR — marketing contact allowed again',
            jsonb_build_object('source', 'mktr', 'delivery_id', p_delivery_id));
  END IF;
  RETURN jsonb_build_object('applied', true, 'lead_found', v_found, 'changed', v_changed);
END $$;

REVOKE ALL ON FUNCTION public.apply_mktr_lead_suppression(text, text, text, text, timestamptz, uuid)
  FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_mktr_lead_unsuppression(text, text, timestamptz, uuid)
  FROM anon, authenticated;
```
