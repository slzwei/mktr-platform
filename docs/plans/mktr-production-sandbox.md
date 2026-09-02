# MKTR production-behavior sandbox

**Status:** Draft — repository review complete; Claude review and product decisions folded in
**Date:** 2026-09-02
**Owner:** TBD
**Review verdict:** Approve with changes
**Target:** A production-mode MKTR admin sandbox containing only seeded synthetic data, with controlled real OTP and DNC verification available for approved test identities.
**Planned address (not yet deployed):** `https://sandbox.mktr.sg` (`/api/*` will route to `https://api.sandbox.mktr.sg`)

---

## 1. Outcome

Create an isolated environment that behaves like production without sharing production customer data or unrestricted outbound integrations.

The sandbox must support:

- Seeded staff accounts covering the current MKTR role boundaries.
- Campaign creation and editing, including Campaign Studio saves.
- The public lead-capture path required to test OTP and DNC behavior.
- Real OTP delivery to approved test numbers.
- Deterministic DNC clear, registered, invalid, provider-error, cached, and quota scenarios.
- Tightly controlled live DNC checks against the PDPC production service for approved test numbers.
- The complete DNC hold, credit charge, signed webhook delivery, and release transaction.
- Repeatable initialization, seeding, deployment, rollback, and rebuild.

It must never:

- Connect to the production MKTR, Lyfe, or mktr-leads databases.
- Clone production users, leads, campaigns, webhooks, object storage, or analytics identifiers.
- Send OTP, WhatsApp, email, DNC, webhook, ad, AI, Retell, or payment traffic to an unapproved destination.
- Depend on `NODE_ENV` alone to distinguish sandbox from production.
- Run the destructive baseline restore against a persistent sandbox database.

---

## 2. Review and product decisions folded in

The repository review, Claude review, and subsequent product direction changed the original scope in these material ways:

1. **Blank-database initialization is implementation work.** The migration chain assumes the frozen baseline already exists. The current baseline restore drops `public` and is test-only, so it cannot be reused as the sandbox initializer.
2. **Provider allowlists are P0 prerequisites.** Existing OTP and DNC quotas do not restrict destinations, DNC has only an hourly service budget, and mail can send to any address once SMTP is configured.
3. **DNC uses the real production service, not UAT.** The shared queue must make real PDPC production checks for approved test numbers. Automated tests use injected provider fixtures to prove deterministic branches without spending credits; PDPC UAT is explicitly out of scope.
4. **Production and sandbox will use one shared DNC queue.** Neither application backend will call PDPC independently. A small shared gateway will own the existing production credential, put all requests through one ordered queue, call the PDPC production endpoint, and return the result. Production requests get priority and reserved capacity; sandbox requests remain allowlisted, capped, and visibly tagged.
5. **Sandbox hosts require code changes.** Frontend public links currently hardcode production domains, public-host routing does not recognize sandbox hosts, and CORS defaults always include production origins.
6. **The chosen address is `sandbox.mktr.sg`.** Because it sits under `mktr.sg`, sandbox attribution cookies need different names and secrets, all auth cookies remain host-only, and browser API calls use same-origin `/api/*` routing so production cookies and API addresses cannot be mixed up.
7. **The local signed webhook sink is mandatory for the normal clear-release path.** It tests MKTR's transaction, outbox, signature, retry, and release behavior, but not Lyfe receiver semantics.
8. **Background behavior must be contained.** Agent synchronization defaults on, and bootstrap creates a default Retell campaign even without an explicit sandbox requirement.
9. **The delivery estimate is larger.** A safe sandbox with live rails is a multi-week engineering and operations effort, not a four-to-six-day configuration exercise.

---

## 3. Proposed architecture

The first-release addresses are decided but their hosting and DNS records have not yet been provisioned:

- People use `https://sandbox.mktr.sg`.
- The browser calls `https://sandbox.mktr.sg/api/*` on the same origin.
- The edge/static-host rewrite sends `/api/*` only to `https://api.sandbox.mktr.sg`.
- `api.sandbox.mktr.sg` is not used in browser links and is locked to the edge proxy, operations access, and health checks.

