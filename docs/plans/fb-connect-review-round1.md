# Connect Facebook backend — codex round 1 worklist (2026-08-08)

**Verdict: not ship-ready.** Happy path works; restart/fencing/credential-
custody/lifecycle paths can strand or misroute. Fix ALL below before PR.
(Original review: session artifact; evidence line numbers are pre-rebase.)
Finding 14's "label regression" sub-claim was a STALE-BASE artifact — branch
now rebased onto #434; the rest of 14 stands.

## Critical
1. **Reauth treats the new OAuth code as a user token.** startConnect keeps
   `fbUserIdAppScoped` → processConnection assumes sealed value is a token.
   FIX: explicit secret PHASE (`oauth_code` | `long_token`) on the row (new
   column `secretKind`); reauth is its own journey that only swaps
   credentials on success; denial on reauth returns to `connected`, never
   `failed`-orphaning live assets; disconnect must also find non-live rows'
   assets.
2. **Exchange-once isn't crash-safe.** Token persisted only after /me +
   /me/permissions; a crash between exchange and persist re-uses the
   consumed code → permanent fail. FIX: persist the long-lived token
   IMMEDIATELY after exchange (fenced), THEN identity/permissions in a
   separate resumable step; ambiguous exchange failure ⇒ require fresh code
   (fail to reauth_required taxonomy `code_ambiguous`), never re-exchange.
3. **Page not reserved before side effects.** pageId set only at connect;
   partial-unique excludes awaiting; another connection / admin-managed page
   can be overwritten. FIX: fenced-reserve pageId (status provisioning +
   pageId set + unique check) BEFORE subscribe/form/mapping; meta_pages
   upsert must reject rows owned by a DIFFERENT live connection
   (`page_in_use` terminal taxonomy) and never silently take over
   admin-registered (`connectedVia` null) pages without explicit policy;
   include awaiting-with-page in the partial unique.
4. **Disconnect/worker race.** Wiring writes aren't fence-checked; disconnect
   updates by id only. FIX: check the claim fence (attempts) before EVERY
   receipt write; disconnect flips status via conditional update and bumps
   attempts (invalidates any in-flight claim); worker on fence loss runs
   cleanup (deactivate page/mapping it just wrote if the row is now
   disconnected).

## High
5. **Live lead fetch lacks appsecret_proof.** metaLeadService fetch uses
   Bearer only → "Require App Secret" setting would dead-letter every lead.
   FIX: add appsecret_proof to the leadgen fetch (derive from page token).
6. **Secrets in query strings/logs.** client_secret/code/tokens ride URLs;
   pino/Sentry see them; redactTokens.js misses these keys. FIX: send OAuth
   exchanges as POST form bodies; access_token via Bearer header everywhere;
   extend redactTokens (code, state, access_token, fb_exchange_token,
   client_secret, appsecret_proof); scrub Sentry spans/breadcrumbs.
7. **No armed latch for OAuth.** ensureMetaOauth failure leaves callable
   surface. FIX: `metaOauthArmed` latch (same pattern as lead pipe);
   start/callback/select/disconnect fail closed (503) until armed.
8. **start/callback races + immortal nonce.** FIX: `stateExpiresAt`
   (10 min) enforced at callback; nonce consume + status flip + code stash
   in ONE conditional UPDATE (status='awaiting_callback' predicate);
   serialize startConnect per user (row lock or upsert-on-conflict);
   duplicate-create unique error → mapped 409.
9. **RESTRICT FK breaks agent-sync hard delete forever.** FIX: sync's
   delete path excludes users with connection rows + deactivation hook
   auto-disconnects live connections; terminal-history policy: on user
   hard-delete, scrub+delete terminal connection rows first (explicit
   service), keep RESTRICT as the backstop.
10. **Scopes/tasks/lead-access stored but not ENFORCED.** FIX: require the
    granted set ⊇ required five; page tasks must include lead access
    (MANAGE/ADVERTISE per Meta semantics); TOS check failure taxonomy
    instead of silent skip (transient transport errors retry; explicit
    false/missing → terminal `leadgen_tos_required` / `page_task_missing`).
11. **Remote-first disconnect black-hole window.** Unsubscribe-then-crash =
    UI says connected, Meta delivers nothing. FIX order: txn-disable local
    intake FIRST (mapping+page inactive, status disconnected, token KEPT),
    then best-effort remote unsubscribe, then wipe token (second update);
    plus a repair sweep: inactive pages still holding tokens → wipe.
