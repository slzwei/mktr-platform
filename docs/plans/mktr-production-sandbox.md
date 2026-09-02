# MKTR production-behavior sandbox

**Status:** DEPLOYED AND RUNNING at `https://mktr-sandbox-api.onrender.com` — initialized, seeded and verified with every rail dark. Remaining: the two DNS records for the vanity host, the DNC credential copy, and SNS keys for the live OTP test (see §16.2).
**Date:** 2026-09-02 (implemented same day)
**Owner:** Shawn Lee
**Review verdict:** Approve with changes
**Branch:** `feat/production-sandbox` · **Runbook:** `docs/runbooks/mktr-sandbox.md`
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

- [x] Add `DEPLOY_ENV` and frontend deployment identity plumbing. — `backend/src/utils/deployEnv.js`, `src/lib/deployEnv.js`
- [x] Add fail-closed startup validation. — `backend/src/config/sandboxValidation.js`, called first from `validateEnv()`
- [x] Add the shared outbound destination and durable-budget guard. — `backend/src/services/outboundPolicy.js` on `rate_counters`
- [x] Add live-rail kill switches. — `SANDBOX_LIVE_{OTP,DNC,EMAIL}_ENABLED`, effective on restart without a deploy
- [x] Build the shared DNC queue. — `backend/src/dncGateway/`, deployed as `mktr-dnc-gateway`
- [ ] Move production onto it and prove production priority before admitting sandbox traffic. — **blocked on the credential copy (§16.2)**
- [x] Disable sandbox self-registration and production OAuth defaults. — `POST /api/auth/register` 403s in a sandbox; no `GOOGLE_CLIENT_ID` is set
- [x] Disable or gate background integrations. — `SYNC_AGENT_CRON=false` enforced by the validator; the default Retell campaign is opt-in
- [x] Separate Sentry environment handling. — both SDKs now use the deployment identity, not `NODE_ENV`/`MODE`
- [x] Add unit and integration tests for every negative path. — 72 new tests, full unit suite green (2640 passing)

**Gate G1:** CI proves non-allowlisted destinations cannot reach provider adapters. No live credentials exist in sandbox.

### Phase 2 — Database initialization and seeding

- [x] Implement `sandbox:init-db` with blank-database and advisory-lock guards. — `backend/src/database/sandboxInit.js`
- [x] Implement `sandbox:seed` with deterministic, idempotent fixtures. — `backend/src/database/sandboxSeed.js`
- [x] Add seeded role, campaign, lead, package, credit, and subscriber coverage. — 10 users / 3 campaigns / 5 lead states / package + credits; the sink subscriber is registered at boot
- [x] Test initialization refusal against a non-empty database. — proven against a real Postgres (§16.3) and in CI
- [x] Test seed refusal outside sandbox. — proven both ways (§16.3)

**Gate G2:** A new database can be initialized and seeded twice with no duplicates or destructive action.

### Phase 3 — Host and frontend isolation

- [x] Same-origin `/api/*`. — the sandbox API serves its own SPA build, so this holds by construction (see runbook §1)
- [ ] Configure the `sandbox.mktr.sg` and `api.sandbox.mktr.sg` hosts. — **blocked on DNS (§16.2)**; the code already answers on both
- [x] Add `sbx_sid`/`sbx_atk`, host-only auth cookies, and production-visit regression tests.
- [x] Make CORS and the public-host guard sandbox-aware.
- [x] Add banner, noindex, and sandbox canonical behavior. — persistent non-dismissible banner, `X-Robots-Tag` on every response, `robots.txt` disallow, no sitemap
- [ ] Access protection (Cloudflare Access or equivalent). — not available: `mktr.sg` DNS is at mschosting, not Cloudflare
- [x] Verify copied links and redirects stay inside the sandbox. — every link base is env-driven and set to the sandbox host

**Gate G3:** Browser testing proves no request, cookie, or generated URL crosses into production.

### Phase 4 — Sink and dark deployment