```text
Approved tester
    |
    v
Access policy / sandbox banner
    |
    v
Sandbox SPA --------------------------+
admin + public test funnel             |
    |                                  |
    v                                  |
Sandbox API                            |
    |                                  |
    +--> isolated Postgres             |
    +--> isolated object bucket        |
    +--> isolated Sentry/log stream    |
    |                                  |
    +--> outbound policy gate ---------+
            |
            +--> AWS OTP rail, approved numbers only
            +--> shared DNC queue, approved numbers only --> PDPC production
            +--> sandbox email account, approved addresses only
            +--> local HMAC webhook sink
```

Chosen isolation:

- Frontend and browser API traffic stay on `sandbox.mktr.sg`; `/api/*` is a same-origin proxy to the sandbox API.
- Separate Render services and Postgres instance.
- Separate object bucket, Sentry project or environment, JWT and attribution secrets, OAuth client, and provider IAM principal.
- Cloudflare Access or equivalent in front of every human-facing sandbox route.
- Add both chosen hosts to the explicit host model.
- Use sandbox-specific names such as `sbx_sid` and `sbx_atk` for apex-domain attribution cookies.
- Use distinct `ATTRIB_SECRET` and `IP_HASH_SALT` values.
- Test with a browser that has already visited production.
- Never set `Domain=.mktr.sg` from a sandbox auth response.

One MKTR-brand SPA can cover admin and the public test funnel. A second Redeem-branded sandbox build is out of scope unless brand-specific consumer behavior must be rehearsed.

---

## 4. Environment contract

Introduce a typed deployment identity:

| Variable | Sandbox requirement |
|---|---|
| `NODE_ENV` | `production`, so production security behavior remains active |
| `DEPLOY_ENV` | `sandbox` |
| `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | Isolated sandbox Postgres only; these are the connection variables the backend actually consumes |
| `SYNC_AGENT_CRON` | `false` |
| `WEBHOOK_ENABLED` | `true` only when the sole enabled destination is the sandbox sink |
| `DESIGN_CONFIG_V2_WRITES_ENABLED` | `true` if Campaign Studio is in acceptance scope |
| `DNC_GATEWAY_URL` | Exact private URL of the shared DNC queue; direct sandbox-to-PDPC calls are forbidden |
| `DNC_BASE_URL` | Set only on the shared gateway to `https://www.dnc.gov.sg/realtime` |
| `DNC_API_ENABLED` | `false` until the outbound safety gate passes |
| `SENTRY_ENVIRONMENT` / `VITE_SENTRY_ENVIRONMENT` | `sandbox` |
| `VITE_DEPLOY_ENV` | `sandbox` for banner, SEO, and frontend URL behavior |

Proposed sandbox-only controls:

- `SANDBOX_SEED_ALLOWED=true`
- `SANDBOX_ALLOWED_PHONES=+6596989089` initially; exact matching after E.164 normalization
- `SANDBOX_ALLOWED_EMAILS`
- `SANDBOX_LIVE_OTP_ENABLED=false`
- `SANDBOX_LIVE_DNC_ENABLED=false`
- `SANDBOX_LIVE_EMAIL_ENABLED=false`
- `SANDBOX_OTP_DAILY_CAP` and `SANDBOX_OTP_MONTHLY_CAP`
- `SANDBOX_DNC_DAILY_CAP` and `SANDBOX_DNC_MONTHLY_CAP`

Names may change during implementation, but the semantics must remain fail-closed.

Startup validation must reject a sandbox deployment when:

- `NODE_ENV` is not `production`.
- `DEPLOY_ENV` is missing or unknown.
- The database, bucket, webhook, Lyfe, mktr-leads, ad, payment, Retell, or analytics configuration resolves to a production resource.
- A live-rail flag is enabled without a non-empty allowlist and durable budget.
- `DNC_API_ENABLED=true` without `SANDBOX_LIVE_DNC_ENABLED=true`, a non-empty phone allowlist, and durable daily/monthly budgets.
- DNC is enabled without the exact shared-gateway URL, or the sandbox is configured to call PDPC directly.
- Agent synchronization is enabled without an explicitly approved staging source.
- Sentry would report the environment as `production`.

