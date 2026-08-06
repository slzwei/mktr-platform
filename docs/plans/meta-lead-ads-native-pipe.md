# Meta Lead Ads — native ingestion pipe (v2, post-codex)

**Status: APPROVED FOR IMPLEMENTATION** (v1 reviewed by codex 2026-08-06 —
verdict "not sound as written"; this v2 folds in all seven structural
demands. Review artifacts: this doc's git history.)
**Decision record:** the original Meta Lead Ads stack was removed 2026-07-24
(`eb9abd3`, PR #253) as never-used. Shawn green-lit a proper rebuild
2026-08-06: native instant-form leads land in the normal prospect pipeline
and push to agents. No Zapier bridge.

## 1. Goal + delivery contract

Instant-form submit → Meta `leadgen` webhook → **durable inbox row + fast
200** → worker fetches the lead from Graph → Prospect through the standard
pipeline (normalized phone, consent ledger, DNC gate, quota/held,
transactional outbound delivery) → the **owning agent's app** gets the push.

**Delivery contract (explicit, per codex F7):** leads follow the assigned
agent's provenance — `destinationForAgent` routes MKTR-Leads agents to the
MKTR Leads app and Lyfe agents to the Lyfe app, exactly like every other
source. We do NOT filter rings to MKTR-only. Operationally, point Meta form
mappings at campaigns whose funded agents are MKTR Leads agents. Tests
assert both destinations per provenance.

**Receiver verification (codex F15):** the mktr-leads repo was verified
directly this session — `receive-mktr-lead/leadSource.ts` derives the badge
from `sourceMetadata.utm.utm_source` (`fb`/`ig` → FB/IG glyphs,
`meta|an|msg` → Meta loop, regression-tested in `lib/__tests__/`). A frozen
payload fixture in THIS repo pins the wire contract so drift is caught here.

### Non-goals (v1)

Admin UI (API-only); AI screening for Meta leads (D3 follow-up); external-
buyer delivery (no third-party disclosure consent ⇒ `allowExternal`
structurally off); TikTok Lead Gen; multi-Meta-app; marketing nurture of
Meta leads (consent `verified:false` ⇒ `canMarketTo` denies — documented,
deliberate; delivery-to-agent is unaffected).

## 2. Architecture: inbox → worker → standard pipeline

### 2.1 Webhook endpoint (thin, fast)

`routes/meta.js`, `meta = { path: '/api/meta', flag: 'META_LEAD_ADS_ENABLED',
flagDefault: 'false', public: ['GET /webhook', 'POST /webhook'] }` — route
mounts only when flagged on (codex F3). Admin CRUD in the same file behind
`authenticateToken` + `requireRole('admin')` tagged gates.

- `GET /webhook` — hub.challenge echo iff verify token matches, else 403.
- `POST /webhook` — signature over `req.rawBody` (X-Hub-Signature-256).
  Missing/invalid sig → 401. Secret unset in prod → **503** (flag-on +
  secret-missing is a boot failure per §7, so this is belt-and-braces, not
  a drop — codex F3 rejected 200-and-drop for lead-bearing payloads).
  Valid → upsert one `meta_leadgen_events` row per leadgen change
  (`ON CONFLICT (leadgenId) DO NOTHING`), **200 after the upsert commits**,
  then `setImmediate(drainMetaInbox)` so the happy path stays sub-second.
  Upsert failure → 500 (Meta redelivers; upsert is idempotent). No Graph
  call, no prospect write, in the request cycle (codex F1).

### 2.2 `meta_leadgen_events` — the durable inbox (migration 114)

| column | type | notes |
|---|---|---|
| id | UUID PK default gen_random_uuid() | |
| leadgenId | STRING UNIQUE NOT NULL | **the permanent dedupe** — replaces TTL'd IdempotencyKey (codex F5: hourly purge would eventually re-admit) |
| pageId / formId | STRING | from webhook change |
| createdTime | BIGINT | Meta unix ts |
| status | STRING NOT NULL default 'pending' | pending → completed \| duplicate \| dead |
| attempts | INT NOT NULL default 0 | |
| nextAttemptAt | TIMESTAMPTZ NULL | backoff schedule |
| lastError | TEXT | truncated, token-redacted |
| prospectId | UUID NULL | set on completed/duplicate |
| createdAt/updatedAt | TIMESTAMPTZ NOT NULL default now() | DB defaults |

Worker `drainMetaInbox` (started from bootstrap only when
`META_LEAD_ADS_ENABLED`; also on a 30s interval as the recovery net —
restart-safe by construction): claims rows `status='pending' AND
(nextAttemptAt IS NULL OR <= now())` with `FOR UPDATE SKIP LOCKED`, per row:

1. Graph fetch `/{leadgenId}?fields=field_data,form_id,ad_id,adset_id,
   campaign_id,platform,is_organic,created_time,custom_disclaimer_responses`
   (10s timeout). Transient failure (network/5xx/429) → attempts+1,
   `nextAttemptAt = now() + min(2^attempts, 64) min`, stays pending;
   attempts ≥ 8 → `dead` + error-level log (admin-queryable). Token/auth
   errors (190/102) log the pageId as a rotation signal and retry on the
   same schedule — the inbox holds the lead while the admin fixes the token.
2. Parse + sanitize (§4), resolve mapping + deliverability (§3), then ONE
   transaction: Prospect + ProspectActivity + consent-ledger events +
   `persistEventDeliveries('lead.created'|'lead.held', …, {destination})`
   + inbox row → `completed` (codex F2: delivery intent commits with the
   prospect; the webhookService recovery poll owns crash-resume).
   Post-commit: `flushDeliveries()`, DNC post-commit hooks, assignment
   email — all fire-and-forget.

### 2.3 Raw body + limiter + public-surface snapshot (codex F14)

`server_internal.js`: add `/api/meta/` to the raw-body verify allowlist AND
the production limiter's server-to-server exemption. Add `GET /webhook` +
`POST /webhook` under `/api/meta` to `routeGateAudit.test.js`'s
`PUBLIC_SURFACE` snapshot.

## 3. Data model + routing

### 3.1 `meta_pages` (migration 112) — page allowlist, no bypass

Columns: id UUID PK, pageId STRING UNIQUE NOT NULL, name STRING,
accessTokenEnc TEXT NOT NULL, isActive BOOL NOT NULL default true,
timestamps (DB defaults). Token sealed AES-256-GCM: envelope
`v1:<keyId>:<iv b64>:<ct b64>:<tag b64>`, random 12-byte IV, **AAD =
pageId**, key = `META_PAGE_TOKEN_ENC_KEY` (exactly 32 bytes, validated at
boot), keyId supports rotation. Write-only via admin API (never echoed);
logs redact. Resolution (codex F12 — env fallback must not bypass the
allowlist): active row for pageId → its token; **inactive row → DENY**
(permanent skip, never fall through); no row → env `META_PAGE_ACCESS_TOKEN`
ONLY IF `META_PAGE_ID === pageId`; else permanent skip (logged, inbox
`dead` with reason `unknown_page`).

### 3.2 `meta_form_mappings` (migration 113)

Columns: id UUID PK, formId STRING UNIQUE NOT NULL, formName STRING,
campaignId UUID NOT NULL FK campaigns ON DELETE RESTRICT, qrTagId UUID NULL
FK qr_tags ON DELETE SET NULL, isActive BOOL NOT NULL default true,
timestamps. Admin CRUD validates: campaign exists + active; qrTag (if set)
belongs to campaign AND has a **direct** `assignedAgentId`/`ownerUserId`
resolving to an active agent (codex F9: group/phone QR variants live only
in the web path's pre-resolver — v1 rejects them rather than overpromising
"like a scan"). Ingest re-validates and demotes a broken qrTag to
campaign-ring routing with a warn log.

### 3.3 Campaign resolution + the no-black-hole guarantee

Order: active mapping for formId → its campaign; mapping's campaign
missing/inactive → `[Meta] Unmapped`; no mapping → `[Meta] Unmapped`.
Then routing `resolveLeadRouting({reqUser:null, requestedAgentId:null,
campaignId, qrTagId})` and the **deliverability guard** (codex F8 — via
label is not the test): if the resolved agent's `destinationForAgent` is
null (provenance-less System Agent), re-resolve against `[Meta] Unmapped`
so `decideAssignment` quarantines `no_funded_agent` → held queue + admin
ping. A `DEFAULT_AGENT_ID` fallback that IS a deliverable real agent
delivers normally. **The final campaign settles BEFORE the duplicate check
and quota/DNC decisions** (codex F5 ordering).

`[Meta] Unmapped` ensured in bootstrap by reserved **slug**
`meta-unmapped` (names aren't unique; slug is), after system-agent ensure:
`status:'active'`, `is_active:true`, `enforceLeadQuota:true`,
`externalEligible:false`. When `META_LEAD_ADS_ENABLED`, ensure failure is
**boot-fatal** (otherwise safeRun-warn as usual). Held visibility
prerequisites (`WEBHOOK_ENABLED`, `HELD_LEAD_PING_ENABLED`,
`HELD_LEADS_EXTERNAL_ENABLED`, mktr_leads subscriber) are all live in prod
today but listed in the rollout preflight; the release sweep is manual-only
(codex F6 — no "+ sweep" guarantee claimed).

### 3.4 Duplicate phone-in-campaign (codex F5, race-safe)

Arbiter = the existing unique index (campaignId, phone)
(`prospects_campaign_id_phone`). Precheck for UX, but the constraint decides:
on `SequelizeUniqueConstraintError` for that index → rollback → reload
winner → NEW transaction: one 'note' ProspectActivity on the winner
("Duplicate Meta form submission — form X, leadgen Y") + inbox row →
`duplicate` (same txn, so replays are no-ops — the inbox is already
terminal). A second distinct leadgenId for the same phone+campaign takes
the same path deterministically.

## 4. Field mapping + sanitization (codex F13)

`parseFieldData`: first/last (full_name split), email (syntax-check else
null), phone → strip `[\s\-()]` → `normalizePhone` → strict E.164 test —
fail ⇒ `phone: null` + bounded audit line in notes (capture-everything; a
webhook has nobody to 422 at), company/jobTitle/city length-clamped to
model limits. Custom Q&A → notes block (agent-facing), NOT sourceMetadata.
`date_of_birth` recorded in notes only (US-format ambiguity; age gates
don't run on this path — documented). Prospect:
`leadSource:'social_media'`, `tags:['meta','lead-ad']`, bounded
`sourceMetadata`: `metaLeadgenId` (arms the existing CAPI/TikTok
suppression guards — codex F16 confirmed key spelling), `metaPageId`,
`metaFormId`, `metaAdId`, `metaAdsetId`, `metaCampaignId`,
`metaCreatedTime`, `metaPlatform`, `metaIsOrganic`,
`utm: { utm_source: fb|ig|meta (platform-mapped), utm_medium:'lead_ads',
utm_campaign: formName||formId }`, consent keys (§5).

## 5. Consent — wired in v1, honestly (codex F4)

- Register `2026-08-06-meta-leadgen-v1` in the `contactConsent.js` registry
  with the exact disclaimer copy + hash (copy ships in the runbook; any
  future edit = new version, registry enforced — unknown versions silently
  substitute legacy copy, which is exactly what we refuse to rely on).
- Extend the ConsentEvent `source` surface with `'meta_lead_ad'` (model
  enum + migration if a DB-level constraint exists — checked at impl;
  otherwise model-only). No lying under `'signup'`.
- Proof: Graph `custom_disclaimer_responses` — checkbox key
  `mktr_pdpa_consent`, `is_checked` truthy ⇒ consent granted; fallback
  accepted: a custom question field named `mktr_pdpa_consent` with an
  affirmative value. Form-build runbook mandates the key. Absent/unchecked
  ⇒ NO consent keys written, lead still captures, ledger records nothing.
- `verified: false` stays (no OTP happened). Consequence documented:
  `canMarketTo` denies nurture/audience use for Meta leads in v1 — agent
  delivery is not gated by it.
- sourceMetadata mirror: `consent_contact: true`,
  `consent_copy_version: '2026-08-06-meta-leadgen-v1'`,
  `consentSource: { channel:'meta_lead_ad', formId, pageId, capturedAt }`.

## 6. Service construction (codex F10 — full DI surface)

`makeMetaLeadService(overrides)` twin of `makeRetellService`, DI listing
ALL of: models (Prospect, ProspectActivity, Campaign, QrTag, User,
MetaPage, MetaFormMapping, MetaLeadgenEvent), sequelize,
resolveLeadRouting, decideAssignment, chargeLeadCredit, dncCaptureGate +
gateHeldDncLead + dncCheckAndRecord + bakeHoldTargetAgentId +
dncEnforcement + formatDncNumber (3-arg gate call, retell parity),
readLegacyViewSafe, resolveConsumerForCaptureTx (NOT retell parity —
deliberate addition, normalized phone, verified:false),
recordCaptureConsentEventsTx, persistEventDeliveries + flushDeliveries,
destinationForAgent + externalIdForDestination + buildLeadCreatedPayload +
buildLeadHeldPayload, sendLeadAssignmentEmail, sealPageToken/openPageToken,
fetch, logger.

## 7. Config + boot validation (codex F3)

`META_LEAD_ADS_ENABLED` (route flag + worker gate + envValidation boolean
list). When enabled in production, **startup fails** unless:
`META_APP_SECRET`, `META_VERIFY_TOKEN`, `META_PAGE_TOKEN_ENC_KEY` (32
bytes) present; `META_PAGE_ID` + `META_PAGE_ACCESS_TOKEN` must be set as a
pair or not at all. `META_GRAPH_API_VERSION` reused (default kept in one
place). env examples + READMEs updated; `docs/reference/ads-and-tracking.md`
+ `README-dev.md` "REMOVED" notes replaced; TRACKER.md entry.

## 8. Tests

Unit: signature (valid/invalid/malformed), parse/sanitize matrix (phone
E.164 fail⇒null+note, email fallback, clamps, full_name split), platform→
utm, token envelope roundtrip + AAD mismatch + inactive-row deny + env
fallback page binding, mapping resolution (active/inactive/unmapped/qr
demotion), deliverability guard (System Agent ⇒ remap+quarantine;
deliverable DEFAULT_AGENT_ID ⇒ delivers), controller matrix (403/401/503,
upsert→200, upsert-fail→500), backoff/dead progression, consent proof
matrix (checked/unchecked/absent/fallback field), suppression guards stay
false for metaLeadgenId leads.

Integration (DB harness): webhook→inbox→worker→prospect e2e (normalized
phone, bounded sourceMetadata, utm, consent events rows, delivery row
destination-matched per agent provenance — one lyfe, one mktr_leads case);
replay webhook ⇒ single inbox row; duplicate phone race via constraint ⇒
activity on winner + inbox 'duplicate'; unmapped ⇒ `[Meta] Unmapped`
quarantine `no_funded_agent` (+ held delivery row when flag on); qr
mapping ⇒ via 'qr'. Frozen `lead.created` payload fixture (the mktr-leads
receiver contract). Migration suite: 112/113/114 with real `down()`
(required by migrations.test.js) + table/FK/index assertions.

## 9. Rollout preflight (Shawn's runbook ships with the PR)

1. Merge → verify a NEW Render deploy actually appeared (auto-deploy has
   silently dropped pushes before).
2. Env: `META_LEAD_ADS_ENABLED=true`, `META_APP_SECRET`,
   `META_VERIFY_TOKEN`, `META_PAGE_TOKEN_ENC_KEY`; confirm
   `WEBHOOK_ENABLED=true`, `HELD_LEAD_PING_ENABLED=true`,
   `HELD_LEADS_EXTERNAL_ENABLED=true` (live today — preflight-confirm).
3. Meta dashboard: webhook URL + verify phrase → green; subscribe
   `leadgen`; System User token (leads_retrieval + pages perms); subscribe
   the Page to the app; App Review for Live (dev mode tests owned pages).
4. Admin API: register page (token sealed at rest), map form → campaign
   (validated), fund agents or rely on held queue.
5. Lead Ads Testing Tool: submit test lead → inbox → prospect → push on
   device → FB/IG badge → delete test lead.
6. First real ad; watch `[Meta]` logs, inbox dead-letter count, held queue.
