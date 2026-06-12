-- =============================================================================
-- REFERENCE ONLY — apply this in the `lyfe-app` repo, NOT here.
-- =============================================================================
-- This file documents the Lyfe Supabase side of the down-funnel CAPI feature
-- (see docs/plans/ in mktr-platform and CLAUDE.md "Down-funnel CAPI events").
-- `lyfe-app` is a separate repository and is not checked out in the MKTR
-- session, so this trigger is authored here for reference and must be copied
-- into the canonical migrations dir when implemented:
--
--   lyfe-app/supabase/migrations/<timestamp>_leads_outcome_webhook_to_mktr.sql
--
-- Modeled on the proven user-sync trigger `20260504150000_users_change_webhook_to_mktr.sql`
-- (`users_notify_mktr`): pg_net.http_post + HMAC-SHA256, secrets from Supabase
-- Vault. Two deliberate differences from that trigger:
--   1. The HMAC covers `timestamp || '.' || body` (not body alone) so the
--      timestamp is authenticated — the MKTR receiver verifies the SAME over
--      `X-Webhook-Timestamp + "." + req.rawBody`, blocking replay with a fresh
--      timestamp.
--   2. The dispatch is wrapped in BEGIN/EXCEPTION so a webhook/Vault/HTTP hiccup
--      can NEVER roll back the agent's status UPDATE.
--
-- BYTE-ALIGNMENT (critical): the receiver verifies the HMAC over the exact bytes
-- pg_net transmits (req.rawBody). Current supabase/pg_net `http_post(body jsonb)`
-- queues `convert_to(body::text,'UTF8')`, so signing `v_payload::text` and
-- sending `body := v_payload` is byte-aligned (UTF-8 DB encoding). Keep building
-- `v_payload` once. Add a staging smoke test that logs expected-vs-received body
-- hash before trusting this in production.
--
-- Vault secrets to create first (Supabase → Project Settings → Vault):
--   mktr_lead_outcome_url     = https://api.mktr.sg/api/integrations/lyfe/lead-outcome
--   mktr_lead_outcome_secret  = <same value as LYFE_LEAD_OUTCOME_SECRET on MKTR>
--
-- Required extensions (already enabled in Lyfe for the user-sync trigger):
--   pg_net      (net.http_post)
--   pgcrypto    (hmac / encode)  — exposed as extensions.hmac in Supabase
-- =============================================================================

create or replace function public.leads_notify_mktr_outcome()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, net, vault
as $$
declare
  v_url     text;
  v_secret  text;
  v_payload jsonb;
  v_body    text;
  v_sig     text;
  v_ts      text;
begin
  -- Fire only on the first transition INTO a tracked status, for MKTR-origin
  -- leads. A toggle back out and in re-enters here, but the MKTR receiver is
  -- idempotent (sourceMetadata.capi marker + deterministic event_id) so a
  -- re-fire is a clean no-op.
  if tg_op <> 'UPDATE' then
    return new;
  end if;
  if new.status is not distinct from old.status then
    return new;
  end if;
  if new.status not in ('qualified', 'won') then
    return new;
  end if;
  if new.source_name is distinct from 'mktr' then
    return new;
  end if;

  -- Everything below is best-effort notification; it must NEVER block or roll
  -- back the agent's status update. Any failure (Vault, hmac, http_post) is
  -- swallowed with a warning; the reconciliation backfill on MKTR is the safety
  -- net for a dropped notification.
  begin
    select decrypted_secret into v_url
      from vault.decrypted_secrets where name = 'mktr_lead_outcome_url';
    select decrypted_secret into v_secret
      from vault.decrypted_secrets where name = 'mktr_lead_outcome_secret';

    if v_url is null or v_secret is null then
      raise warning '[leads_notify_mktr_outcome] missing vault secret(s); skipping';
      return new;
    end if;

    v_ts := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');

    -- external_id is the MKTR prospect id stored on the lead when it was ingested.
    v_payload := jsonb_build_object(
      'external_id', new.external_id,
      'lead_id',     new.id,
      'new_status',  new.status,
      'old_status',  old.status,
      'agent_id',    new.assigned_to,
      'occurred_at', v_ts
    );

    -- Sign timestamp || '.' || body. v_body is the canonical jsonb text, which is
    -- the exact byte sequence pg_net transmits for `body := v_payload` (see
    -- BYTE-ALIGNMENT note above). The MKTR receiver verifies the same.
    v_body := v_payload::text;
    v_sig  := encode(extensions.hmac(v_ts || '.' || v_body, v_secret, 'sha256'), 'hex');

    perform net.http_post(
      url     := v_url,
      body    := v_payload,
      params  := '{}'::jsonb,
      headers := jsonb_build_object(
        'Content-Type',        'application/json',
        'X-Webhook-Signature', 'sha256=' || v_sig,
        'X-Webhook-Timestamp', v_ts
      ),
      timeout_milliseconds := 5000
    );
  exception when others then
    raise warning '[leads_notify_mktr_outcome] dispatch failed: %', sqlerrm;
  end;

  return new;
end;
$$;

drop trigger if exists leads_notify_mktr_outcome on public.leads;

create trigger leads_notify_mktr_outcome
  after update of status on public.leads
  for each row
  execute function public.leads_notify_mktr_outcome();