The validator must log variable names and resource categories, never secret values.

The frontend build needs an equivalent sandbox validator. Because it is a production Vite build, `import.meta.env.PROD` is true; copied production `VITE_META_PIXEL_ID`, `VITE_TIKTOK_PIXEL_ID`, `VITE_GOOGLE_ADS_*`, or `VITE_ADROLL_*` values would immediately contaminate production analytics. Sandbox builds must reject those identifiers unless explicitly mapped to test accounts, and seeded campaigns must not carry per-campaign production tracking IDs.

---

## 5. Integration policy

| Integration | Initial state | Final sandbox state |
|---|---|---|
| Password authentication | Enabled | Seeded users only |
| Self-registration | Disabled | Remains disabled unless separately approved |
| Google OAuth | Disabled | Optional, with a separate client and callback |
| AWS SNS OTP | Credentials absent | Live for exact approved E.164 numbers |
| WhatsApp OTP/fallback | Credentials absent | SMS-only by default; separate sender or callback router if enabled |
| DNC | Disabled | Production service for exact approved E.164 numbers through the one shared DNC queue |
| Email | SMTP absent/log-only | Separate sender account and exact recipient allowlist |
| Lyfe webhook | Disabled | Never production; local sink or Lyfe staging only |
| mktr-leads webhook | Disabled | Never production; staging only if explicitly added |
| Agent sync | Disabled | Staging source only if required |
| Meta, Google and TikTok ads | Disabled | Test accounts only if later added |
| Retell | Disabled | No live key; suppress default bootstrap campaign |
| Payments | Disabled | Provider sandbox only |
| AI | Disabled | Separate key and hard budget only if required |
| Object storage | Separate | Sandbox bucket, synthetic public assets only |
| Sentry | Separate | Sandbox project/environment and alert routing |

Production OTP access is not part of the base deployment and is enabled only after dark-deploy acceptance passes. The DNC credential remains only in the shared gateway; it is never copied into the sandbox application.

### 5.1 Production coexistence contract

Production can remain live while sandbox runs, but isolation must extend beyond the application database:

| Resource | Coexistence requirement |
|---|---|
| Application and Postgres | Separate Render services and database; no shared schema, connection string, advisory lock, or migration job |
| Frontend build | Same Git SHA is allowed, but each service builds its own artifact with environment-specific `VITE_*` values |
| API routing | Sandbox `VITE_API_URL` and static-site `/api/*` rewrite must target only the sandbox API |
| JWT, OAuth and cookies | Separate secrets and OAuth client; frontend and API must be same-site or use a same-origin proxy because auth cookies are `SameSite=Strict` |
| AWS SNS | A separate IAM principal is preferred, but spend and the registered sender limit remain account-wide; reserve production headroom and cap sandbox below it |
| DNC | Both environments use one queue; it owns the production credential and ordered timestamp, gives production priority, and enforces the sandbox tag, allowlist, and cap |
| WhatsApp | Do not share a sender unless callbacks are deterministically routed by phone-number ID; otherwise sandbox statuses or STOP messages can reach production |
| Email | Separate sandbox sender/account where possible; shared SES/SMTP quota and sender reputation still affect production |
| Object storage | Separate bucket and CDN origin; local Render disk is ephemeral and is not an acceptable fallback |
| Webhooks and sync | Local sink or staging only; production Lyfe and mktr-leads URLs/secrets absent |
| Observability | Separate Sentry project/environment and alert routes |

Production rollout order:

1. Add `DEPLOY_ENV=production` and any new production-safe variables to the existing production services before deploying code that consumes them.
2. Deploy the shared DNC gateway with sandbox access disabled, then deploy the production-compatible queue client with its switch still off.
3. Move production DNC traffic onto the queue during a watched release and prove requests, timestamps, credits, and alerts before allowing any sandbox traffic.
4. Pin that exact application SHA for sandbox, but build it with sandbox-specific frontend and backend environment values.
5. Keep production and sandbox auto-deploy settings independent.
6. Run a configuration-diff check before every sandbox rail enablement and every production promotion.

