# .review security-audit remediation — final record (Aug 2026)

The `.review/` dashboard tracked the 45-task remediation queue from the
July 2026 security/architecture audit of this repo. **All 45 tasks are
resolved.** This document is the exported final state — written by task P5-1
immediately before the scaffolding was deleted (the dashboard was only ever
the interface to this record).

- P0/P1 batch shipped via PR #323 + #331 (live on api.mktr.sg 2026-08-01).
- P2-2 … P4-10 shipped as one PR per task, each CI-gated and squash-merged:
  #332–#338, #342–#363 (2026-08-01 → 2026-08-02, autonomous run).
- P5-1 (this teardown) rides the PR that carries this document.

Statuses: every task `done` = verified + merged to main. Nothing was
blocked or skipped.


## P0

### P0-1 — Campaign search silently drops role scoping
- **Status:** done
- **Proof:** listCampaigns search no longer overwrites the non-admin role scope: both OR groups (createdBy/isPublic scope + name/description search) now combine under Op.and in campaignService; DB + unit regression tests added

### P0-2 — Public signup can self-promote to agent
- **Status:** done
- **Proof:** Removed POST /auth/onboarding/role (route+controller+service fn) — self-registration can no longer self-promote to agent; hardened authService.register to always create customer; Onboarding page short-circuited to invitation-only notice; invite flow proven intact; regression tests added (404 + 403 + role-stays-customer)

### P0-3 — Google OAuth issues a token despite identity mismatch
- **Status:** done
- **Proof:** googleSub mismatch now throws non-enumerating 401 in BOTH Google doors (OAuth callback + legacy one-tap, which had the same hole); redundant nested if removed; 4 unit tests added incl. NULL-sub first-link safety; history (62fb0a2) shows permissiveness was deferred MVP hardening, no migration path relies on it

### P0-4 — URL-credential routes leak secrets into logs
- **Status:** done
- **Proof:** TOKEN_PATH_RE now covers all 8 URL-credential shapes (swept every :param route; added screening-callback, discovery webhook secret, auth verify/reset/invite tokens, provisioning deviceKey poll) + new ?t= query rule for the redeem.sg/callback screening link; frontend twin updated identically; parity test tables on both sides (27 jest + 12 vitest assertions); recommend rotating the static Apify webhook secret

### P0-5 — Retired public endpoints live: unauth provisioning + default-on beacons
- **Status:** done
- **Proof:** provisioning.js now behind PROVISIONING_ENABLED (default off — kills the anon deviceKey handout), apk.js behind APK_ENABLED (default off — kills the public binary), beacons flagDefault flipped to false; swept all retired surfaces (devices/vehicles/fleet/commissions stay mounted but are JWT-authed — reported); README false flag-gating claim fixed in 3 places; env.example gained both flags; clean-env boot verified all five endpoints 404 while /health stays 200; provisioning/rbac/security suites now opt in via env preamble (293 tests green)


## P1

### P1-1 — Quiz anti-tamper rescoring runs twice (duplicated block)
- **Status:** done
- **Proof:** Deleted the byte-identical 2nd copy of the quiz re-score block in createProspect (39 lines); dup-scan found no other accidental blocks; all quiz + prospect suites pass (bulkOps crash pre-exists at HEAD, local-only, unrelated)

### P1-2 — CI never runs 17 backend test files
- **Status:** done
- **Proof:** Folded all 21 stray suites into test/unit (17 src/tests + src/integrations AdapterRegistry + 3 name-collision strays renamed), fixed imports; repaired 2 stale-red suites (referralAttribution spy net, campaignReadiness railActive fixtures + new rail coverage); jest --listTests proves 0 suites escape the CI patterns; 9 pre-existing local-only red suites documented, none caused by the move

### P1-3 — retellScreening suite fails by time of day
- **Status:** done
- **Proof:** Pinned retellScreening.test.js to a fixed SGT instant (Date-only fake timers; re-pin after the one mid-test useRealTimers), added boundary-minute tests (start/end/±1min, the 23:59 CI minute, midnight reopen, 24:00-clamp) at helper AND service level; verified green under ambient clocks 23:59:30/23:59:59/00:00:05/09:59:30/12:00 SGT via a setupFiles Date-shift harness; swept all backend suites — no other suite's result is wall-clock dependent (2 fragile-but-safe patterns + retired-domain commissionService month-boundary noted)

