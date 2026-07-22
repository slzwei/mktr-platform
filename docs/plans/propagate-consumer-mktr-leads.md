# lead.suppressed consumer plan — mktr-leads (for Shawn to apply in mktr-leads)

**Contract:** `docs/reference/webhook-propagation-contract.md` (mktr-platform repo). Emitter LIVE-dark; `MKTR_LEADS_LEAD_SUPPRESSED_ENABLED` stays false until step 5.
**Anchors mapped 2026-07-21 — RE-VERIFY in-repo** (receiver: `supabase/functions/receive-mktr-lead/index.ts`; deletion precedent: `supabase/migrations/20260701000000_mktr_lead_deletion.sql`). Deploys via `supabase db push` + `functions deploy` (no write creds in .env — Shawn runs those).

## 1. Migration — v1, APPLIED 2026-07-22, **SUPERSEDED by §6's v2** (do not re-apply this SQL: unconditional merge + no state column — Codex resub-round-2 #3). NOTE: the SQL below was a pre-apply draft — the APPLIED v1 (repo migration 20260721170000) uses `delivery_id text` and `p_delivery_id text` throughout, prod-verified via pg_get_function_identity_arguments, so §6's text signature REPLACES v1 (no overload — Codex resub-round-3 #2 was a doc artifact).

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

## 6. Resubscribe lift (v3, 2026-07-22) — APPLIED

