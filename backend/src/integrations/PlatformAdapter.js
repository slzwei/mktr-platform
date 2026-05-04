/**
 * @file PlatformAdapter — interface contract for downstream-platform adapters.
 *
 * MKTR was designed to fan leads out to a single platform (Lyfe). Going
 * forward we want to support multiple platforms (HubSpot, Salesforce, other
 * agencies' CRMs) without rewriting the core lead-routing or sync logic for
 * each one.
 *
 * Each platform has its own way of storing agents/users. To keep the core
 * services platform-agnostic, every platform implements this interface and
 * registers via {@link ./AdapterRegistry.js}.
 *
 * ── Lifecycle ──────────────────────────────────────────────────────────────
 *
 * Adapters are singletons, lazily constructed on first use. They own their
 * own circuit breakers, caches, and configuration (env vars). The core
 * services discover them via the registry — never via direct import.
 *
 * ── Contract methods ───────────────────────────────────────────────────────
 *
 * Adapters MUST implement:
 *   - id              the platform's stable string id (e.g., 'lyfe')
 *   - listAgents()    returns ExternalAgent[] of all assignable agents
 *   - getAgent(id)    returns one ExternalAgent by external id
 *
 * Adapters MAY implement:
 *   - subscribeToChanges(cb)  push-style change notification (webhooks)
 *   - outboundWebhookUrl()    where to POST leads (used by webhookService)
 *
 * ── Phase 1 scope (this file) ──────────────────────────────────────────────
 *
 * Phase 1 hides Lyfe-specific REST, auth, env vars, and circuit-breaker
 * state behind the adapter. The local `users.lyfeId` column is intentionally
 * retained until Phase 3 introduces a generic `external_agents` table.
 *
 * See AGENT_INTEGRATION_PLAN.md (root of mktr-platform) for the full plan.
 */

/**
 * @typedef {object} ExternalAgent
 *  Platform-agnostic agent shape. Returned by adapters.listAgents() and
 *  adapters.getAgent(). The orchestrator uses this shape to upsert into
 *  MKTR's local `users` table (via the adapter's local-id mapping).
 *
 * @property {string}  externalId    The stable id assigned by the upstream
 *                                   platform. For Lyfe this is the Supabase
 *                                   users.id (UUID).
 * @property {string|null} fullName  Display name; null if upstream lacks one.
 * @property {string|null} email     May be null; do NOT synthesize.
 * @property {string|null} phone     E.164-ish without "+" prefix; null if
 *                                   upstream lacks one.
 * @property {'agent'|'manager'|'director'} externalRole
 *                                   Upstream role. Phase 1 collapses all
 *                                   of these to local 'agent' for MKTR's
 *                                   permission model; Phase 2 adds an
 *                                   `external_role` column to preserve.
 * @property {boolean} isActive      Upstream active flag. Inactive agents
 *                                   are still listed so the orchestrator
 *                                   can deactivate locally.
 * @property {string|null} avatarUrl
 * @property {string|null} dateOfBirth
 * @property {string|null} createdAt ISO timestamp; informational.
 * @property {object} [raw]          Full upstream payload, for debugging.
 */

/**
 * @typedef {object} PlatformAdapter
 *
 * @property {string} id
 *   Stable, lowercase platform identifier. Must match the value used to
 *   register in AdapterRegistry. Examples: 'lyfe', 'hubspot'.
 *
 * @property {string} localIdField
 *   Name of the column on MKTR's local `users` table that stores this
 *   platform's externalId. Phase 1: 'lyfeId' for LyfeAdapter. Phase 3 will
 *   collapse all platforms onto a single (platform_id, external_id) pair.
 *
 * @property {() => Promise<ExternalAgent[]>} listAgents
 *   Fetches all assignable agents (agent, manager, director roles).
 *   Implementations should respect upstream activity flags but still return
 *   inactive rows so the orchestrator can mark them inactive locally.
 *
 * @property {(externalId: string) => Promise<ExternalAgent>} getAgent
 *   Fetches one agent. Throws if not found. Used by lead-routing on the
 *   hot path; should be cached aggressively (TTL ~5 min).
 *
 * @property {() => void} [invalidateCache]
 *   Optional. Clears any internal cache. Called after manual sync runs.
 *
 * @property {((cb: (event: object) => void) => void)} [subscribeToChanges]
 *   Optional. Push-style change notifications. Lyfe doesn't expose this
 *   today; HubSpot/Salesforce do via webhooks. Implementations that don't
 *   support push should omit this method (orchestrator falls back to
 *   polling).
 */

// This file is documentation-only — no runtime exports. Adapters self-register
// via AdapterRegistry.register(adapter).
export {};
