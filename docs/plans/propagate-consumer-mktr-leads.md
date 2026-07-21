# lead.suppressed consumer plan — mktr-leads (for Shawn to apply in mktr-leads)

**Contract:** `docs/reference/webhook-propagation-contract.md` (mktr-platform repo). Emitter LIVE-dark; `MKTR_LEADS_LEAD_SUPPRESSED_ENABLED` stays false until step 5.
**Anchors mapped 2026-07-21 — RE-VERIFY in-repo** (receiver: `supabase/functions/receive-mktr-lead/index.ts`; deletion precedent: `supabase/migrations/20260701000000_mktr_lead_deletion.sql`). Deploys via `supabase db push` + `functions deploy` (no write creds in .env — Shawn runs those).

## 1. Migration (follow the deletion-RPC precedent exactly)

```sql
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS do_not_contact_at timestamptz,
  ADD COLUMN IF NOT EXISTS do_not_contact_scope text
    CHECK (do_not_contact_scope IN ('marketing','all') OR do_not_contact_scope IS NULL);

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
-- Service-role only: ENFORCED like deleted_lead_sources (Codex diff-round #10).
ALTER TABLE mktr_lead_suppressions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON mktr_lead_suppressions FROM anon, authenticated;

CREATE OR REPLACE FUNCTION process_mktr_lead_suppression(
  p_source_name text, p_external_id text, p_scope text, p_reason text,
  p_occurred_at timestamptz, p_delivery_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_lead leads%ROWTYPE; v_found boolean := false; v_changed boolean := false;
BEGIN
  -- Claim the delivery id first (processed_deliveries PK) — TRANSPORT dedup
  -- only. Repairs mint NEW delivery ids, so lead effects below must be
  -- EFFECT-idempotent too (Codex diff-round #8): they fire only when the
  -- merged state actually changes.
  INSERT INTO processed_deliveries (delivery_id) VALUES (p_delivery_id)
  ON CONFLICT (delivery_id) DO NOTHING;
  IF NOT FOUND THEN RETURN jsonb_build_object('duplicate', true); END IF;

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
   WHERE source_name = p_source_name AND external_id = p_external_id;
  v_found := FOUND;
  IF v_found THEN
    UPDATE leads SET
      do_not_contact_at = COALESCE(do_not_contact_at, p_occurred_at),
      do_not_contact_scope = CASE WHEN do_not_contact_scope = 'all' THEN 'all' ELSE p_scope END,
      updated_at = now()
     WHERE id = v_lead.id
       AND (do_not_contact_at IS NULL
            OR (do_not_contact_scope IS DISTINCT FROM 'all' AND p_scope = 'all'));
    v_changed := FOUND;
    IF v_changed THEN
      INSERT INTO lead_activities (lead_id, user_id, type, description, metadata)
      VALUES (v_lead.id, NULL, 'suppressed',
              'Do-not-contact from MKTR (' || p_scope || ')',
              jsonb_build_object('delivery_id', p_delivery_id, 'reason', p_reason, 'scope', p_scope));
    END IF;
  END IF;
  RETURN jsonb_build_object('lead_found', v_found, 'changed', v_changed);
END $$;
REVOKE ALL ON FUNCTION process_mktr_lead_suppression FROM anon, authenticated;
```

(`lead_activities.type` is free text here — no enum migration needed, unlike lyfe.)

## 2. Edge function

1. `SUPPORTED_EVENTS` (index.ts:101) gains `'lead.suppressed'`.
2. Handler: after the shared verify/guard chain (v1+v2 signatures, deliveryId header↔body binding, 256KB cap, fast-path dedup — all already generic), validate `data.suppression` per contract §3.2 and call `process_mktr_lead_suppression`. 200 always on success paths incl. `lead_found:false` (tombstone).
3. **Lead-arrival hook**: the creation RPC (`20260717010000_mktr_lead_creation_rpc.sql`) additionally consults `mktr_lead_suppressions` — if a tombstone exists for `(source_name, external_id)`: stamp the new lead's `do_not_contact_*` AND **skip `enqueue_wa_intro`** (Codex #20 — a suppressed person's later lead must not fire create-time outreach). Scope `marketing` also skips wa_intro (it is marketing-adjacent outreach); scope `all` skips everything.
   Note: the existing tombstone short-circuit for DELETED sources (index.ts:188-203) stays as-is — deletion outranks suppression.

## 3. App surface

- Board + detail (`app/(tabs)/leads/*`, data via `lib/leads.ts` — rows already carry all columns): DNC badge (scope `all` red / `marketing` amber). Gate contact affordances on detail for scope `all`; warn for `marketing`. Status flow untouched (`invalid`/`disputed` remain quality states, not consent states).

## 4. Synthetic verification (BEFORE the mktr flip)

mktr-leads verifies v1 AND v2; its subscriber is v1 today — test v1 exactly: sign body-only HMAC, include `X-Webhook-Delivery-Id` equal to body `deliveryId` (the guard binds them). Assert: 200 + tombstone; same-delivery re-POST → `{duplicate:true}`; NEW delivery id, same person → state unchanged except merge rules; synthetic `lead.created` after tombstone → lead lands flagged + wa_intro skipped.

## 5. Go-live

Flip `MKTR_LEADS_LEAD_SUPPRESSED_ENABLED=true` on the mktr backend Render service; boot adds the event to the 'MKTR Leads App' subscriber + backfills dark-period pairs. Verify per contract §5.4. (mktr-leads already handles `lead.deleted`, so erasures continue arriving as deletions — this event adds the unsubscribe/marketing layer.)