All new migrations must be additive and backward compatible because the same application SHA is intended to remain deployable to production. Sandbox initialization and seeding commands must never run as production start or release commands.

---

## 6. Repository gaps that must be closed

### 6.1 Database bootstrap

Current behavior:

- `backend/src/database/bootstrap.js` restores the frozen baseline only in test mode.
- `backend/src/database/restoreBaseline.js` executes `DROP SCHEMA public CASCADE`.
- `backend/src/database/runMigrations.js` starts with migrations that assume base tables.
- `backend/src/database/seed.js` correctly refuses production mode and non-local hosts.

Required behavior:

- Add a new `sandbox:init-db` command.
- Require `NODE_ENV=production`, `DEPLOY_ENV=sandbox`, and an explicit initialization flag.
- Acquire a database advisory lock.
- Count user tables and refuse unless the database is blank.
- Apply `database/baseline/schema.sql` without dropping any schema.
- Record the baseline migration set from `database/baseline/applied.json`.
- Run the normal pending migrations.
- Exit successfully on a previously initialized compatible database without rewriting data.
- Refuse a non-empty database whose initialization metadata is absent or inconsistent.

Do not change or weaken the existing `seed` and test restore guards.

### 6.2 Outbound destination policy

Build a shared outbound policy module at the lowest provider boundary:

- Normalize phone numbers to exact E.164 before matching.
- Normalize emails conservatively and use exact matches; no wildcard domains initially.
- Apply the phone gate before choosing WhatsApp or SNS.
- Apply the DNC gate inside the shared DNC service so form checks, create-time checks, Retell, backfill, and future callers cannot bypass it.
- Apply the email gate immediately before the SMTP transport call.
- Use durable database counters for daily and monthly limits so a restart cannot reset spend.
- Preserve existing per-phone, global SMS, rate-limit, cache, and hourly DNC protections.
- Record allowed and blocked attempts with deployment, rail, reason, and a redacted destination hash.
- Expose emergency kill switches that take effect without a code deploy.

Starting caps should be deliberately small and approved by operations. A reasonable initial ceiling is three sends/checks per number per day, ten globally per day, and fifty globally per month for each live rail.

### 6.3 Hosts, cookies, CORS, and generated links

- Replace hardcoded customer hosts in `src/lib/brand.js` with build-time sandbox overrides that retain production defaults.
- Audit the remaining hardcoded production URLs in auth redirects, invite flows, campaign/draw templates, email templates, short links, WhatsApp claim links, API fallbacks, and `vite.config.js`; changing `brand.js` alone is insufficient.
- Extend the backend host model with explicit sandbox brand semantics.
- Make CORS defaults deployment-aware. Sandbox should accept only its own exact origins; production must not receive sandbox origins through its environment.
- Keep the staff auth cookie host-only.
- Set the sandbox browser API base to `/api` and proxy it same-origin from `sandbox.mktr.sg` to `api.sandbox.mktr.sg`. The current `mktr_token` cookie is `SameSite=Strict`, and Google state uses a backend cookie; the chosen same-origin path preserves both flows.
- Set both `VITE_API_URL` and the Render static-site `/api/*` rewrite to the sandbox API. Treat any production API target as a boot/build failure.
- Namespace sandbox attribution cookies as `sbx_sid` and `sbx_atk`, use sandbox-only secrets, and keep auth cookies host-only so production `sid`, `atk`, and login cookies cannot be mistaken for sandbox state.
- Add tests for forged `Origin`, `Host`, and `X-Forwarded-Host` values.
- Verify every copied URL, QR code, redirect, email link, tracking link, preview, and callback remains inside the sandbox.

### 6.4 Search, labeling, and observability

- Add a persistent, non-dismissible sandbox banner.
- Emit `robots.txt` with `Disallow: /` and no sitemap for every sandbox build.
- Add a global `noindex, nofollow` meta tag and `X-Robots-Tag` response header where practical.
- Make canonical URLs sandbox-aware or omit them.
- Wire backend and frontend Sentry environment fields to deployment identity instead of `NODE_ENV` or Vite mode.
- Use a separate Sentry project when possible and tag all logs, metrics, and audit rows with `deploy_env=sandbox`.

### 6.5 Background work

