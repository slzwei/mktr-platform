# Wave 0 — Shawn's runbook (the parts I can't do)

Everything code/merge/flag/migration in Wave 0 is done and deployed (see the execution log in
`remaining-buildout-plan-2026-07.md`). These remaining items need your credentials, a real device, or
a decision. Ordered by priority. **Read the ⚠️ boxes — two of these can brick prod if done wrong.**

## 1. ⚠️ Deploy the hardened SMS hook (SEC-02) — CAN BRICK ALL LOGINS

The hardened `custom-sms-hook` is merged but **NOT deployed** (the deployed one is still the old unsigned
version). The new one **fail-closes**: if `SEND_SMS_HOOK_SECRET` is missing/malformed it returns 500 for
**every** login OTP.

Order matters:
1. In the Supabase dashboard (project `rciuejxgziqxrwtifpbo`) → Auth → Hooks, copy the **Send SMS hook
   secret**. It looks like `v1,whsec_<base64>`. Keep the exact `v1,whsec_` prefix.
2. Set it as an EF secret **before** deploying: `supabase secrets set SEND_SMS_HOOK_SECRET='v1,whsec_…'`
   (project `rciuejxgziqxrwtifpbo`). A wrong secret does not error loudly — it silently 401s every OTP.
3. Deploy: `supabase functions deploy custom-sms-hook`.
4. **Go/no-go test = a REAL login, not a curl.** Trigger an OTP from the app (or a whitelisted number) and
   confirm the code actually arrives on WhatsApp. "Unsigned POST → 401" is NOT sufficient proof — a wrong
   secret also 401s, so only a real signed OTP round-trip proves the secret is right.
5. **Never** `supabase config push` on this project — it disables phone-auth/the SMS hook (config is managed
   in the dashboard, out of git; see `supabase/config.toml:4`).

Rollback if logins break: unset/fix the secret and redeploy, or redeploy the previous function version.

## 2. ⚠️ Close the webhook replay boundary (SEC-03 completion) — CAN STOP PAID DELIVERY

What's live now: the hardened receiver (delivery-ID binding — Step A) + the metadata-gated v2 sender. This
is **not** the full fix yet: the receiver still accepts v1 (body-only HMAC, unsigned timestamp), so a
captured body+signature can still be replayed with a fresh timestamp. The boundary closes only when the
**mktr-leads subscriber** is flipped to v2.

1. First inventory subscribers (don't copy secrets): confirm there are two — `Lyfe App` (`metadata.destination='lyfe'`)
   and `MKTR Leads App` (`metadata.destination='mktr_leads'`), and note their current `metadata.signatureVersion`
   (should be absent = v1 on both).
2. Flip **only** the mktr-leads row: set its `metadata.signatureVersion = 'v2'` (leave `Lyfe App` alone — its
   receiver is still v1-only and would break).
3. Watch: the `MKTR Leads App` subscriber must keep delivering. **50 consecutive failures auto-disable it**
   (silent) — if it flips to disabled, revert the metadata immediately (rollback = unset `signatureVersion`,
   no redeploy) and re-enable the subscriber.
4. Correct acceptance test: a captured body with a **substituted timestamp/delivery-id** is rejected, while a
   legitimate **same-delivery retry still dedupes successfully** (200). Don't test "any replay 404s" — real
   retries are supposed to succeed.
5. (Later, separate step) once v2 is proven on mktr-leads traffic, a v2-only receiver can drop v1 acceptance
   to fully kill timestamp replay.

## 3. Confirm the admin-lead-ops fix end-to-end

`ADMIN_LEAD_OPS_EXTERNAL_ENABLED=true` is set and the route now mounts (401 instead of 404). That mounts the
route; it doesn't prove the whole path. `MKTR_ADMIN_LEAD_OPS_URL` is present in the mktr-leads EF secrets, so
it should be whole — confirm by doing an actual **Reassign / Return-to-queue** from the admin app on a held
lead and seeing it land. If the broker 500s, the EF's `MKTR_ADMIN_LEAD_OPS_URL` is wrong.

## 4. Store content — swap the S$1 Test Pack for real packages

The app's Lead Store currently shows the S$1 Test Pack (`37cdc291-c02f-46ce-8aab-2b10d91a2ff7`). Before
onboarding real agents:
1. Grab `DB_PASSWORD` fresh from Render → `mktr-backend-jo6r` env.
2. `DB_PASSWORD=… node backend/scripts/seed-campaign-store-content.mjs --check` (confirms migration 044 landed),
   then `--list` (campaigns + package counts + gift/notes state), then `--apply <campaignId>` for the real
   campaign(s). Set the gift price with `--gift-price <S$>` when known.
3. Archive the Test Pack — that's a manual SQL `UPDATE lead_packages SET is_active=false, is_public=false WHERE
   id='37cdc291-…'` (the seed script does content, not package archiving).
4. Verify on-device that real packages render and the test pack is gone.

## 5. Confirm a flag value

`HELD_LEAD_PING_ENABLED` — the `lead.held` admin-ping to the mktr-leads fleet is behind this flag (default
false). If you want held-lead pings reaching the app's held queue, set it true on `mktr-backend-jo6r`; if not,
leave it. (The app's held-queue screen exists; this just decides whether pings fire.)

## 6. Phase-0 baseline checks to record before Wave 1 (from the remediation preflight)

Not blocking, but do these read-only checks before the Wave 1 hardening so the invariants are grounded in prod
reality (all currently marked TODO in `mktr-leads/docs/REMEDIATION_PREFLIGHT.md`):
- Confirm PostgREST `db-max-rows` for `rciuejxgziqxrwtifpbo` (the plan assumes 1,000 — this sets where the
  SCALE-01 pagination cutoffs bite).
- Census duplicate non-null `agents.push_token` values (input for the future single-owner index dedupe).
- Confirm both live 1.1.0 bundles actually call `register_push_token` (by bundle content, not commit ancestry)
  — this is the precondition the applied `20260711020000` migration assumed.

---

Once 1–4 are green, the external-agent loop is fully safe to run. Trial-reward campaigns for external agents
should stay on `on_capture` unlock policy (verify `REDEEM_OPS_ENABLED` + `REDEEM_OPS_ENTITLEMENTS_ENABLED` are
both on) until the Wave 2 scan/unlock screens ship in the 1.2.0 binary.