### P1-4 — Lead-package money path: non-atomic top-up and unguarded assign
- **Status:** done
- **Proof:** topUpAssignment delta is now one column-relative SQL UPDATE (conserves credits vs concurrent charges; status guard blocks resurrecting cancelled rows); extracted lockedAssignActive — ONE advisory-locked idempotent core behind assignPackage/assignPackageExternal/bulkAssignPackage (admin path gains dup-guard + active-only; double-click returns existing row, controller skips dup email); new real-PG concurrency suite proves conservation + exactly-one-active across paths (stable 3 runs); 9 related suites green (203 tests)

### P1-5 — Entitlement race-recovery can return another activation's row
- **Status:** done
- **Proof:** Scoped both entitlementService unique-violation recovery reads to resolvedActivation.id (phone catch + generic anchor catch now mirror their per-activation indexes exactly); audited redemption/claim/pool/draw-rail handlers — all others correctly scoped or throw-only (redemptions unique is FULL on entitlementId, drawBoost winner lookup matches uq_act_live_campaign); new real-PG suite reproduces both cross-activation cases against the real partial indexes (fails on pre-fix HEAD at the cross-activation asserts, passes with fix)

### P1-6 — Reconciliation sweep swallows issuance errors silently
- **Status:** done
- **Proof:** Logged the entitlement-sweep swallow + 12 sibling silent catches (round-robin, dashboards, gates, PDPA repair); fail-closed the draw-context lookups in redemption verify/complete + voucher resend and the screening sweep's drain decision

### P1-7 — Retell fallback notification targets a non-existent account
- **Status:** done
- **Proof:** retellService no-agent fallback now resolves the System Agent via getSystemAgentId (DI-injected) instead of the dead findOne on 'system@mktr.sg' — that notification had silently never sent; regression test pins the resolved row + bans the literal lookup (29 unit tests green, all 7 importer suites green); backend swept: no other live identity-literal mismatch (mailer + cadenceSeeds already env-driven, only scripts/archive keeps literals); CLAUDE.md debt list corrected (fake-retell-email and shawnleejob redirect entries were already fixed in code); NOTE retell.test.js (stale pre-bc76365 signer), emailService, shortlinkService, consentGlobalGrant(crash) verified red/crashing at pristine HEAD worktree — pre-existing, untouched

### P1-8 — Campaign name sanitisation applies on create but not update
- **Status:** done
- **Proof:** Hoisted ONE exported sanitizeCampaignName (tag-strip+trim) in campaignService and applied it on create + update + duplicate (duplicate also cleans the derived '$name (Copy)' default, which feeds buildDrawTermsHtml); 5 parity tests added (59 green; all 7 campaignService-importing suites + DB integration suite green). Surface audit: REAL exposure = agent-facing HTML-string emails (mailer.js:139 lead-assignment — reachable by any agent PUT pre-fix — and :353 package-assignment); NOT exposed: JSX/admin UI (auto-escape), public terms (DOMPurify), generated draw terms + customer/Onyx email (both escapeHtml campaignName+prizes), billing PDF (pdfkit glyphs), satori cards (no name usage), WhatsApp (text). Recommend follow-up: sink-side escaping in mailer.js (packageDetails.name still interpolates raw — different input field). Other-field asymmetry: NONE — description has no write path anywhere; drawCopy/prizes/T&C ride design_config which is clamped identically on create+update (marketplace normalizer length-clamps only, but renders JSX-only)

### P1-9 — Unknown task status returns unfiltered results
- **Status:** done
- **Proof:** listTasks status filter: 'all' handled first, known values filter exactly, unknown values fall back to the open/in_progress default instead of unfiltering; regression test added (red-verified)

### P1-10 — Draw terms twin omits prize caps the save path enforces
- **Status:** done
- **Proof:** cleanRows in both drawTermsTemplate twins now applies the server caps (8 rows/80-char names/qty 1..99-else-1) imported from new dependency-free luckyDrawCaps.js shared with luckyDraw.js; parity + wording tests cover over-cap input; SPA→backend direct import re-proven viable (vite build green)