- Set `SYNC_AGENT_CRON=false` and make sandbox startup fail if production agent sources are present.
- Make default Retell campaign creation opt-in instead of unconditional for sandbox.
- Audit every interval, queue, bootstrap helper, and enabled flag before dark deployment.
- Keep ads, audience sync, discovery, DNC backfill, suppression propagation, payment, and AI workers disabled unless their sandbox destination is documented.

### 6.6 Shared DNC queue

Before any production DNC call:

- Deploy one private `mktr-dnc-gateway` service for both production and sandbox. It is the only service that holds the existing production eService ID/certificate and the only service allowed to call `https://www.dnc.gov.sg/realtime`.
- Send every request through one durable ordered queue. The gateway owns the persisted last timestamp, signing, retry, and idempotency state so two application databases cannot race each other.
- Run redundant gateway intake instances backed by the durable queue, while allowing only the queue lease-holder to send the next PDPC request. A gateway restart must not lose or reorder accepted work.
- Give production traffic priority and reserved worker capacity. Sandbox traffic must never delay or consume the budget reserved for a production request.
- Require an authenticated `source=production|sandbox` identity rather than trusting a caller-supplied label. Record the source on every queue item and result.
- Enforce the sandbox phone allowlist and daily/monthly cap twice: once in the sandbox API and again in the shared gateway.
- Keep the public form request synchronous from the caller's point of view: wait briefly for its queued result and fail closed if the gateway is unavailable or too busy.
- Encrypt and authenticate the private path end to end, restrict ingress to the two application services, rotate gateway credentials, and redact them from logs.
- Preserve production access while adding sandbox access; stage routing and firewall changes rather than replacing the production path in one step.
- Add availability and credit-spend alerts.

The existing Basic-auth, internet-reachable proxy posture documented in `docs/dnc/egress-proxy-runbook.md` is not sufficient for this shared queue without the controls above.

---

## 7. Seed design

Add a separate `sandbox:seed` command. It must be production-mode compatible only when `DEPLOY_ENV=sandbox` and `SANDBOX_SEED_ALLOWED=true`.

### 7.1 Supabase test-number inventory and selection

A read-only check of the live Lyfe Supabase project on 2026-09-02 found 54 numbers configured for the fixed test OTP `555555`, valid until 2036-03-13:

- `+6580000001`–`+6580000007`
- `+6580000101`–`+6580000102`
- `+6580000110`–`+6580000114`
- `+6580000201`–`+6580000230`
- `+6590000001`–`+6590000009`
- `+6599999999`

Fifteen of those fixed-OTP numbers are attached to active production user rows: `+6580000001`–`+6580000007`, `+6590000001`–`+6590000007`, and `+6590000009`. Those rows are currently marked `is_test_data=false`, so the sandbox must not copy their profiles or production relationships. The three rows currently marked `is_test_data=true` have no phone number.

A targeted lookup also confirmed `+6596989089` as the active Shawn Lee admin number. Use that one number as the initial `SANDBOX_ALLOWED_PHONES` destination for real MKTR OTP delivery and production DNC checks. Reuse only the number in a synthetic sandbox record; do not copy its production profile, identifiers, or relationships.

Use the unused fixed-OTP block `+6580000201`–`+6580000210` for the first sandbox seed identities:

| Phone | Seeded purpose |
|---|---|
| `+6580000201` | MKTR admin |
| `+6580000202` | MKTR agent |
| `+6580000203` | Redeem Ops super admin |
| `+6580000204` | Redeem Ops admin |
| `+6580000205` | BDM |
| `+6580000206` | Outreach executive |
| `+6580000207` | Campaign operations |
| `+6580000208` | Redemption operations |
| `+6580000209` | Analyst |
| `+6580000210` | Spare synthetic user / fixed-code journey |

Create only synthetic sandbox records for these numbers. Supabase-backed test login uses the fixed code and does not need a real SMS. Block this fixed-code range from MKTR's live providers: MKTR's own OTP and DNC rails must go through their production services only for the separate `+6596989089` allowlisted destination.

Seed characteristics:

