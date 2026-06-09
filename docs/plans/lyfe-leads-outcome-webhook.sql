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
-- It mirrors the proven user-sync trigger `20260504150000_users_change_webhook_to_mktr.sql`
-- (`users_notify_mktr`): pg_net.http_post + HMAC-SHA256 over the body, secrets
-- read from Supabase Vault. Align the body serialization with that existing
-- trigger — the MKTR receiver verifies the HMAC over the exact bytes pg_net
-- transmits (req.rawBody), so what we sign MUST equal what is sent.
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
  -- idempotent (sourceMetadata.capi marker) so a re-fire is a clean no-op.
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

  -- Resolve secrets from Vault (mirrors users_notify_mktr).
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

  -- Sign the exact text pg_net will transmit. jsonb::text uses Postgres's
  -- canonical jsonb output, which is what pg_net sends for a jsonb body.
  v_body := v_payload::text;
  v_sig  := encode(extensions.hmac(v_body, v_secret, 'sha256'), 'hex');

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

  return new;
end;
$$;

drop trigger if exists leads_notify_mktr_outcome on public.leads;

create trigger leads_notify_mktr_outcome
  after update of status on public.leads
  for each row
  execute function public.leads_notify_mktr_outcome();