Contract §6 v2 (state rows — Codex resub-round #2). Migration `20260722113000`: `mktr_lead_suppressions.state` column; `apply_dnc_tombstone` trigger v2 (stamps only from `state='suppressed'` — a lifted row is a watermark hold); `process_mktr_lead_suppression` v2 (claim + strictly-newer/tie-toward-suppressed merge, `'all'` latch); NEW `process_mktr_lead_unsuppression` (claim; row missing → INSERT lifted hold; strictly newer → lift + clear marketing columns + activity). Rows NEVER deleted. wa_intro resumes automatically for lifted people (new leads born unstamped). EF: `'lead.unsuppressed'` allowlisted + handler.

**Full v2 SQL as applied (mktr-leads `supabase/migrations/20260722113000_mktr_lead_unsuppression.sql`):**

```sql
-- ============================================================================
-- lead.unsuppressed consumer + watermark rework (resubscribe lift, contract §6
-- v2 — mktr-platform/docs/reference/webhook-propagation-contract.md).
-- ----------------------------------------------------------------------------
-- The tombstone becomes a PERSISTENT per-lead state row (never deleted):
-- state 'suppressed'|'lifted' + the occurred_at WATERMARK. Deleting on lift
-- would destroy the watermark and let a REPAIRED older lead.suppressed
-- re-suppress a lifted person forever (Codex resub-round #2). Merge rules:
--   - scope 'all' (erasure) is a latch: marketing events never touch it;
--   - suppression applies when strictly newer OR on an equal watermark when
--     the row is lifted (ties resolve toward suppressed — fail-safe);
--   - lift applies only when strictly newer, and INSERTS a lifted row when
--     none exists (pre-arrival watermark hold);
--   - the BEFORE-INSERT stamping trigger stamps only from state='suppressed'
--     (a lifted row is a watermark hold, not a suppression);
--   - wa_intro skip is driven by the stamped lead columns, so lifted people
--     get intros again automatically.
-- ============================================================================

alter table public.mktr_lead_suppressions
    add column if not exists state text not null default 'suppressed';
do $$ begin
    alter table public.mktr_lead_suppressions
        add constraint chk_mls_state check (state in ('suppressed', 'lifted'));
exception when duplicate_object then null; end $$;

-- Stamping trigger v2: only a SUPPRESSED state row stamps fresh leads.
create or replace function public.apply_dnc_tombstone()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_t public.mktr_lead_suppressions%rowtype;
begin
    if new.source_name is null or new.external_id is null then
        return new;
    end if;
    select * into v_t
      from public.mktr_lead_suppressions t
     where t.source_name = new.source_name and t.external_id = new.external_id;
    if found and v_t.state = 'suppressed' then
        new.do_not_contact_at := coalesce(new.do_not_contact_at, v_t.occurred_at);
        new.do_not_contact_scope := case
            when new.do_not_contact_scope = 'all' then 'all'
            else v_t.scope end;
    end if;
    return new;
end;
$$;

-- v2 suppression merge (replaces 20260721170000's version). Keeps the
-- transport-dedup claim; adds the watermarked state-row semantics.
create or replace function public.process_mktr_lead_suppression(
    p_source_name text,
    p_external_id text,
    p_scope text,
    p_reason text,
    p_occurred_at timestamptz,
    p_delivery_id text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
    v_claimed int;
    v_t public.mktr_lead_suppressions%rowtype;
    v_lead public.leads%rowtype;
    v_apply boolean := false;
    v_found boolean := false;
    v_changed boolean := false;
begin
    insert into public.processed_deliveries (delivery_id, event_type, lead_id)
    values (p_delivery_id, 'lead.suppressed', null)
    on conflict (delivery_id) do nothing;
    get diagnostics v_claimed = row_count;
    if v_claimed = 0 then
        return jsonb_build_object('status', 'duplicate');
    end if;

    -- Insert-or-LOCK claim (Codex resub-round-3 #1): fresh insert returns the
    -- row (locked for this txn); otherwise FOR UPDATE serializes every
    -- per-lead merge across concurrent unordered deliveries.
    insert into public.mktr_lead_suppressions
        (source_name, external_id, scope, reason, occurred_at, delivery_id, state)
    values (p_source_name, p_external_id, p_scope, p_reason, p_occurred_at, p_delivery_id, 'suppressed')
    on conflict (source_name, external_id) do nothing
    returning * into v_t;
    if found then
        v_apply := true;
    else
        select * into v_t from public.mktr_lead_suppressions
         where source_name = p_source_name and external_id = p_external_id
         for update;
    end if;
    if v_apply then
        null; -- fresh insert: applied
    elsif v_t.scope = 'all' then
        if p_scope = 'all' and p_occurred_at > v_t.occurred_at then
            update public.mktr_lead_suppressions
               set reason = p_reason, occurred_at = p_occurred_at,
                   delivery_id = p_delivery_id, updated_at = now()
             where source_name = p_source_name and external_id = p_external_id;
        end if;
        v_apply := false; -- latched; lead already stamped
    elsif p_scope = 'all' then
        update public.mktr_lead_suppressions
           set scope = 'all', state = 'suppressed', reason = p_reason,
               occurred_at = p_occurred_at, delivery_id = p_delivery_id, updated_at = now()
         where source_name = p_source_name and external_id = p_external_id;
        v_apply := true;
    elsif p_occurred_at > v_t.occurred_at
          or (p_occurred_at = v_t.occurred_at and v_t.state = 'lifted') then
        update public.mktr_lead_suppressions
           set state = 'suppressed', reason = p_reason,
               occurred_at = p_occurred_at, delivery_id = p_delivery_id, updated_at = now()
         where source_name = p_source_name and external_id = p_external_id;
        v_apply := true;
    end if;

    if v_apply then
        select * into v_lead from public.leads
         where source_name = p_source_name and external_id = p_external_id;
        v_found := found;
        if v_found then
            update public.leads set
                do_not_contact_at = coalesce(do_not_contact_at, p_occurred_at),
                do_not_contact_scope = case
                    when do_not_contact_scope = 'all' then 'all' else p_scope end,
                updated_at = now()
             where id = v_lead.id
               and (do_not_contact_at is null
                    or (do_not_contact_scope is distinct from 'all' and p_scope = 'all')
                    or do_not_contact_scope is null);
            v_changed := found;
            if v_changed then
                insert into public.lead_activities (lead_id, user_id, type, description, metadata)
                values (v_lead.id, null, 'suppressed',
                        'Do-not-contact from MKTR (' || p_scope || ')',
                        jsonb_build_object('source', 'mktr', 'delivery_id', p_delivery_id,
                                           'reason', p_reason, 'scope', p_scope));
            end if;
        end if;
    end if;
    return jsonb_build_object('status', 'applied', 'applied', v_apply,
                              'lead_found', v_found, 'changed', v_changed);
end;
$$;

-- The lift.
create or replace function public.process_mktr_lead_unsuppression(
    p_source_name text,
    p_external_id text,
    p_occurred_at timestamptz,
    p_delivery_id text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
    v_claimed int;
    v_t public.mktr_lead_suppressions%rowtype;
    v_lead public.leads%rowtype;
    v_found boolean := false;
    v_changed boolean := false;
begin
    insert into public.processed_deliveries (delivery_id, event_type, lead_id)
    values (p_delivery_id, 'lead.unsuppressed', null)
    on conflict (delivery_id) do nothing;
    get diagnostics v_claimed = row_count;
    if v_claimed = 0 then
        return jsonb_build_object('status', 'duplicate');
    end if;

    -- Insert-or-LOCK claim (Codex resub-round-3 #1): fresh insert = the
    -- pre-arrival watermark hold; otherwise the merge runs on the locked row.
    insert into public.mktr_lead_suppressions
        (source_name, external_id, scope, reason, occurred_at, delivery_id, state)
    values (p_source_name, p_external_id, 'marketing', 'resubscribe', p_occurred_at, p_delivery_id, 'lifted')
    on conflict (source_name, external_id) do nothing
    returning * into v_t;
    if found then
        return jsonb_build_object('status', 'applied', 'applied', true,
                                  'lead_found', false, 'changed', false);
    end if;
    select * into v_t from public.mktr_lead_suppressions
     where source_name = p_source_name and external_id = p_external_id
     for update;
    if v_t.scope <> 'marketing' or p_occurred_at <= v_t.occurred_at then
        return jsonb_build_object('status', 'applied', 'applied', false, 'reason', 'latched_or_stale');
    end if;

    update public.mktr_lead_suppressions
       set state = 'lifted', reason = 'resubscribe',
           occurred_at = p_occurred_at, delivery_id = p_delivery_id, updated_at = now()
     where source_name = p_source_name and external_id = p_external_id;

    select * into v_lead from public.leads
     where source_name = p_source_name and external_id = p_external_id;
    v_found := found;
    if v_found and v_lead.do_not_contact_scope = 'marketing' then
        update public.leads set
            do_not_contact_at = null,
            do_not_contact_scope = null,
            updated_at = now()
         where id = v_lead.id;
        v_changed := true;
        insert into public.lead_activities (lead_id, user_id, type, description, metadata)
        values (v_lead.id, null, 'resubscribed',
                'Person re-consented via MKTR — marketing contact allowed again',
                jsonb_build_object('source', 'mktr', 'delivery_id', p_delivery_id));
    end if;
    return jsonb_build_object('status', 'applied', 'applied', true,
                              'lead_found', v_found, 'changed', v_changed);
end;
$$;

revoke execute on function public.process_mktr_lead_unsuppression(text, text, timestamptz, text)
    from public, anon, authenticated;
```