- Stable natural keys or fixed UUIDs with upsert/update semantics.
- Synthetic names and `example.invalid` email addresses unless an address is explicitly allowlisted for live email.
- Phone placeholders that cannot reach real people, except the separately configured allowlisted test phones.
- At least one seeded user for each supported authorization boundary needed by acceptance.
- Active and inactive campaigns, including one DNC-enabled campaign.
- Leads covering new, held, released, invalid, and already-delivered states.
- Packages and credits sufficient for one controlled DNC clear-release lifecycle.
- A sandbox webhook subscriber pointing only to the local sink.
- No production foreign IDs, Supabase identifiers, advertising IDs, tracking pixels, or provider transaction IDs.

Required tests:

- First seed creates the expected rows.
- Second and subsequent seeds produce no duplicates and preserve stable identifiers.
- Seed refuses a non-sandbox deployment.
- Seed refuses an uninitialized or unexpected schema.
- Seeded credentials come from the secret store and are not committed or printed.

There is no automated destructive reset command in this scope. Rebuild by provisioning a new sandbox database, then initialize and seed it.

---

## 8. Signed webhook sink

Deploy a small sandbox-only receiver that:

- Implements the same HMAC signature version used by the MKTR outbox.
- Validates timestamp/replay bounds and idempotency keys.
- Stores only minimal synthetic delivery evidence.
- Can be switched between success, retryable failure, and terminal failure responses.
- Has no credentials or network path to production Lyfe.
- Is registered automatically as the sole sandbox delivery subscriber.

This validates:

- DNC claim and credit charge.
- Transactional outbox persistence.
- Commit-before-flush behavior.
- HMAC construction and verification.
- Retry and subscriber auto-disable behavior.
- The fail-closed `no_subscriber` path.
- Successful release after a persisted delivery.

It does not validate Lyfe agent lookup, receiver-side idempotency, or receiver-specific 4xx handling. Run one separate acceptance pass against Lyfe staging if those semantics are required.

---

## 9. Delivery phases and gates

### Phase 0 — Decisions and threat model

- [x] Use `sandbox.mktr.sg` with same-origin `/api/*`, sandbox-specific attribution cookies, and host-only auth cookies.
- [x] Use `+6580000201`–`+6580000210` for synthetic seed identities and `+6596989089` as the sole initial live OTP/DNC destination; copy no production profiles.
- [ ] Approve the DNC daily/monthly cap and manual live-check owner; record the real production result rather than assuming an outcome.
- [x] Use one shared DNC queue and the existing production credential; do not ask for a separate sandbox credential.
- [ ] Identify every approved live email recipient if email delivery is enabled.
- [ ] Decide whether WhatsApp OTP behavior is in scope.
- [ ] Select local sink only or local sink plus Lyfe staging.
- [ ] Define Cloudflare Access groups and any exact callback exclusions.
- [ ] Select the production SHA to rehearse.

**Gate G0:** Product, security, and operations approve the environment boundary and live-recipient list.

### Phase 1 — Safety code

- [ ] Add `DEPLOY_ENV` and frontend deployment identity plumbing.
- [ ] Add fail-closed startup validation.
- [ ] Add the shared outbound destination and durable-budget guard.
- [ ] Add live-rail kill switches.
- [ ] Build the shared DNC queue, move production onto it, and prove production priority before admitting sandbox traffic.
- [ ] Disable sandbox self-registration and production OAuth defaults.
- [ ] Disable or gate background integrations.
- [ ] Separate Sentry environment handling.
- [ ] Add unit and integration tests for every negative path.

**Gate G1:** CI proves non-allowlisted destinations cannot reach provider adapters. No live credentials exist in sandbox.

### Phase 2 — Database initialization and seeding

- [ ] Implement `sandbox:init-db` with blank-database and advisory-lock guards.
- [ ] Implement `sandbox:seed` with deterministic, idempotent fixtures.
- [ ] Add seeded role, campaign, lead, package, credit, and subscriber coverage.
- [ ] Test initialization refusal against a non-empty database.
- [ ] Test seed refusal outside sandbox.

**Gate G2:** A new database can be initialized and seeded twice with no duplicates or destructive action.

### Phase 3 — Host and frontend isolation