12. **Data deletion doesn't delete.** FIX: scrub fbUserIdAppScoped,
    agentMktrUserId, pageId/formId receipts, oauthCodeEnc across ALL
    statuses; disconnect terminal rows' still-active assets too; opaque
    confirmation code (random, stored) not the row PK.

## Medium
13. **waiting_for_agent is a sink holding secrets.** FIX: it re-enters the
    claim query (bounded, longer backoff); on exhaustion → failed + secret
    wipe.
14. **Receipt/mapping trust.** FIX: re-validate receipt QR (type/status/
    campaign/assigned agent) on reuse; form marker = deterministic name AND
    connection check; mapping update refuses rows whose qrTag belongs to a
    different live connection.
15. **Pagination truncation + SSRF via paging.next.** FIX: validate next URL
    host === graph.facebook.com + https; follow via the client (token+proof
    re-applied); cap hit ⇒ throw `pagination_overflow`, never partial.
16. **Taxonomy ignored outside exchange.** FIX: processConnection catches
    GraphError: retryable → rethrow (backoff); permanent 190 →
    reauth_required; permanent 100/10/102 → terminal taxonomy; also make
    client taxonomy per-operation (code 100 permanent for oauth/forms, NOT
    for reads).
17. **Broker/app contract.** FIX: keep the broker route mounted whenever
    META_LEAD_ADS_ENABLED (inner `enabled:false` response when OAuth off);
    status DTO gains `enabled` + `lastLeadAt`; health probe adds
    subscription read-back + scopes drift → reauth_required; admin
    upsertPage refuses reactivating a tombstone without a fresh token
    (`isActive ⇒ token present` invariant).
18. **Config/schema gaps.** FIX: envValidation requires
    META_OAUTH_CALLBACK_ORIGIN explicitly in prod; unify Graph version env
    default (env.example v21 note → v23); model mirrors for the two partial
    uniques (116) + FK; 117 down(): refuse (throw) when NULL-token rows
    exist, else restore NOT NULL.
19. **Test hardening.** Real-DB fence/concurrency tests (two workers, one
    row); exchange-success-then-crash resume; reauth denial keeps
    connected; disconnect-vs-worker; sync hard-delete with connections;
    armed-latch 503s; appsecret_proof asserted on lead fetch; money-shot
    asserts sourceMetadata.utm + proof param; pagination host validation.

---

# Round 2 (2026-08-08) — verdict + disposition

Round-2 codex: 4/19 fully fixed, 14 partial, 5 new findings. Disposition:

**Fixed in the round-2 commit:** NEW-1 disconnect/reconnect ownership race
(teardown reads/wipes conditioned on `meta_pages.connectionId` = ours) ·
NEW-2 sync hard-delete = one txn over the EXACT candidate set (all
predicates incl. live connections; terminal history scrubbed only for real
deletees) · NEW-3 admin tombstone reactivation converts ownership to admin
(live owner → 409) · NEW-4 selectPage conflict patch is status-conditioned ·
NEW-5 117 down() prechecks before any DDL + single txn · round-2 #2
`secretKind:'exchanging'` marks the code consumed BEFORE the token endpoint
(resume ⇒ `code_ambiguous`, never a replay) · #7 HTTP callback answers 503
when unarmed · #10 missing/empty page tasks now terminal · #12 scrub steps
fail LOUD (error log + incomplete marker) · #6 `input_token` added to both
redaction layers. New pins: exchanging-resume, tasks-missing, ownership
no-op disconnect, lead-fetch `appsecret_proof`, callback-latch 503.

**Accepted residuals for flag-off v1** (revisit before Advanced-Access
launch, not before merge): real-DB two-worker/crash test rigs (deployment is
single-instance; logical paths are pinned) · Sentry span/breadcrumb
scrubbers beyond URL redaction (tokens no longer ride URLs) · per-operation
Graph taxonomy splits (all client ops are our own writes/reads where 100 =
our bug) · deep health drift (scopes/page-tasks re-verify on the daily
probe; subscription drift IS probed) · form connection-marker beyond the
deterministic name (page ownership already reserved) · `metaPageRowId` FK ·
frontend sentryScrub mirror (completion page URLs carry only s/c) ·
reauth-failure asset-cleanup nuance beyond restore-to-connected · TOS field
absent tolerated with warn (explicit false is terminal).