- [x] Provision isolated Render services, Postgres and observability. — §16.1
- [ ] Object storage. — no DigitalOcean Spaces credential available; uploads currently land on the service disk (§16.4)
- [ ] The two DNS records. — **blocked (§16.2)**
- [x] Disable automatic deploys. — both services are auto-deploy off; promotion is an explicit deploy of a chosen commit
- [x] Deploy with every provider credential absent. — the validator refuses to boot if one is present
- [ ] Run the one-off database initializer and seeder. — **blocked on `DATABASE_URL` (§16.2)**; both proven against a real Postgres locally
- [x] Enable only the local signed webhook sink. — registered at boot as the sole subscriber; every other subscriber is disabled
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

---

## 16. Delivery record — 2026-09-02

Branch `feat/production-sandbox`. Runbook: `docs/runbooks/mktr-sandbox.md`.

| Commit | What it carries |
|---|---|
| `a9a6b8e8` | Deployment identity, fail-closed validation, outbound policy, shared DNC queue, host/cookie/SEO isolation, initializer, seeder, signed sink |
| `6c47cfaa` | `DATABASE_URL` support, the sandbox boot wrapper, env documentation |
| `da678a57` | Login-capable seed addresses, public-surface ledger entry, loopback gateway URLs |

### 16.1 Resources created

| Resource | Id | Notes |
|---|---|---|
| `mktr-sandbox-api` | `srv-dac04mifngtc73fgj5e0` | Web service, singapore, starter, **auto-deploy off**. Serves the API and the sandbox SPA. `https://mktr-sandbox-api.onrender.com` |
| `mktr-sandbox-db` | `dpg-dac02uv40ujc73ajhn2g-a` | Postgres 17, basic_256mb, singapore, 1 GB |
| `mktr-dnc-gateway` | `srv-dac04fbtqb8s73dov420` | Web service, singapore, starter, **auto-deploy off**. `https://mktr-dnc-gateway.onrender.com` |
| `mktr-dnc-gateway-db` | `dpg-dac030740ujc73ajhqd0-a` | Postgres 17, basic_256mb, singapore, 1 GB |

Nothing existing was renamed, deleted or reconfigured. Production
(`mktr-backend-jo6r`, `mktr-platform`, `redeem-frontend`, `redeem-ops-frontend`,
`mktr-db`) is untouched — no env var of any production service was read or
written during this work.

Recurring cost of the four new resources: roughly **USD 26/month**.

### 16.2 What is blocked, and on exactly what

Every remaining item needs a value that the Render API does not expose or a DNS
zone this session cannot reach. In dashboard order:

1. ~~**`mktr-sandbox-api` → `DATABASE_URL`**~~ — **DONE 2026-09-02 14:08 UTC.**
   The database initialized (96 tables) and seeded (10 users, 3 campaigns, 2
   package rows, 5 prospects) on first boot, and the flags were switched back
   off. Doing this surfaced a real defect: `validateEnv()` still demanded the
   four discrete `DB_*` variables while `connection.js` accepted `DATABASE_URL`,
   so the database came up fully seeded and the API still refused to boot. Fixed
   in `2409a72f` with three regression tests.
2. **`mktr-dnc-gateway` → Environment → `DNC_GATEWAY_DATABASE_URL`** = the
   *Internal Database URL* from `mktr-dnc-gateway-db`. Unblocks the queue.
3. **`mktr-dnc-gateway` → Environment** ← copy `DNC_ORG_CODE`, `DNC_ESERVICE_ID`,
   `DNC_PRIVATE_KEY`, `DNC_HTTPS_PROXY` from `mktr-backend-jo6r`, and set
   `DNC_GATEWAY_TOKEN_PRODUCTION` to a freshly generated secret. Put that same
   secret on `mktr-backend-jo6r` as `DNC_GATEWAY_TOKEN`, with
   `DNC_GATEWAY_URL=https://mktr-dnc-gateway.onrender.com`. Unblocks the
   production cutover (runbook §3) and therefore the live DNC check.
4. **DNS at mschosting.com** — two CNAMEs, after adding both domains to
   `mktr-sandbox-api` in Render:
   `sandbox` → `mktr-sandbox-api.onrender.com`,
   `api.sandbox` → `mktr-sandbox-api.onrender.com`.
   Unblocks `https://sandbox.mktr.sg`. `mktr.sg` is **not** on Cloudflare (only
   `redeem.sg` is), which is also why Cloudflare Access is not the access-control
   answer here.