- [ ] Configure `sandbox.mktr.sg`, same-origin `/api/*`, and the `api.sandbox.mktr.sg` origin.
- [ ] Add `sbx_sid`/`sbx_atk`, host-only auth cookies, and production-visit regression tests.
- [ ] Make CORS and the public-host guard sandbox-aware.
- [ ] Add access protection, banner, noindex, and sandbox canonical behavior.
- [ ] Verify copied links, QR codes, redirects, and callbacks.

**Gate G3:** Browser testing proves no request, cookie, or generated URL crosses into production.

### Phase 4 — Sink and dark deployment

- [ ] Provision isolated Render services, Postgres, storage, the two chosen DNS records, and observability.
- [ ] Disable automatic deploys or document exact-SHA promotion behavior.
- [ ] Deploy with every provider credential absent.
- [ ] Run the one-off database initializer and seeder.
- [ ] Enable only the local signed webhook sink.
- [ ] Soak for at least one business day while inspecting outbound logs.

**Gate G4:** Full synthetic lead lifecycle passes with zero live-provider traffic.

### Phase 5 — Provider rails

Enable one rail at a time:

1. DNC production for approved test numbers through the shared queue, which calls the production endpoint with the existing credential.
2. AWS SNS OTP for approved numbers.
3. WhatsApp OTP/fallback, only if in scope and behind the same guard.
4. Sandbox email, only if real delivery is required.

For each rail:

- Run a negative request to a non-allowlisted destination and prove rejection before the provider boundary.
- Enable credentials and the rail-specific kill switch only after that test.
- Run the smallest positive test.
- Confirm the durable daily/monthly counter and provider-side billing alert.
- Confirm sandbox activity did not consume a production-reserved provider budget or write a production callback row.
- Disable the rail immediately after acceptance if it is not needed continuously.

Production DNC tests are manual and never part of CI or a generic smoke command. Deterministic DNC branch coverage uses injected provider fixtures in automated tests, not a UAT endpoint.

**Gate G5:** Operations signs off the evidence for each enabled rail.

### Phase 6 — Acceptance and recovery

- [ ] Complete the acceptance matrix below.
- [ ] Redeploy the prior application SHA.
- [ ] Prove the initializer refuses the now-nonempty database.
- [ ] Verify backward compatibility of migrations before application rollback.
- [ ] Test recovery by provisioning a fresh database and re-running init plus seed.
- [ ] Record the exact SHA, service IDs, configuration checklist, and evidence links.

**Gate G6:** Product, security, and operations accept the sandbox for ongoing seeded-user use.

---

## 10. Acceptance matrix

| Area | Required evidence |
|---|---|
| Data isolation | Sandbox cannot connect to production databases, Supabase projects, buckets, or webhook destinations |
| Authentication | Seeded roles can log in and cannot cross authorization boundaries |
| Registration | Public self-registration is rejected or absent |
| Hosts | All links, QR codes, redirects, canonical tags, and API requests remain on sandbox |
| Cookies | Production visits do not affect sandbox sessions; sandbox cannot set production-domain cookies |
| CORS/host guard | Only exact sandbox browser origins pass; forged host headers do not change routing |
| OTP negative | Non-allowlisted number is rejected before WhatsApp/SNS |
| OTP positive | Approved number receives a real OTP and completes verification |
| OTP budgets | Per-number, daily, monthly, and kill-switch paths work across process restarts |
| Shared SMS account | Sandbox spend remains below its allocation and leaves the agreed production reserve under the AWS account-wide ceiling |
| DNC deterministic | Injected provider fixtures prove clear, registered, invalid, provider-error, cache, and quota paths without live spend |
| DNC production | Approved test numbers receive controlled real production checks with the actual response, audit, gateway, response-validation, and spend evidence |
| DNC coexistence | Concurrent production/sandbox requests pass through the one durable queue; production priority and ordered timestamps are proven |
| DNC gate | Clear releases; registered blocks or follows evidence-backed consent behavior; provider errors remain held where required |
| WhatsApp isolation | Disabled, separately provisioned, or callbacks demonstrably route without production status/STOP writes |
| Webhook | No subscriber fails closed; sink success releases; failure retries; invalid HMAC is rejected |
| Email | Non-allowlisted address is blocked; approved delivery uses the sandbox sender |
| Background jobs | No production sync, ad, Retell, payment, AI, or audience job executes |
| Storage | Uploads land only in the sandbox bucket and contain synthetic assets |
| Studio | Design saves work when the sandbox write flag is intentionally enabled |
| SEO/UI | Blanket noindex is emitted and every page is visibly marked sandbox |
| Observability | Logs, Sentry events, alerts, provider counters, and costs are labeled sandbox |
| Idempotency | Repeated init, seed, deploy, webhook, and retry operations do not duplicate state |
| Recovery | Prior SHA rollback and fresh-database rebuild are documented and demonstrated |