## P2

### P2-1 — Ignore build output (dist-mktr) and stop linting it
- **Status:** done
- **Proof:** dist-*/ pattern in .gitignore + 'dist-*' in eslint ignores (replaces per-variant lines; verified via check-ignore on 5 path shapes + eslint dummy-file skip); swept both packages: zero untracked-unignored files, junk inventory reported (dist 5.4M + dist-mktr 5.3M regenerable, backend/.tmp Mar load-test relic, DS_Store, dual backend env examples)

### P2-2 — Delete verified orphan files (~1,600 lines)
- **Status:** done
- **Proof:** Deleted 13 verified-orphan frontend files (CustomerLogin page copy, Base44 residue incl mktrAPI/functions/4 Core placeholders, services barrel, TableSkeleton, LeadPackageDialog, CampaignInfoCard, CarQRSelection+3 children, useFleetQuery, devices/AssignCampaignDialog) + folded forms/__tests__ into subject dirs; KEPT AgentFormDialog — alive via InviteAgentDialog re-export used by AdminAgents; 3 brand builds + 2141 vitest green; shipped as PR #332

### P2-3 — Delete 18 unused UI primitives and 13 npm packages
- **Status:** done
- **Proof:** Deleted 18 zero-importer ui primitives (accordion→toggle-group + toggle/toast/use-toast) + uninstalled their 13 orphaned packages (radix ×10, embla, resizable-panels, vaul; kept recharts + slot per live importers); CSS −10.4 kB/−8.3% both brands (JS was never bundled), node_modules −3.4 MB; builds ×3 + 2141 vitest + Playwright render on both brands green; coverage blanket kept (post-prune ui/** ≡ in-use set); shipped as PR #333

### P2-4 — Delete the public /preview design prototypes
- **Status:** done
- **Proof:** Deleted src/pages/preview/ (4 prototypes, 1808 lines) + their lazy imports/routes + robots Disallow line; dev-gated /LeadCapture/demo via import.meta.env.DEV (chunk fully stripped from prod, demo intact on dev server); left pixelSuppression fail-safe entries; both brands: prototype/demo chunks gone from dist, routes 404 (Playwright-proven), 2141 vitest green; shipped as PR #334

### P2-5 — Delete the unreachable classic DesignEditor (~1,800 lines)
- **Status:** done
- **Proof:** Reduced DesignEditor to the guided_review dispatcher (304→22 lines) + deleted the 8-file campaigns/editor/ tree and V2Guard test after re-proving unreachability; hoisted STARTER_QUIZ/BLANK_QUIZ verbatim to src/lib/quizTemplates.js and repointed the Studio panel + 2 tests; StudioV2Notice (lived in DesignEditor.jsx, zero importers) deleted with its branch; previewFixtureInertness checked = live-funnel only, untouched; GuidedReviewDesigner proven in-browser via /GuidedReviewDemo post-surgery; workspace+studioFlag byte-untouched; 2119 vitest + 3 builds green; shipped as PR #335

### P2-6 — Hard-cut the v1 admin pages (2,633 lines)
- **Status:** done
- **Proof:** Flag verified true on mktr (Render API; redeem/ops unreachable-by-design) then hard-cut: ADMIN_V2 removed, 9 ternaries collapsed to v2 on same URLs, 51 files/-8729 lines deleted (9 pages + orphaned components + 14 tests); AgentDetail & LeadPackages re-shelled in AdminV2Shell legacyBridge; dist -18.7%; PR #336

### P2-7 — Fleet/device/commission teardown — frontend (~6,200 lines)
- **Status:** done
- **Proof:** Fleet/devices/commissions/APK frontend teardown: 15 routes + 13 pages + nav groups + retired role branches (prod has 0 such users; fallback /Homepage) + fleet data layer + Onboarding wizard (route+closed card kept for 3 prod customers) + CarQRDirectory tab excision; 69 files, -11729 lines; 23/23 Playwright, 3 builds green; PR #338 stacked on #336

### P2-8 — Fleet/device/commission teardown — backend (~2,600 lines)
- **Status:** done
- **Proof:** Backend fleet/device/commission/APK teardown: 9 routes/45 endpoints + 5 controllers + 6 services (pushService boot timers gone) + deviceAuth + requireFleetOwnerOrAdmin + carCreate/fleetOwnerCreate + campaign commission fields (Joi now 400s; frontend senders trimmed as riders) + campaignService device fan-out; 54 files, -9384 lines; boot verified 404s+no heartbeat, 132/132 integration green; PR #342 stacked on #338

### P2-9 — Retired models: untangle live callers, then remove
- **Status:** done
- **Proof:** 13 retired models deleted after excising all live call sites (commission mint, media playlist, fleet dashboards/onboarding, delete gates per FK reality); tables kept; fresh-DB correctness proven; PR #343 merged

### P2-10 — Sweep dead backend exports
- **Status:** done
- **Proof:** dead exports swept: resolveAssignedAgentId wrapper + 12 mock mirrors, redeemOps _default layers, unused seams, 2 phantom permission caps (twin-synced); PR #344 merged

### P2-11 — Resolve uncalled Redeem Ops endpoints
- **Status:** done
- **Proof:** all 4 endpoints kept as documented-design-missing-UI (ROUTE_MAP annotated); inventory reconcile() wired into 15-min fulfilment sweep as pure drift detector, scratch-verified; PR #345 merged

### P2-12 — Delete dead scripts and fix the prod image contents
- **Status:** done
- **Proof:** qrAssignmentTest + debug_auth_login + expired sa61 reminder deleted (Render cron already suspended; whitelist line dropped — image carries only 3 live ops scripts); 2 one-shot seeders archived; rebuild-consumer-spine kept as live repair tool; PR #346 merged


## P3

### P3-1 — Document the 125 undocumented environment variables
- **Status:** done
- **Proof:** env.example trued up to full 219-var coverage (+PHONE_VERIFICATION_DURABLE_TTL_MS, -5 retired), ENABLE_AUTH_MAPPING loud + boot warning, 46-flag typo guard in envValidation, .env.production untracked; PR #347 merged

### P3-2 — Remove the dead morgan dependency
- **Status:** done
- **Proof:** morgan + http-proxy-middleware (audit find) uninstalled, jest comment fixed, pg-hstore fenced in README; boot graph + 123 unit suites verified; PR #348 merged

### P3-3 — Seed scripts mint an admin with a hardcoded password
- **Status:** done
- **Proof:** seed.js guarded (prod + non-local DB_HOST refusal, env-required passwords, no fleet seed) — all 4 cases executed; updateUsers.js deleted; ops-script survey reported; PR #349 merged

### P3-4 — Fix skipped tests and toothless assertions
- **Status:** done
- **Proof:** P0-1 scoping test armed + revert-verified (fails on neutered scope, restored byte-identical); metrics skips → live no-op-contract tests; agentAssignmentMode skip deleted; 8 multi-status asserts pinned; worst offenders reported; PR #350 merged

### P3-5 — Backend lint cannot catch undefined variables
- **Status:** done
- **Proof:** no-undef armed backend-wide (globals were already configured — off-switch removed); caught 1 real write-only-undeclared-global bug in config.test.js + 1 unused import; src/ was clean; PR #351 merged

### P3-6 — CI coverage gate enforces nothing
- **Status:** done
- **Proof:** coverage ratchets live both sides (backend 49/41/42/51 vs measured 50.78/42.13/43.87/53.06; frontend 48/46/38/50 vs 49.44/47.61/39.71/51.46); grep gate replaced by jest exit code; fail-mode proven at 99%; PR #352 merged (its CI = pass-proof)

### P3-7 — Decide the fate of unrun e2e specs and paused scaffolds
- **Status:** done
- **Proof:** 6 self-skipping stale e2e specs + services/ + tablet-app/ archived to _archive/retired-code (copies + README); smoke.spec.js kept with new e2e-smoke CI job (green on this PR); untracked docs already committed; PR #353 merged


## P4

### P4-1 — Centralise rules duplicated across 3-7 sites
- **Status:** done
- **Proof:** 7 rules + micro-helpers centralised in 8 commits (SLUG_RE, longDate, cleanYmd, assertSingleWinnerDraw, partnerDisplayName, isManagerTier tiers, phoneDigits contract map, objects.js); 2 real bugs fixed (analytics brandName drop, isPlainObject twin divergence); full DB tier 132/132; PR #354 merged

### P4-2 — Unify the two WhatsApp Cloud API clients
- **Status:** done
- **Proof:** one waGraphClient (retry now covers OTP — proven by new 2×500→success test); sender separation preserved (META_WA_* deliberate override, zero Render changes needed); 3 masks named in phoneMask.js; 151 suites green; PR #355 merged

### P4-3 — Split prospectService (3,042 lines, ~20 responsibilities)
- **Status:** done
- **Proof:** prospectService 3,089→~1,700 lines: idempotencyProtocol.js primitives (3 orderings preserved), prospectShared.js consts, reads/held-queue/assignment sub-factories with byte-compatible API; safeBody fix; 303 prospect tests + full unit+DB tiers green with zero test edits; PR #356 merged

### P4-4 — Split campaignService and make campaign types extensible
- **Status:** done
- **Proof:** campaignService 1,336→1,117 + campaignTypes.js registry (7 enum sites derive), TEMPLATE_REGISTRY in both twins w/ declarative clamp rules + one-entry extension test, campaignDrawGuards.js (deduped 422s), campaignScope.js; unit 2,105 + vitest 1,779 + DB tier green, zero test edits; PR #357 merged

### P4-5 — Converge admin assign paths onto the transactional outbox
- **Status:** done
- **Proof:** assignProspect held-release + bulkAssignProspects persist deliveries in-txn w/ fail-closed 409 (outbox parity); 5-test crash-sim integration suite incl. recoverPendingRetries pickup; 4 remaining flip-then-dispatch sites audited in PR; DB tier 133/2,437 green; PR #358 merged

### P4-6 — Standardise route validation
- **Status:** done
- **Proof:** users.js/agents.js admin writes schema-guarded (8 registry schemas), editActivity direction/occurredAt/summary gap closed, 2 local validate() copies deleted, idiom documented in README; 9-test suite + invitations adaptation; DB tier green; PR #359 merged

### P4-7 — Break the campaignPage import cycle and other layering inversions
- **Status:** done
- **Proof:** madge 0 cycles both trees (was 2+1): campaignPage shared.jsx hoist + TDZ workaround removed + dead ternary, webhook↔suppression inverted via registerPropagationCatchup, 47 services → pure appError.js, prospectScope → services/, sgDateKey/sgtDayWindow → utils/sgtTime; vitest 1,779 + DB tier 2,446 green; PR #360 merged

### P4-8 — Finish or remove the half-built multi-tenancy
- **Status:** done
- **Proof:** Decision A: tenant middleware + tid stamp + dead scope filters + 4 orphan test mocks + 10 stale TODOs deleted (header path confirmed inert: model never declared tenant_id AND auth always stamped tid); migration 011 + DB columns untouched; DB tier 134/2,446 green; PR #361 merged

### P4-9 — Deduplicate lead-routing and the ad-event mirrors
- **Status:** done
- **Proof:** resolveLeadRouting = thin wrapper over resolveLeadAssignment (drift decision stated: QR groups/phone stay in createProspect's pre-resolver block); retell → shared buildLeadCreatedPayload + extracted dncCaptureGate; TikTok honours ctx.eventTime (Meta parity test); Meta-only down-funnel asymmetry reported; factory deliberately not extracted; CI green; PR #362 merged

### P4-10 — Reduce request-path overhead: double auth and unbounded eager loads
- **Status:** done
- **Proof:** auth findByPk 2.0→1.0/req (measured 600→300 over 300 reqs, 473→430ms); getAgentDetail + campaign-counts → grouped SQL (unbounded loads gone, arrays unread by any consumer); uploads stream w/ stat-time length (stale file.size hazard caught) + full fs/promises; redeemOps metrics+drawContext batched; CI green; PR #363 merged


## P5

### P5-1 — Remove this dashboard and its scaffolding
- **Status:** done
- **Proof:** dashboard server stopped, final state exported to docs/review-audit-2026-08.md, .review/ scaffolding deleted, .gitignore line removed