5. **`mktr-sandbox-api` → `SNS_AWS_ACCESS_KEY_ID` / `SNS_AWS_SECRET_ACCESS_KEY`**
   — only for the one live OTP test to `+6596989089`. Preferably a new IAM
   principal scoped to `sns:Publish`, so sandbox spend is separable from
   production's on the shared AWS account.

Two secrets were generated inside the working session and must be rotated in the
dashboard once the above is done: `DNC_GATEWAY_TOKEN_SANDBOX` (on the gateway,
mirrored as `DNC_GATEWAY_TOKEN` on the sandbox) and `SANDBOX_SEED_PASSWORD`. The
PDPC credential was never handled here — that is why item 3 is a manual copy.

### 16.3 Verified, with evidence

Run against a real PostgreSQL 17 and a PDPC stand-in that **verifies the RSA
signature with the public key**, so a pass proves the real wire format rather
than a stub's guess.

| Acceptance area | Evidence |
|---|---|
| Blank-database initialization | Empty database → baseline + 18 post-baseline migrations → 96 tables |
| Initialization idempotency | Second run: `already_initialized`, schema untouched |
| Initialization refusals | Non-empty foreign database, missing flag, `DEPLOY_ENV≠sandbox`, and a production `DB_HOST` are each refused by name |
| Seed idempotency | Second run: 0 created / 18 updated, identical UUIDs |
| Seed refusals | Missing flag and missing password both refuse |
| Seeded roles log in | `sandbox.admin@sandbox.example.com` → 200 |
| Cookie isolation | `mktr_token`, `HttpOnly; Secure; SameSite=Strict`, **no `Domain`** → host-only |
| Attribution cookie isolation | Sandbox reads `sbx_sid`/`sbx_atk`; a production `sid` on `.mktr.sg` is invisible to it |
| Permission boundaries | `/api/users`: admin 200, analyst/agent/customer 403, anonymous 401. `/api/redeem-ops/partners`: ops roles 200, agent/customer 403. Sink admin endpoints: admin 200, analyst 403 |
| Self-registration | `POST /api/auth/register` → 403 |
| Sandbox labelling | `X-Deploy-Env: sandbox` and `X-Robots-Tag: noindex, nofollow, noarchive` on every response; `<title>SANDBOX — …`; `<meta name="robots" content="noindex, nofollow, noarchive">`; `robots.txt` = `Disallow: /`; no sitemap; persistent banner in the bundle |
| Build-time contamination guards | A production Meta pixel id, a cross-origin `VITE_API_URL`, and an unknown `VITE_DEPLOY_ENV` each fail the build |
| **OTP negative** | Rail armed. `91234567` → 403 `not_allowlisted`; `80000201` (fixed-OTP seed) → 403 `blocked_destination`. **No provider request, no credential use, no counter write** |
| **OTP positive path** | `96989089` → passes the gate, budget `1/3 · 1/10 · 1/50`, then fails inside the AWS SDK for want of credentials — proving the request reaches the provider only for an allowlisted number |
| **DNC negative** | Through the real service: `+6591234567` → held `not_allowlisted`; `+6580000201` → held `blocked_destination`. Neither reached the queue |
| **DNC positive** | `+6596989089` → submitted to the queue → signed → `S000` → recorded `clear` with a validity date |
| Fail closed | Gateway unavailable, still-queued, unauthorized, and policy refusal all leave the lead `pending` (held), never `clear` |
| Gateway authentication | No token 401, wrong token 401; the source comes from the token, never the body |
| Gateway second enforcement | A sandbox-token request for a non-allowlisted number is blocked in the gateway itself |
| **Production priority** | Three sandbox items queued 50–60 s earlier were all overtaken by two production items queued 1–5 s earlier. Send order: production, production, sandbox, sandbox |
| Ordered timestamps | Every PDPC call carried a strictly increasing timestamp, monotonic **across a gateway restart** (persisted in `dnc_gateway_clock`) |
| Idempotent replay | A repeated idempotency key returned the first answer and made no second PDPC call |
| Durable caps | The per-number daily cap fired at exactly 3 **across a restart**; production is never capped |
| Webhook sink | Valid v2 200, legacy v1 200, duplicate delivery id flagged, forged signature 401, absent signature 401, 10-minute-old timestamp 401 |
| Background jobs | Agent sync off (enforced), default Retell campaign suppressed, ads/AI/payments/Retell dark |
| Tests | Backend unit 2568 → **2640 passing** (72 new). Backend integration 2870 passing. Frontend 2034 passing. Counts identical to `origin/main` on both suites — **zero failures introduced**. `eslint` and `typecheck` clean |
| Deployed services fail closed | The gateway still exits rather than start uncredentialed. Before its database was wired, the sandbox API did the same and served a boot-status page naming the missing variable |
| **Deployed sandbox — live evidence** | `https://mktr-sandbox-api.onrender.com` serves the SPA: `<title>SANDBOX — …`, `<meta name="robots" content="noindex, nofollow, noarchive">`, `X-Deploy-Env: sandbox`, `X-Robots-Tag: noindex, nofollow, noarchive`, `robots.txt` = `Disallow: /` |
| Deployed init + seed | First boot: blank database → baseline → migrations → 96 tables; seed created 10 users / 3 campaigns / 2 package rows / 5 prospects; both flags then switched back off |
| Deployed negative tests | OTP to `91234567`, `80000201` **and** `96989089` all 403 with the rails dark — the kill switch alone stops every send |
| Deployed permission boundaries | `/api/users`: admin 200, analyst/agent/customer 403, anonymous 401. `/api/redeem-ops/partners`: super and analyst 200, agent 403. Seeded campaigns visible to admin |
| Deployed cookie isolation | `mktr_token; HttpOnly; Secure; SameSite=Strict` with **no `Domain`** |
| Deployed sink | Valid signature 200, duplicate delivery id flagged, forged signature 401, stale timestamp 401 |
| Deployed self-registration | `POST /api/auth/register` → 403 |
| Google sign-in (enabled 2026-09-02) | Separate `MKTR Sandbox` OAuth client, its own secret and redirect URI. Backend reports `googleClientId: true`; the id is baked into the SPA's `google-*` chunk; `/api/auth/google/state` issues state with an httpOnly `oauth_state` cookie. `shawnleeapps@gmail.com` and `admin@mktr.sg` seeded as password-less admins — Google-only, unreachable with the shared seed password |
| Google cannot self-register | An unknown Google address is refused 403 instead of being provisioned a `customer` account, governed by the same switch as password registration |