---

## 11. Rollout and rollback policy

Rollout:

1. Merge and test safety code with all rails dark.
2. Deploy an exact commit SHA with automatic deployment disabled.
3. Initialize and seed through explicit one-off jobs.
4. Complete G4 before configuring any live credential.
5. Enable and accept one provider rail at a time.

Rollback:

- Application rollback means deploying the last known-good SHA, not moving a branch pointer.
- Schema changes must be backward compatible using expand/contract sequencing.
- If a schema is incompatible, restore a pre-deploy snapshot or rebuild the disposable sandbox database; do not run the test baseline restore on it.
- Kill switches are the first response to any unexpected outbound traffic.
- Rotate credentials immediately if logs show an unapproved provider destination or proxy exposure.

---

## 12. Estimate

Assumptions: one engineer familiar with the repository, part-time operations/security support, existing Render and Cloudflare accounts, and no procurement delay.

| Work | Estimate |
|---|---:|
| Decisions and threat model | 1–2 days |
| Deployment identity, validation, outbound guards, tests | 4–6 days |
| Blank-database initializer and sandbox seeder | 3–5 days |
| Host, cookie, CORS, link, SEO, and Sentry isolation | 2–4 days |
| Signed sink and DNC lifecycle tests | 2–3 days |
| Infrastructure and dark soak | 2–3 days |
| Rail-by-rail enablement | 2–4 days |
| Acceptance, rollback, and runbook | 2–3 days |

**Total engineering effort:** approximately 18–30 engineer-days.
**Expected elapsed time:** approximately 4–5 weeks with review and provider coordination.

A dark sandbox without live OTP/DNC could be available in roughly 1.5–2 weeks. It must not be presented as complete until G5 and G6 pass.

---

## 13. Open decisions

| Decision | Owner | Default recommendation |
|---|---|---|
| Access policy | Security | Named testers only; narrow callback exclusions |
| Production DNC live-check evidence | Compliance/Ops | Use the selected phone block, cap spend, and record the production response; no UAT |
| Approved email list | Product/Ops | Exact recipients only; leave email off until selected |
| WhatsApp fallback scope | Product | Off unless explicitly required |
| Lyfe staging | Product/Platform | Add one receiver-fidelity pass if available |
| Render configuration | Platform | Capture as code or a checked-in redacted manifest |
| Continuous vs pinned deployment | Product/Platform | Pinned exact-SHA promotion |
| Sandbox data retention | Security | Short retention; synthetic data only |

---

## 14. Definition of done

The sandbox is production-ready only when:

- Gates G0 through G6 are signed off.
- The environment contains no production customer data or production application destinations.
- Live OTP and any live DNC use are restricted in application code, not merely by operator convention.
- A non-allowlisted request demonstrably cannot reach a provider.
- A seeded user can complete the full intended admin and lead-capture lifecycle.
- The environment can be rebuilt from an empty database and an exact application SHA.
- The rollback and kill-switch runbook has been exercised.

---

## 15. Review record

Claude Code 2.1.252 performed a bounded read-only repository review on 2026-09-01 using only file read/search capabilities. Its verdict was **approve with changes**. No provider calls or repository mutations were permitted during the review. The material safety findings are incorporated into Sections 2, 4, 6, 8, 9, and 12 rather than retained as a separate appendix. Its UAT recommendation was explicitly rejected by subsequent product direction; the plan requires controlled production DNC checks.