### 16.4 Known gaps

- **Object storage is not isolated yet** — no DigitalOcean Spaces credential was
  available, so `DO_SPACES_*` is unset and uploads land on the ephemeral service
  disk. The validator refuses a sandbox pointed at a production bucket, so this
  is a missing capability, not a leak. Needs a sandbox Spaces key.
- **The sandbox OAuth client secret was pasted into a working session** and
  should be rotated (Console → Credentials → the client → Add secret → update
  `GOOGLE_CLIENT_SECRET` → delete the old one). Sandbox-only client, synthetic
  data, so low severity — but free to fix.
- **Production's exact OAuth client id is not pinned** in
  `SANDBOX_FORBIDDEN_MARKERS`. Until it is, nothing in code stops a future
  operator pasting the production client here; the project-number prefix is not
  a usable discriminator (see `sandboxValidation.js`).
- **No access control in front of the sandbox** beyond authentication. Cloudflare
  Access was the plan's proposal and `mktr.sg` is not on Cloudflare. Render IP
  allowlisting is the available equivalent if named-tester access is required.
- **Two pre-existing red suites, neither introduced here.** Verified by running
  the same suites at `origin/main` (`7d62208d`): backend
  `test/marketplaceService.test.js` fails 2 tests on both, and the frontend suite
  fails 16 tests on both (2034 passing, identical counts). An earlier run showing
  78 frontend failures was machine load — every one of those was
  `Test timed out in 5000ms`, and they vanish on an idle re-run.
- **Single gateway instance.** The queue is designed for redundant intake
  (`FOR UPDATE SKIP LOCKED` + leases); only one instance is deployed. Raising
  `numInstances` is safe when volume justifies it.
- **Soak and G5/G6 sign-off** have not happened. This is Gate G4 complete on the
  code, with deployment blocked on §16.2.
