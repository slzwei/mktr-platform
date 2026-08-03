
CREATE SCHEMA auth;

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

COMMENT ON EXTENSION pg_trgm IS 'text similarity measurement and index searching based on trigrams';

CREATE TYPE public.enum_campaigns_status AS ENUM (
    'draft',
    'active',
    'paused',
    'completed',
    'archived'
);

CREATE TYPE public.enum_campaigns_type AS ENUM (
    'lead_generation',
    'brand_awareness',
    'product_promotion',
    'event_marketing',
    'quiz',
    'guided_review'
);

CREATE TYPE public.enum_lead_package_assignments_status AS ENUM (
    'active',
    'completed',
    'cancelled',
    'expired'
);

CREATE TYPE public."enum_lead_packages_deliveryMethod" AS ENUM (
    'email',
    'api',
    'csv_download',
    'dashboard'
);

CREATE TYPE public.enum_lead_packages_status AS ENUM (
    'active',
    'inactive',
    'draft',
    'archived'
);

CREATE TYPE public.enum_lead_packages_type AS ENUM (
    'basic',
    'premium',
    'enterprise',
    'custom'
);

CREATE TYPE public.enum_payments_source AS ENUM (
    'mktr_leads_app',
    'web',
    'admin_comp'
);

CREATE TYPE public.enum_payments_status AS ENUM (
    'pending',
    'paid',
    'failed',
    'expired',
    'refunded',
    'comp'
);

CREATE TYPE public.enum_prospect_activities_type AS ENUM (
    'created',
    'assigned',
    'updated',
    'viewed'
);

CREATE TYPE public."enum_prospects_leadSource" AS ENUM (
    'qr_code',
    'website',
    'referral',
    'social_media',
    'advertisement',
    'direct',
    'call_bot',
    'other'
);

CREATE TYPE public."enum_prospects_leadStatus" AS ENUM (
    'new',
    'contacted',
    'qualified',
    'proposal_sent',
    'negotiating',
    'won',
    'lost',
    'nurturing'
);

CREATE TYPE public.enum_prospects_priority AS ENUM (
    'low',
    'medium',
    'high',
    'urgent'
);

CREATE TYPE public.enum_qr_tags_status AS ENUM (
    'active',
    'inactive',
    'archived'
);

CREATE TYPE public."enum_users_approvalStatus" AS ENUM (
    'pending',
    'approved',
    'rejected'
);

CREATE TYPE public.enum_users_role AS ENUM (
    'admin',
    'agent',
    'fleet_owner',
    'driver_partner',
    'customer',
    'redeem_ops'
);

CREATE TABLE auth.tenants (
    id uuid NOT NULL,
    name text DEFAULT 'Default Tenant'::text NOT NULL,
    slug text,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public._migrations (
    name character varying(255) NOT NULL,
    "appliedAt" date DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE public.activation_issuance_skips (
    id uuid NOT NULL,
    "campaignId" uuid,
    "activationId" uuid,
    reason character varying(32) NOT NULL,
    via character varying(16),
    "createdAt" timestamp with time zone NOT NULL
);

COMMENT ON COLUMN public.activation_issuance_skips.reason IS 'no_active_activation|activation_not_active|allocation_exhausted|offer_not_active|activation_ended|quarantined|phone_not_verified|no_phone|duplicate_phone';

COMMENT ON COLUMN public.activation_issuance_skips.via IS 'hook|sweep|manual';

CREATE TABLE public.activations (
    id uuid NOT NULL,
    "partnerOrganisationId" uuid NOT NULL,
    "rewardOfferId" uuid NOT NULL,
    "campaignId" uuid,
    "campaignNameSnapshot" character varying(160),
    "allocatedQuantity" integer DEFAULT 0 NOT NULL,
    "issuedCount" integer DEFAULT 0 NOT NULL,
    "redeemedCount" integer DEFAULT 0 NOT NULL,
    status character varying(16) DEFAULT 'draft'::character varying NOT NULL,
    "unlockPolicy" character varying(16) DEFAULT 'agent_unlock'::character varying NOT NULL,
    "startDate" timestamp with time zone,
    "endDate" timestamp with time zone,
    "internalNotes" text,
    "renewalOutcome" character varying(24),
    "createdBy" uuid NOT NULL,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL,
    CONSTRAINT chk_activations_quantity_ordering CHECK ((("allocatedQuantity" >= "issuedCount") AND ("issuedCount" >= "redeemedCount") AND ("redeemedCount" >= 0)))
);

COMMENT ON COLUMN public.activations."campaignId" IS 'Canonical MKTR campaign reference — SET NULL on campaign delete; snapshot below keeps display alive';

COMMENT ON COLUMN public.activations."issuedCount" IS 'Guarded counter (Phase 6 issuance)';

COMMENT ON COLUMN public.activations.status IS 'draft|preparing|active|paused|completed|cancelled';

COMMENT ON COLUMN public.activations."unlockPolicy" IS 'on_capture = voucher live at signup; agent_unlock = consultant unlocks at the meeting (default)';

COMMENT ON COLUMN public.activations."renewalOutcome" IS 'renewed|not_renewed|pending (Phase 7)';

CREATE TABLE public.agent_group_members (
    id uuid NOT NULL,
    "agentGroupId" uuid NOT NULL,
    "userId" uuid,
    phone character varying(20) NOT NULL,
    email character varying(255),
    name character varying(100),
    "lyfeId" character varying(100),
    "sortOrder" integer DEFAULT 0 NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.agent_groups (
    id uuid NOT NULL,
    name character varying(255) NOT NULL,
    description character varying(255),
    "createdBy" uuid NOT NULL,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);

CREATE TABLE public.ai_settings (
    id character varying(32) DEFAULT 'global'::character varying NOT NULL,
    "defaultProvider" character varying(16) DEFAULT 'openai'::character varying NOT NULL,
    "openaiModel" character varying(100) DEFAULT 'gpt-5.6-terra'::character varying NOT NULL,
    "anthropicModel" character varying(100) DEFAULT 'claude-sonnet-4-6'::character varying NOT NULL,
    "openaiKeyEncrypted" text,
    "openaiKeyHint" character varying(12),
    "anthropicKeyEncrypted" text,
    "anthropicKeyHint" character varying(12),
    "globalGuardrails" text DEFAULT ''::text NOT NULL,
    "workstylePreferences" text DEFAULT ''::text NOT NULL,
    "updatedBy" uuid,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);

CREATE TABLE public.attributions (
    id uuid NOT NULL,
    "qrTagId" uuid NOT NULL,
    "qrScanId" uuid NOT NULL,
    "sessionId" character varying(64),
    "firstTouch" boolean DEFAULT false,
    "lastTouchAt" timestamp with time zone,
    "expiresAt" timestamp with time zone NOT NULL,
    "usedOnce" boolean DEFAULT false,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);

CREATE TABLE public.campaign_agent_assignments (
    id uuid NOT NULL,
    "campaignId" uuid NOT NULL,
    "agentId" uuid NOT NULL,
    "assignedAt" timestamp with time zone NOT NULL
);

CREATE TABLE public.campaign_media_items (
    id uuid NOT NULL,
    "campaignId" uuid NOT NULL,
    "mediaType" character varying(20) NOT NULL,
    url text NOT NULL,
    "durationSecs" integer,
    "sortOrder" integer DEFAULT 0 NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.campaign_previews (
    id uuid NOT NULL,
    "campaignId" uuid NOT NULL,
    slug character varying(64) NOT NULL,
    snapshot json DEFAULT '{}'::json NOT NULL,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);

CREATE TABLE public.campaigns (
    id uuid NOT NULL,
    name character varying(255) NOT NULL,
    description text,
    status public.enum_campaigns_status DEFAULT 'draft'::public.enum_campaigns_status,
    type public.enum_campaigns_type DEFAULT 'lead_generation'::public.enum_campaigns_type,
    budget numeric(10,2),
    "spentAmount" numeric(10,2) DEFAULT 0,
    "targetAudience" jsonb DEFAULT '{}'::jsonb,
    "startDate" timestamp with time zone,
    "endDate" timestamp with time zone,
    start_date timestamp with time zone,
    end_date timestamp with time zone,
    min_age integer DEFAULT 18,
    max_age integer DEFAULT 65,
    is_active boolean DEFAULT true,
    design_config json DEFAULT '{}'::json,
    "landingPageUrl" character varying(255),
    "callToAction" character varying(255),
    tags text DEFAULT '[]'::text,
    "isPublic" boolean DEFAULT false,
    "createdBy" uuid NOT NULL,
    "defaultAssignmentMode" character varying(255) DEFAULT 'direct'::character varying NOT NULL,
    commission_amount_driver numeric(10,2),
    commission_amount_fleet numeric(10,2),
    meta_pixel_id character varying(64),
    external_eligible boolean DEFAULT false NOT NULL,
    enforce_lead_quota boolean DEFAULT false NOT NULL,
    tiktok_pixel_id character varying(64),
    gift_name character varying(120),
    gift_price_from_mktr numeric(10,2),
    gift_note text,
    agent_notes jsonb,
    slug character varying(80),
    "firstActivatedAt" timestamp with time zone,
    "leadPriceCents" integer,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL,
    tenant_id uuid DEFAULT '00000000-0000-0000-0000-000000000000'::uuid NOT NULL
);

COMMENT ON COLUMN public.campaigns.external_eligible IS 'When true, leads for this campaign may route to external MKTR Leads buyers (consent-gated).';

COMMENT ON COLUMN public.campaigns.agent_notes IS 'string[] agent obligations; NULL treated as [] by the catalog';

COMMENT ON COLUMN public.campaigns.slug IS 'Marketplace URL handle (/offers/:slug, /flow/:slug only). Immutable once firstActivatedAt is set.';

COMMENT ON COLUMN public.campaigns."firstActivatedAt" IS 'Stamped the first time is_active flips true; locks the slug';

CREATE TABLE public.cohorts (
    id uuid NOT NULL,
    name character varying(120) NOT NULL,
    description text,
    definition jsonb NOT NULL,
    "createdBy" uuid,
    "lastTotalCount" integer,
    "lastReachableCount" integer,
    "lastPreviewBreakdown" jsonb,
    "lastPreviewAt" timestamp with time zone,
    "archivedAt" timestamp with time zone,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);

COMMENT ON COLUMN public.cohorts.definition IS 'filters + ageGate (minAge ≥ 18, §9.5-2 binding) + marketingContext';

COMMENT ON COLUMN public.cohorts."lastPreviewBreakdown" IS 'byReason counts at last snapshot';

COMMENT ON COLUMN public.cohorts."archivedAt" IS 'Soft-archive — push send logs will FK cohorts';

CREATE TABLE public.consent_events (
    id uuid NOT NULL,
    "consumerId" uuid NOT NULL,
    "prospectId" uuid,
    "campaignId" uuid,
    kind character varying(32) NOT NULL,
    granted boolean NOT NULL,
    channels jsonb,
    version character varying(64) NOT NULL,
    source character varying(32) NOT NULL,
    "sourceUrl" text,
    verified boolean DEFAULT false NOT NULL,
    "actorUserId" uuid,
    metadata jsonb,
    "occurredAt" timestamp with time zone NOT NULL,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL,
    CONSTRAINT chk_ce_kind CHECK (((kind)::text = ANY ((ARRAY['contact'::character varying, 'campaign_terms'::character varying, 'third_party'::character varying, 'dnc_override'::character varying, 'draw_terms'::character varying])::text[]))),
    CONSTRAINT chk_ce_source CHECK (((source)::text = ANY ((ARRAY['signup'::character varying, 'backfill'::character varying, 'unsubscribe'::character varying, 'admin'::character varying, 'erasure'::character varying, 'resubscribe'::character varying])::text[])))
);

COMMENT ON COLUMN public.consent_events."campaignId" IS 'Purpose scope; NULL = explicit global act';

COMMENT ON COLUMN public.consent_events.channels IS 'e.g. [''phone'',''whatsapp'',''email''] from the evidence builders';

COMMENT ON COLUMN public.consent_events.version IS 'Consent-copy version; ''legacy-backfill'' for pre-evidence rows';

COMMENT ON COLUMN public.consent_events.metadata IS 'e.g. dncTransactionId, termsVersionId';

CREATE TABLE public.consumer_observations (
    id uuid NOT NULL,
    "sourceProspectId" uuid,
    "consumerId" uuid,
    key character varying(64) NOT NULL,
    value jsonb NOT NULL,
    confidence real NOT NULL,
    source character varying(24) NOT NULL,
    "sourceArtifactId" character varying(80),
    "sourceRevisionId" bigint,
    "sourceContentHash" character varying(64),
    "sourceEventAt" timestamp with time zone NOT NULL,
    pipeline character varying(24) NOT NULL,
    "pipelineVersion" character varying(48) NOT NULL,
    evidence text,
    "supersededAt" timestamp with time zone,
    "retractedAt" timestamp with time zone,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL,
    CONSTRAINT chk_cobs_anchor CHECK (((((source)::text = 'manual'::text) AND ("consumerId" IS NOT NULL) AND ("sourceProspectId" IS NULL)) OR (((source)::text <> 'manual'::text) AND ("consumerId" IS NULL) AND ("sourceProspectId" IS NOT NULL) AND ("sourceArtifactId" IS NOT NULL) AND ("sourceRevisionId" IS NOT NULL) AND ("sourceContentHash" IS NOT NULL)))),
    CONSTRAINT chk_cobs_confidence CHECK (((confidence >= (0)::double precision) AND (confidence <= (1)::double precision))),
    CONSTRAINT chk_cobs_evidence_len CHECK (((evidence IS NULL) OR (char_length(evidence) <= 300))),
    CONSTRAINT chk_cobs_source CHECK (((source)::text = ANY ((ARRAY['form'::character varying, 'quiz'::character varying, 'retell_analysis'::character varying, 'screening_transcript'::character varying, 'manual'::character varying])::text[])))
);

COMMENT ON COLUMN public.consumer_observations."sourceProspectId" IS 'Anchor for source-derived rows; owner = live prospects.consumerId at read';

COMMENT ON COLUMN public.consumer_observations."consumerId" IS 'Anchor for manual person-level facts ONLY (chk_cobs_anchor)';

COMMENT ON COLUMN public.consumer_observations.key IS 'Allowlisted taxonomy key (factTaxonomy.js) — never free-form';

COMMENT ON COLUMN public.consumer_observations.value IS 'Per-key schema; supports negatives ({v:false}) and {complete} collections';

COMMENT ON COLUMN public.consumer_observations.source IS 'Doubles as the explicitness rank in resolveCurrentFacts (§3.4)';

COMMENT ON COLUMN public.consumer_observations."sourceArtifactId" IS 'e.g. form:<prospectId>, quiz:<prospectId>, screening:<callId>';

COMMENT ON COLUMN public.consumer_observations."sourceRevisionId" IS 'Monotonic per-artifact revision minted by the SOURCE mutation txn (R3 #3)';

COMMENT ON COLUMN public.consumer_observations."sourceContentHash" IS 'sha256 of the exact artifact content — integrity/audit, NOT identity';

COMMENT ON COLUMN public.consumer_observations."sourceEventAt" IS 'Artifact time (call end / capture) clamped to now()+24h skew — never extraction time';

COMMENT ON COLUMN public.consumer_observations."pipelineVersion" IS 'COMPOSITE semantic version of the pipeline (code+prompt+taxonomy) — R3 #6';

COMMENT ON COLUMN public.consumer_observations.evidence IS 'Server-verified substring of normalized source text; kept for the row lifetime';

COMMENT ON COLUMN public.consumer_observations."retractedAt" IS 'Admin "that''s wrong" (§9)';

CREATE TABLE public.consumer_profiles (
    "consumerId" uuid NOT NULL,
    summary text,
    "profileJson" jsonb,
    "consumerScore" smallint,
    "meetScore" smallint,
    "buyScore" smallint,
    "scoreBreakdown" jsonb,
    "scoreSourceProspectId" uuid,
    "scoredConfigVersion" integer,
    "scoringAlgorithmVersion" character varying(16),
    "scoreInputHash" character varying(64),
    "inputVersion" bigint DEFAULT 0 NOT NULL,
    "syncedInputVersion" bigint DEFAULT 0 NOT NULL,
    "profileInputHash" character varying(64),
    "modelVersion" character varying(48),
    "summaryGeneratedAt" timestamp with time zone,
    "scoreComputedAt" timestamp with time zone,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL,
    CONSTRAINT chk_cprof_buy_score CHECK ((("buyScore" IS NULL) OR (("buyScore" >= 0) AND ("buyScore" <= 100)))),
    CONSTRAINT chk_cprof_meet_score CHECK ((("meetScore" IS NULL) OR (("meetScore" >= 0) AND ("meetScore" <= 100)))),
    CONSTRAINT chk_cprof_score CHECK ((("consumerScore" IS NULL) OR (("consumerScore" >= 0) AND ("consumerScore" <= 100))))
);

COMMENT ON COLUMN public.consumer_profiles.summary IS 'Plain text, generated ONLY from validated claims (§6.4); never rendered as HTML';

COMMENT ON COLUMN public.consumer_profiles."profileJson" IS 'Structured claims w/ basisObservationIds + server-checked entailment (§6.4)';

COMMENT ON COLUMN public.consumer_profiles."consumerScore" IS 'Server-computed only (consumerScoringService); NULL = unscoreable, renders "—"';

COMMENT ON COLUMN public.consumer_profiles."meetScore" IS 'Reachability: engagement + contactability + market fit. NULL = unscoreable';

COMMENT ON COLUMN public.consumer_profiles."buyScore" IS 'Potential: life events + family gap + capacity + coverage headroom. NULL until ≥1 fact component is assessed';

COMMENT ON COLUMN public.consumer_profiles."scoreBreakdown" IS 'Per component: {state: unknown|assessed, points, maxPoints, basisObservationIds, note}';

CREATE TABLE public.consumer_suppressions (
    id uuid NOT NULL,
    "consumerId" uuid NOT NULL,
    channel character varying(16) DEFAULT 'all'::character varying NOT NULL,
    reason character varying(32) NOT NULL,
    source character varying(255),
    "actorUserId" uuid,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL,
    CONSTRAINT chk_cs_channel CHECK (((channel)::text = ANY ((ARRAY['all'::character varying, 'email'::character varying, 'whatsapp'::character varying, 'sms'::character varying, 'voice'::character varying])::text[]))),
    CONSTRAINT chk_cs_reason CHECK (((reason)::text = ANY ((ARRAY['unsubscribe'::character varying, 'complaint'::character varying, 'admin'::character varying, 'erasure'::character varying])::text[])))
);

COMMENT ON COLUMN public.consumer_suppressions.source IS 'breadcrumb: unsubscribe_link, admin ui, …';

CREATE TABLE public.consumers (
    id uuid NOT NULL,
    phone character varying(20),
    "phoneHash" character varying(64),
    "firstName" character varying(255),
    "lastName" character varying(255),
    email character varying(255),
    "firstSeenAt" timestamp with time zone NOT NULL,
    "lastSeenAt" timestamp with time zone NOT NULL,
    "signupCount" integer DEFAULT 0 NOT NULL,
    "verifiedSignupCount" integer DEFAULT 0 NOT NULL,
    "unsubTokenHash" character varying(64),
    "erasedAt" timestamp with time zone,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL,
    CONSTRAINT chk_consumers_counts CHECK ((("signupCount" >= 0) AND ("verifiedSignupCount" >= 0))),
    CONSTRAINT chk_consumers_phone_e164 CHECK (((phone IS NULL) OR ((phone)::text ~ '^\+[1-9][0-9]{9,14}$'::text))),
    CONSTRAINT chk_consumers_phone_hash_hex CHECK ((("phoneHash" IS NULL) OR (("phoneHash")::text ~ '^[0-9a-f]{64}$'::text)))
);

COMMENT ON COLUMN public.consumers.phone IS 'E.164 identity key — one live consumer per phone (uq_consumers_phone)';

COMMENT ON COLUMN public.consumers."phoneHash" IS 'sha256 hex of the E.164 phone (same recipe as sourceMetadata.phoneVerifiedFor)';

COMMENT ON COLUMN public.consumers.email IS 'Latest real (non-synthetic) email seen — an attribute, never an identity key';

COMMENT ON COLUMN public.consumers."verifiedSignupCount" IS 'Signups carrying a live-at-capture OTP stamp — only these can ever mint marketing authority (PR B)';

COMMENT ON COLUMN public.consumers."unsubTokenHash" IS 'PR B: sha256 of the opaque unsubscribe token';

COMMENT ON COLUMN public.consumers."erasedAt" IS 'PR C: PDPA erasure timestamp';

CREATE TABLE public.discovery_candidates (
    id uuid NOT NULL,
    "discoveryRunId" uuid NOT NULL,
    "externalPlaceId" character varying(128),
    name character varying(200),
    "primaryPhone" character varying(32),
    website character varying(255),
    "websiteDomain" character varying(160),
    "instagramHandle" character varying(64),
    address character varying(255),
    area character varying(64),
    rating numeric(2,1),
    "reviewsCount" integer,
    "sourceUrl" character varying(500),
    "dedupeStatus" character varying(20) DEFAULT 'new'::character varying NOT NULL,
    "matchedPartnerId" uuid,
    status character varying(16) DEFAULT 'pending'::character varying NOT NULL,
    "addedPartnerId" uuid,
    "enrichmentStatus" character varying(16) DEFAULT 'none'::character varying NOT NULL,
    "previouslySeenAt" timestamp with time zone,
    "isVerified" boolean,
    "followersCount" integer,
    email character varying(160),
    bio text,
    "enrichedAt" timestamp with time zone,
    "enrichmentSource" character varying(32),
    "rawPayload" jsonb,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);

CREATE TABLE public.discovery_daily_usage (
    "userId" uuid NOT NULL,
    "sgDate" date NOT NULL,
    "resultsUsed" integer DEFAULT 0 NOT NULL,
    "profilesUsed" integer DEFAULT 0 NOT NULL,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);

CREATE TABLE public.discovery_place_memory (
    "externalPlaceId" character varying(128) NOT NULL,
    "timesSeen" integer DEFAULT 1 NOT NULL,
    "firstSeenAt" timestamp with time zone NOT NULL,
    "lastSeenAt" timestamp with time zone NOT NULL,
    "lastSeenRunId" uuid,
    "dismissedAt" timestamp with time zone,
    "addedPartnerId" uuid,
    "lastEnrichment" jsonb,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);

CREATE TABLE public.discovery_runs (
    id uuid NOT NULL,
    "createdBy" uuid,
    "createdByEmail" character varying(160),
    provider character varying(32) DEFAULT 'apify_google_maps'::character varying NOT NULL,
    category character varying(64),
    area character varying(120),
    "requestedLimit" integer DEFAULT 60 NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    "providerRunId" character varying(64),
    "providerDatasetId" character varying(64),
    "resultCount" integer DEFAULT 0 NOT NULL,
    "estimatedCostUsd" numeric(10,4),
    "actualCostUsd" numeric(10,4),
    error text,
    "rawPayload" jsonb,
    "startedAt" timestamp with time zone,
    "completedAt" timestamp with time zone,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);

CREATE TABLE public.discovery_territories (
    id uuid NOT NULL,
    name character varying(64) NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);

CREATE TABLE public.draw_attempts (
    id uuid NOT NULL,
    "drawId" uuid NOT NULL,
    "attemptNo" integer NOT NULL,
    seed character varying(64) NOT NULL,
    "totalChances" integer NOT NULL,
    "eligibleHash" character varying(64) NOT NULL,
    "pickedEntryId" uuid NOT NULL,
    reason character varying(16) DEFAULT 'initial'::character varying NOT NULL,
    "drawnAt" timestamp with time zone NOT NULL,
    "witnessedByUserId" uuid,
    "contactedAt" timestamp with time zone,
    "claimDeadline" timestamp with time zone,
    "claimedAt" timestamp with time zone,
    outcome character varying(16) DEFAULT 'pending'::character varying NOT NULL,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);

COMMENT ON COLUMN public.draw_attempts.seed IS '32 random bytes hex, minted at the witnessed pick';

COMMENT ON COLUMN public.draw_attempts."eligibleHash" IS 'sha256 over the ordered eligible (entryId|chances) pairs this seed was applied to';

COMMENT ON COLUMN public.draw_attempts.reason IS 'Why this attempt ran: initial|unclaimed|unreachable|ineligible|declined (= prior attempt outcome)';

COMMENT ON COLUMN public.draw_attempts."claimDeadline" IS 'drawnAt + 14 days (the public /winners promise)';

COMMENT ON COLUMN public.draw_attempts.outcome IS 'pending|claimed|unclaimed|unreachable|ineligible|declined';

CREATE TABLE public.draw_boost_reviews (
    id uuid NOT NULL,
    "drawId" uuid NOT NULL,
    "entitlementId" uuid NOT NULL,
    "prospectId" uuid,
    decision character varying(16) NOT NULL,
    "reviewedByUserId" uuid NOT NULL,
    reason text,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);

COMMENT ON COLUMN public.draw_boost_reviews."prospectId" IS 'Denormalized join aid — no FK, evidence survives lead erasure';

COMMENT ON COLUMN public.draw_boost_reviews.decision IS 'approved|rejected';

CREATE TABLE public.draw_entries (
    id uuid NOT NULL,
    "drawId" uuid NOT NULL,
    "prospectId" uuid,
    "phoneHash" character varying(64) NOT NULL,
    "phoneLast4" character varying(4),
    "displayName" character varying(120),
    chances integer DEFAULT 1 NOT NULL,
    "verifiedAtFreeze" timestamp with time zone,
    "boostVia" character varying(16),
    "boostEventId" uuid,
    "createdAt" timestamp with time zone NOT NULL
);

COMMENT ON COLUMN public.draw_entries."prospectId" IS 'SET NULL on prospect deletion/erasure — entry survives, becomes unpickable';

COMMENT ON COLUMN public.draw_entries."phoneHash" IS 'sha256 of the E.164 phone at freeze';

COMMENT ON COLUMN public.draw_entries."displayName" IS 'Pre-masked "First L." — safe to publish';

COMMENT ON COLUMN public.draw_entries."verifiedAtFreeze" IS 'Copy of sourceMetadata.phoneVerifiedAt evidence';

COMMENT ON COLUMN public.draw_entries."boostVia" IS 'agent_scan|agent_button — how the ×N was earned (button ⇒ an approved review exists)';

COMMENT ON COLUMN public.draw_entries."boostEventId" IS 'The append-only unlocked event backing the boost';

CREATE TABLE public.draw_terms_versions (
    id uuid NOT NULL,
    "campaignId" uuid NOT NULL,
    version integer NOT NULL,
    content text NOT NULL,
    "contentSha256" character varying(64) NOT NULL,
    "createdBy" uuid NOT NULL,
    "createdAt" timestamp with time zone NOT NULL
);

COMMENT ON COLUMN public.draw_terms_versions.content IS 'Raw stored designer HTML (design_config.termsContent) at version time — the canonical bytes contentSha256 covers';

CREATE TABLE public.draws (
    id uuid NOT NULL,
    "campaignId" uuid NOT NULL,
    "activationId" uuid,
    "termsVersionId" uuid,
    "closesAt" timestamp with time zone NOT NULL,
    "boostClosesAt" timestamp with time zone,
    multiplier integer DEFAULT 10 NOT NULL,
    status character varying(16) DEFAULT 'open'::character varying NOT NULL,
    "poolHash" character varying(64),
    "seedCommitment" character varying(64),
    "sealedSeed" character varying(64),
    "witnessedByUserId" uuid,
    notes text,
    "createdBy" uuid NOT NULL,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);

COMMENT ON COLUMN public.draws."activationId" IS 'Designated ×N activation — unlock events on OTHER activations never boost';

COMMENT ON COLUMN public.draws."closesAt" IS 'Entry cutoff instant (UTC)';

COMMENT ON COLUMN public.draws."boostClosesAt" IS 'Unlock-event cutoff instant (UTC); null = no boost tier';

COMMENT ON COLUMN public.draws.status IS 'open|frozen|sealed|drawn|published|claimed|void';

COMMENT ON COLUMN public.draws."poolHash" IS 'sha256 over the canonical ordered entry tuples (id|prospectId|phoneHash|chances|boostVia) — committed at seal';

COMMENT ON COLUMN public.draws."seedCommitment" IS 'sha256(sealedSeed) — committed at seal, before any pick is computed (P2-8)';

COMMENT ON COLUMN public.draws."sealedSeed" IS 'The seed committed at seal and revealed at draw; every attempt must hash to seedCommitment';

CREATE TABLE public.email_broadcast_recipients (
    id uuid NOT NULL,
    "broadcastId" uuid NOT NULL,
    "consumerId" uuid NOT NULL,
    email character varying(320),
    status character varying(16) DEFAULT 'pending'::character varying NOT NULL,
    reason character varying(64),
    error text,
    "sentAt" timestamp with time zone,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL,
    CONSTRAINT chk_ebr_status CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'attempting'::character varying, 'sent'::character varying, 'skipped'::character varying, 'failed'::character varying])::text[])))
);

COMMENT ON COLUMN public.email_broadcast_recipients."consumerId" IS 'Erasure keeps an anonymized consumer husk, so this FK never dangles';

COMMENT ON COLUMN public.email_broadcast_recipients.email IS 'Address actually attempted (refreshed at send time); nulled by erasure';

COMMENT ON COLUMN public.email_broadcast_recipients.error IS 'Transport error message; nulled by erasure';

CREATE TABLE public.email_broadcasts (
    id uuid NOT NULL,
    "cohortId" uuid NOT NULL,
    "campaignId" uuid,
    subject character varying(200) NOT NULL,
    "bodyText" text NOT NULL,
    "ctaLabel" character varying(80) DEFAULT 'Learn more'::character varying NOT NULL,
    "definitionSnapshot" jsonb,
    "hostChoice" character varying(8),
    "emailContext" character varying(8),
    "ctaUrl" text,
    status character varying(16) DEFAULT 'draft'::character varying NOT NULL,
    "totalRecipients" integer DEFAULT 0 NOT NULL,
    "sentCount" integer DEFAULT 0 NOT NULL,
    "skippedCount" integer DEFAULT 0 NOT NULL,
    "failedCount" integer DEFAULT 0 NOT NULL,
    "workerHeartbeatAt" timestamp with time zone,
    "workerLeaseId" uuid,
    "startedAt" timestamp with time zone,
    "completedAt" timestamp with time zone,
    "lastError" text,
    "createdBy" uuid,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL,
    CONSTRAINT chk_eb_counts CHECK ((("totalRecipients" >= 0) AND ("sentCount" >= 0) AND ("skippedCount" >= 0) AND ("failedCount" >= 0))),
    CONSTRAINT chk_eb_status CHECK (((status)::text = ANY ((ARRAY['draft'::character varying, 'preparing'::character varying, 'sending'::character varying, 'cancelling'::character varying, 'completed'::character varying, 'interrupted'::character varying, 'failed'::character varying, 'cancelled'::character varying])::text[])))
);

COMMENT ON COLUMN public.email_broadcasts."campaignId" IS 'The campaign the email is ABOUT — gate scope + CTA target. SET NULL survives campaign hard-delete; a null campaign fails resume preflight.';

COMMENT ON COLUMN public.email_broadcasts."definitionSnapshot" IS 'Normalized cohort definition with marketingContext.campaignId overridden to campaignId, frozen at preparing';

COMMENT ON COLUMN public.email_broadcasts."hostChoice" IS '''redeem''|''mktr'' — clamped customer-host enum at preparing';

COMMENT ON COLUMN public.email_broadcasts."emailContext" IS 'mailer from-context (''redeem''|''mktr'') at preparing';

COMMENT ON COLUMN public.email_broadcasts."ctaUrl" IS 'Frozen CTA link incl. utm — what actually went out';

COMMENT ON COLUMN public.email_broadcasts."workerHeartbeatAt" IS 'Worker liveness; stale ≥120s ⇒ resumable/boot-sweepable';

COMMENT ON COLUMN public.email_broadcasts."workerLeaseId" IS 'Ownership lease minted per start/resume; heartbeats/finalize are keyed to it so superseded workers exit';

CREATE TABLE public.enrichment_jobs (
    id uuid NOT NULL,
    kind character varying(12) NOT NULL,
    "subjectProspectId" uuid,
    "subjectConsumerId" uuid,
    "sourceArtifactId" character varying(80),
    "sourceRevisionId" bigint,
    "sourceContentHash" character varying(64),
    "inputHash" character varying(64),
    "promptVersion" character varying(32),
    payload jsonb,
    "taxonomyVersion" character varying(16),
    "pipelineVersion" character varying(48) NOT NULL,
    status character varying(12) DEFAULT 'pending'::character varying NOT NULL,
    "leaseToken" uuid,
    "leaseExpiresAt" timestamp with time zone,
    "workerId" character varying(80),
    attempts smallint DEFAULT 0 NOT NULL,
    "lastError" text,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL,
    CONSTRAINT chk_ejobs_kind CHECK (((((kind)::text = 'map'::text) AND ("subjectProspectId" IS NOT NULL) AND ("subjectConsumerId" IS NULL) AND ("sourceRevisionId" IS NOT NULL) AND ("sourceContentHash" IS NOT NULL) AND ("inputHash" IS NULL) AND ("promptVersion" IS NULL)) OR (((kind)::text = 'extract'::text) AND ("subjectProspectId" IS NOT NULL) AND ("subjectConsumerId" IS NULL) AND ("sourceArtifactId" IS NOT NULL) AND ("sourceRevisionId" IS NOT NULL) AND ("sourceContentHash" IS NOT NULL) AND ("inputHash" IS NULL) AND ("promptVersion" IS NULL) AND (payload IS NULL)) OR (((kind)::text = 'synthesize'::text) AND ("subjectConsumerId" IS NOT NULL) AND ("subjectProspectId" IS NULL) AND ("inputHash" IS NOT NULL) AND ("promptVersion" IS NOT NULL) AND ("sourceArtifactId" IS NULL) AND ("sourceRevisionId" IS NULL) AND ("sourceContentHash" IS NULL) AND (payload IS NULL)))),
    CONSTRAINT chk_ejobs_status CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'leased'::character varying, 'done'::character varying, 'stale'::character varying, 'dead'::character varying, 'cancelled'::character varying])::text[])))
);

COMMENT ON COLUMN public.enrichment_jobs.attempts IS 'Lease expiry AND payload-validation failures both increment; ≥3 → dead (R2 #6)';

CREATE TABLE public.enrichment_scoring_configs (
    version integer NOT NULL,
    "configJson" jsonb NOT NULL,
    "campaignId" uuid,
    "productKey" character varying(24),
    status character varying(12) DEFAULT 'approved'::character varying NOT NULL,
    "activatedAt" timestamp with time zone NOT NULL,
    "actorUserId" uuid,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL,
    CONSTRAINT chk_escfg_single_scope CHECK ((("campaignId" IS NULL) OR ("productKey" IS NULL))),
    CONSTRAINT chk_escfg_status CHECK (((status)::text = ANY ((ARRAY['draft'::character varying, 'approved'::character varying, 'superseded'::character varying])::text[])))
);

CREATE SEQUENCE public.enrichment_scoring_configs_version_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.enrichment_scoring_configs_version_seq OWNED BY public.enrichment_scoring_configs.version;

CREATE TABLE public.enrichment_sweep_runs (
    id uuid NOT NULL,
    "runDateSgt" character varying(10) NOT NULL,
    "runType" character varying(12) DEFAULT 'nightly'::character varying NOT NULL,
    status character varying(10) NOT NULL,
    "ownerToken" uuid NOT NULL,
    "heartbeatAt" timestamp with time zone NOT NULL,
    "finishedAt" timestamp with time zone,
    stats jsonb,
    cursor jsonb,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL,
    CONSTRAINT chk_esruns_status CHECK (((status)::text = ANY ((ARRAY['running'::character varying, 'done'::character varying, 'failed'::character varying])::text[]))),
    CONSTRAINT chk_esruns_type CHECK ((("runType")::text = ANY ((ARRAY['nightly'::character varying, 'backfill'::character varying])::text[])))
);

COMMENT ON COLUMN public.enrichment_sweep_runs."runDateSgt" IS 'YYYY-MM-DD in Asia/Singapore';

CREATE TABLE public.external_agents (
    id uuid NOT NULL,
    phone character varying(255) NOT NULL,
    email character varying(255),
    "fullName" character varying(255),
    agency character varying(255),
    "isActive" boolean DEFAULT true NOT NULL,
    "leadBalance" integer DEFAULT 0 NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);

COMMENT ON COLUMN public.external_agents."leadBalance" IS 'Global prepaid lead balance; decremented atomically by 1 per external assignment.';

CREATE TABLE public.external_campaign_agents (
    id uuid NOT NULL,
    "externalAgentId" uuid NOT NULL,
    "campaignId" uuid NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.idempotency_keys (
    scope character varying(255) NOT NULL,
    key character varying(255) NOT NULL,
    "deviceId" uuid,
    "responseBody" json,
    "responseCode" integer,
    "expiresAt" timestamp with time zone NOT NULL,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);

CREATE TABLE public.lead_package_assignments (
    id uuid NOT NULL,
    "agentId" uuid NOT NULL,
    "leadPackageId" uuid NOT NULL,
    status public.enum_lead_package_assignments_status DEFAULT 'active'::public.enum_lead_package_assignments_status,
    "leadsRemaining" integer NOT NULL,
    "leadsTotal" integer NOT NULL,
    "purchaseDate" timestamp with time zone,
    "priceSnapshot" numeric(10,2) NOT NULL,
    source character varying(16) DEFAULT 'package'::character varying NOT NULL,
    "unitPriceCents" integer,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL,
    CONSTRAINT chk_lpa_wallet_unit_price CHECK ((((source)::text <> 'wallet'::text) OR (("unitPriceCents" IS NOT NULL) AND ("unitPriceCents" > 0))))
);

COMMENT ON COLUMN public.lead_package_assignments."leadsTotal" IS 'Snapshot of total leads at time of assignment';

COMMENT ON COLUMN public.lead_package_assignments."priceSnapshot" IS 'Snapshot of price at time of assignment';

CREATE TABLE public.lead_packages (
    id uuid NOT NULL,
    name character varying(255) NOT NULL,
    description text,
    type public.enum_lead_packages_type NOT NULL,
    category character varying(255),
    price numeric(10,2) NOT NULL,
    currency character varying(3) DEFAULT 'USD'::character varying,
    "leadCount" integer NOT NULL,
    "qualityScore" integer,
    "deliveryMethod" public."enum_lead_packages_deliveryMethod" DEFAULT 'dashboard'::public."enum_lead_packages_deliveryMethod",
    "validityPeriod" integer,
    status public.enum_lead_packages_status DEFAULT 'draft'::public.enum_lead_packages_status,
    "commissionStructure" json DEFAULT '{"agentCommission":0,"referralBonus":0,"tierBonuses":{}}'::json,
    "isPublic" boolean DEFAULT true,
    is_recommended boolean DEFAULT false NOT NULL,
    "isCustomizable" boolean DEFAULT false,
    "createdBy" uuid NOT NULL,
    "campaignId" uuid,
    kind character varying(16) DEFAULT 'catalog'::character varying NOT NULL,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);

COMMENT ON COLUMN public.lead_packages."validityPeriod" IS 'Validity period in days';

CREATE TABLE public.outreach_activities (
    id uuid NOT NULL,
    "partnerOrganisationId" uuid NOT NULL,
    "contactId" uuid,
    type character varying(32) NOT NULL,
    direction character varying(12) DEFAULT 'outbound'::character varying NOT NULL,
    summary character varying(255) NOT NULL,
    details text,
    outcome character varying(64),
    "occurredAt" timestamp with time zone NOT NULL,
    "actorUserId" uuid,
    "editedAt" timestamp with time zone,
    "editedBy" uuid,
    "voidedAt" timestamp with time zone,
    "voidReason" character varying(255),
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);

COMMENT ON COLUMN public.outreach_activities.type IS 'ACTIVITY_TYPES in services/redeemOps/constants.js';

COMMENT ON COLUMN public.outreach_activities.direction IS 'outbound|inbound|internal';

CREATE TABLE public.outreach_cadence_enrollments (
    id uuid NOT NULL,
    "cadenceId" uuid NOT NULL,
    "partnerOrganisationId" uuid NOT NULL,
    state character varying(16) DEFAULT 'active'::character varying NOT NULL,
    "currentStepId" uuid,
    "lastDisposition" character varying(24),
    "exitReason" character varying(32),
    "enrolledBy" uuid NOT NULL,
    "pausedAt" timestamp with time zone,
    "endedAt" timestamp with time zone,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);

COMMENT ON COLUMN public.outreach_cadence_enrollments.state IS 'active|paused|completed|exited';

CREATE TABLE public.outreach_cadence_steps (
    id uuid NOT NULL,
    "cadenceId" uuid NOT NULL,
    "stepOrder" integer NOT NULL,
    channel character varying(24) NOT NULL,
    mode character varying(12) DEFAULT 'manual'::character varying NOT NULL,
    title character varying(160) NOT NULL,
    "scriptTemplate" text,
    priority character varying(12) DEFAULT 'medium'::character varying NOT NULL,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL,
    CONSTRAINT ck_ocs_step_order_min CHECK (("stepOrder" >= 1))
);

COMMENT ON COLUMN public.outreach_cadence_steps."stepOrder" IS 'display ordering, 1..n';

COMMENT ON COLUMN public.outreach_cadence_steps.channel IS 'call|whatsapp|email|instagram_dm|visit|custom';

COMMENT ON COLUMN public.outreach_cadence_steps.mode IS '''auto'' reserved for P3 email';

CREATE TABLE public.outreach_cadence_transitions (
    id uuid NOT NULL,
    "cadenceId" uuid NOT NULL,
    "fromStepId" uuid,
    disposition character varying(24) NOT NULL,
    "toStepId" uuid,
    "terminalAction" character varying(24),
    "delayDays" integer DEFAULT 0 NOT NULL,
    "timeWindow" character varying(16) DEFAULT 'any'::character varying NOT NULL,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL,
    CONSTRAINT ck_oct_delay_min CHECK (("delayDays" >= 0))
);

COMMENT ON COLUMN public.outreach_cadence_transitions.disposition IS 'channel disposition or ''*''';

COMMENT ON COLUMN public.outreach_cadence_transitions."delayDays" IS 'days AFTER the from-step completion';

COMMENT ON COLUMN public.outreach_cadence_transitions."timeWindow" IS 'any|morning|afternoon|off_peak (SGT)';

CREATE TABLE public.outreach_cadences (
    id uuid NOT NULL,
    key character varying(64) NOT NULL,
    version integer NOT NULL,
    name character varying(120) NOT NULL,
    description text,
    "targetCategory" character varying(64),
    "isActive" boolean DEFAULT true NOT NULL,
    "publishedAt" timestamp with time zone,
    "createdBy" uuid NOT NULL,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);

CREATE TABLE public.outreach_suppressions (
    id uuid NOT NULL,
    channel character varying(24) NOT NULL,
    value character varying(160) NOT NULL,
    reason character varying(32) NOT NULL,
    source character varying(32),
    "expiresAt" timestamp with time zone,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);

COMMENT ON COLUMN public.outreach_suppressions.channel IS 'call|whatsapp|email|any';

COMMENT ON COLUMN public.outreach_suppressions.value IS 'normalized phone/email';

COMMENT ON COLUMN public.outreach_suppressions.reason IS 'opt_out|dnc_listed|bounced|complaint';

CREATE TABLE public.outreach_tasks (
    id uuid NOT NULL,
    title character varying(160) NOT NULL,
    "partnerOrganisationId" uuid NOT NULL,
    "contactId" uuid,
    "assigneeUserId" uuid NOT NULL,
    "createdBy" uuid NOT NULL,
    "dueAt" timestamp with time zone NOT NULL,
    "hasTime" boolean DEFAULT false NOT NULL,
    priority character varying(12) DEFAULT 'medium'::character varying NOT NULL,
    type character varying(24) DEFAULT 'follow_up'::character varying NOT NULL,
    status character varying(16) DEFAULT 'open'::character varying NOT NULL,
    description text,
    "completedAt" timestamp with time zone,
    "completedBy" uuid,
    "cadenceEnrollmentId" uuid,
    "cadenceStepId" uuid,
    "snapshotRecipient" character varying(160),
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL,
    CONSTRAINT ck_ot_cadence_pair CHECK ((("cadenceEnrollmentId" IS NULL) = ("cadenceStepId" IS NULL)))
);

COMMENT ON COLUMN public.outreach_tasks."hasTime" IS 'false = date-only rendering';

COMMENT ON COLUMN public.outreach_tasks.priority IS 'low|medium|high';

COMMENT ON COLUMN public.outreach_tasks.type IS 'follow_up|call|meeting|proposal|admin|other';

COMMENT ON COLUMN public.outreach_tasks.status IS 'open|in_progress|completed|cancelled';

COMMENT ON COLUMN public.outreach_tasks."snapshotRecipient" IS 'resolved phone/email/handle/address at materialization';

CREATE TABLE public.partner_assignment_events (
    id uuid NOT NULL,
    "partnerOrganisationId" uuid NOT NULL,
    kind character varying(24) NOT NULL,
    "fromUserId" uuid,
    "toUserId" uuid,
    "actorUserId" uuid,
    reason character varying(255),
    "createdAt" timestamp with time zone NOT NULL
);

COMMENT ON COLUMN public.partner_assignment_events.kind IS 'claim|assign|reassign|release|restrict|disqualify|merge';

CREATE TABLE public.partner_contacts (
    id uuid NOT NULL,
    "partnerOrganisationId" uuid NOT NULL,
    name character varying(120) NOT NULL,
    "roleTitle" character varying(80),
    mobile character varying(20),
    whatsapp character varying(20),
    email character varying(160),
    "preferredChannel" character varying(24),
    "isPrimary" boolean DEFAULT false NOT NULL,
    notes text,
    "archivedAt" timestamp with time zone,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);

COMMENT ON COLUMN public.partner_contacts.whatsapp IS 'Only when different from mobile';

COMMENT ON COLUMN public.partner_contacts."preferredChannel" IS 'call|whatsapp|email|instagram|other';

CREATE TABLE public.partner_locations (
    id uuid NOT NULL,
    "partnerOrganisationId" uuid NOT NULL,
    name character varying(120),
    "addressLine" character varying(255),
    "postalCode" character varying(6),
    "postalDistrict" character varying(2),
    area character varying(64),
    phone character varying(20),
    "isActive" boolean DEFAULT true NOT NULL,
    notes text,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);

COMMENT ON COLUMN public.partner_locations."postalDistrict" IS 'First 2 digits of SG postal — same-area duplicate heuristics';

CREATE TABLE public.partner_onboarding_items (
    id uuid NOT NULL,
    "partnerOrganisationId" uuid NOT NULL,
    "itemKey" character varying(48) NOT NULL,
    label character varying(160) NOT NULL,
    "sortOrder" integer DEFAULT 0 NOT NULL,
    status character varying(16) DEFAULT 'pending'::character varying NOT NULL,
    "assigneeUserId" uuid,
    "completedAt" timestamp with time zone,
    notes text,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);

COMMENT ON COLUMN public.partner_onboarding_items.status IS 'pending|in_progress|done|na';

CREATE TABLE public.partner_organisations (
    id uuid NOT NULL,
    "legalName" character varying(160),
    "tradingName" character varying(160),
    "brandName" character varying(120),
    "normalizedName" character varying(160) NOT NULL,
    uen character varying(16),
    website character varying(255),
    "websiteDomain" character varying(160),
    "primaryPhone" character varying(20),
    "primaryEmail" character varying(160),
    "instagramHandle" character varying(64),
    "tiktokHandle" character varying(64),
    "facebookUrl" character varying(255),
    "facebookHandle" character varying(120),
    "linkedinUrl" character varying(255),
    category character varying(64),
    subcategory character varying(64),
    source character varying(64),
    tags jsonb DEFAULT '[]'::jsonb NOT NULL,
    notes text,
    "pipelineStage" character varying(32) DEFAULT 'NEW'::character varying NOT NULL,
    "lostReason" character varying(32),
    "snoozedUntil" timestamp with time zone,
    availability character varying(24) DEFAULT 'available'::character varying NOT NULL,
    "ownerUserId" uuid,
    "claimedAt" timestamp with time zone,
    "firstOutreachAt" timestamp with time zone,
    "lastActivityAt" timestamp with time zone,
    "nextTaskAt" timestamp with time zone,
    "atRiskFlag" boolean DEFAULT false NOT NULL,
    "staleFlag" boolean DEFAULT false NOT NULL,
    "mergedIntoId" uuid,
    "archivedAt" timestamp with time zone,
    "publicBlurb" text,
    "verifiedAt" timestamp with time zone,
    "partnerSince" smallint,
    "createdBy" uuid NOT NULL,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);

COMMENT ON COLUMN public.partner_organisations.uen IS 'Uppercased ACRA UEN';

COMMENT ON COLUMN public.partner_organisations.availability IS 'available|owned|follow_up_later|restricted|disqualified — the claim gate';

COMMENT ON COLUMN public.partner_organisations."lastActivityAt" IS 'Denormalized for queue/stale queries';

COMMENT ON COLUMN public.partner_organisations."nextTaskAt" IS 'Denormalized from open tasks (Phase 3)';

COMMENT ON COLUMN public.partner_organisations."atRiskFlag" IS 'Claimed >48h, no first outreach (sweep-set)';

COMMENT ON COLUMN public.partner_organisations."staleFlag" IS 'No meaningful activity >14d (sweep-set)';

COMMENT ON COLUMN public.partner_organisations."mergedIntoId" IS 'Set on merge; row retained, hidden from lists';

COMMENT ON COLUMN public.partner_organisations."publicBlurb" IS 'Consumer-facing partner blurb (marketplace)';

COMMENT ON COLUMN public.partner_organisations."verifiedAt" IS 'Verification stamp — null = unverified; admin-set only';

COMMENT ON COLUMN public.partner_organisations."partnerSince" IS 'Display year for "on Redeem since"';

CREATE TABLE public.partner_stage_events (
    id uuid NOT NULL,
    "partnerOrganisationId" uuid NOT NULL,
    "fromStage" character varying(32),
    "toStage" character varying(32) NOT NULL,
    "actorUserId" uuid,
    reason character varying(255),
    "createdAt" timestamp with time zone NOT NULL
);

CREATE TABLE public.payments (
    id uuid NOT NULL,
    "agentId" uuid,
    "beneficiaryUserId" uuid,
    "forTeam" boolean DEFAULT false NOT NULL,
    "beneficiaryName" character varying(255),
    "leadPackageId" uuid,
    "leadPackageAssignmentId" uuid,
    provider character varying(255) DEFAULT 'hitpay'::character varying NOT NULL,
    "providerRequestId" character varying(255),
    "providerPaymentId" character varying(255),
    amount numeric(10,2) NOT NULL,
    currency character varying(3) DEFAULT 'SGD'::character varying NOT NULL,
    "leadCount" integer NOT NULL,
    "packageName" character varying(255),
    "campaignName" character varying(255),
    status public.enum_payments_status DEFAULT 'pending'::public.enum_payments_status NOT NULL,
    kind character varying(24) DEFAULT 'package_purchase'::character varying NOT NULL,
    source public.enum_payments_source DEFAULT 'mktr_leads_app'::public.enum_payments_source NOT NULL,
    "rawWebhook" json,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.phone_verification_markers (
    "phoneHash" character varying(64) NOT NULL,
    "verifiedAt" timestamp with time zone NOT NULL,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);

COMMENT ON COLUMN public.phone_verification_markers."phoneHash" IS 'sha256 hex of the full E.164 phone — never the raw number';

COMMENT ON COLUMN public.phone_verification_markers."verifiedAt" IS 'When the OTP check last succeeded for this number';

CREATE TABLE public.prospect_activities (
    id uuid NOT NULL,
    "prospectId" uuid NOT NULL,
    type public.enum_prospect_activities_type NOT NULL,
    "actorUserId" uuid,
    description character varying(255) NOT NULL,
    metadata json DEFAULT '{}'::json,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);

CREATE TABLE public.prospecting_pool_members (
    id uuid NOT NULL,
    "poolId" uuid NOT NULL,
    "partnerOrganisationId" uuid NOT NULL,
    status character varying(16) DEFAULT 'available'::character varying NOT NULL,
    "addedBy" uuid NOT NULL,
    "claimedBy" uuid,
    "claimedAt" timestamp with time zone,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);

COMMENT ON COLUMN public.prospecting_pool_members.status IS 'available|claimed|removed';

CREATE TABLE public.prospecting_pools (
    id uuid NOT NULL,
    name character varying(120) NOT NULL,
    description text,
    category character varying(64),
    area character varying(64),
    "isActive" boolean DEFAULT true NOT NULL,
    "createdBy" uuid NOT NULL,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);

CREATE TABLE public.prospects (
    id uuid NOT NULL,
    "firstName" character varying(255) NOT NULL,
    "lastName" character varying(255),
    email character varying(255),
    phone character varying(255),
    company character varying(255),
    "jobTitle" character varying(255),
    industry character varying(255),
    "leadSource" public."enum_prospects_leadSource" NOT NULL,
    "leadStatus" public."enum_prospects_leadStatus" DEFAULT 'new'::public."enum_prospects_leadStatus",
    priority public.enum_prospects_priority DEFAULT 'medium'::public.enum_prospects_priority,
    score integer,
    "meetScore" integer,
    "buyScore" integer,
    "scoreBreakdown" jsonb,
    "scoreComputedAt" timestamp with time zone,
    "scoredConfigVersion" integer,
    "scoringAlgorithmVersion" character varying(24),
    "scoreInputHash" character varying(64),
    "scoreDirtyAt" timestamp with time zone,
    interests text DEFAULT '[]'::text,
    budget json DEFAULT '{"min":null,"max":null,"currency":"USD","timeframe":""}'::json,
    location json DEFAULT '{"address":"","city":"","state":"","zipCode":"","country":"US","latitude":null,"longitude":null}'::json,
    demographics json DEFAULT '{"age":null,"gender":"","income":"","education":"","maritalStatus":""}'::json,
    preferences json DEFAULT '{"contactMethod":"email","contactTime":"","language":"en","timezone":""}'::json,
    notes text,
    tags text DEFAULT '[]'::text,
    "lastContactDate" timestamp with time zone,
    "nextFollowUpDate" timestamp with time zone,
    "conversionDate" timestamp with time zone,
    "campaignId" uuid,
    "assignedAgentId" uuid,
    "externalAgentId" uuid,
    "qrTagId" uuid,
    "attributionId" uuid,
    "consumerId" uuid,
    "sessionId" character varying(64),
    "sourceMetadata" json DEFAULT '{}'::json,
    "consentMetadata" jsonb,
    "retellCallId" character varying(255),
    "quarantinedAt" timestamp with time zone,
    "quarantineReason" character varying(64),
    "dncStatus" character varying(16),
    "dncNoVoiceCall" boolean,
    "dncNoTextMessage" boolean,
    "dncNoFax" boolean,
    "dncCheckedAt" timestamp with time zone,
    "dncValidUntil" timestamp with time zone,
    "dncMetadata" jsonb,
    "screeningActiveCallId" character varying(80),
    "screeningAttemptCount" smallint DEFAULT 0 NOT NULL,
    "screeningNextAttemptAt" timestamp with time zone,
    "screeningVerdict" character varying(16),
    "screeningMetadata" jsonb,
    "enrichmentRevision" integer DEFAULT 1 NOT NULL,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL,
    tenant_id uuid DEFAULT '00000000-0000-0000-0000-000000000000'::uuid NOT NULL,
    CONSTRAINT chk_prospect_single_assignee CHECK ((NOT (("assignedAgentId" IS NOT NULL) AND ("externalAgentId" IS NOT NULL))))
);

COMMENT ON COLUMN public.prospects.score IS 'Lead score 0-100 as of scoreComputedAt — decayed at WRITE time, never at read (§6)';

COMMENT ON COLUMN public.prospects."meetScore" IS '"Will they meet a consultant", 0-100. NULL = not scoreable, which is not the same as 0.';

COMMENT ON COLUMN public.prospects."buyScore" IS '"Will they buy", 0-100. NULL until ≥1 fact component is assessed — ignorance must never read as a low score.';

COMMENT ON COLUMN public.prospects."scoreBreakdown" IS 'Per-component evidence + the response events, with their timestamps and undecayed weights. Rendered "as of scoreComputedAt".';

COMMENT ON COLUMN public.prospects."scoreComputedAt" IS 'When the stored number was computed. The decay is baked in as of this instant.';

COMMENT ON COLUMN public.prospects."scoredConfigVersion" IS 'enrichment_scoring_configs.version that produced the score — keeps old breakdowns interpretable.';

COMMENT ON COLUMN public.prospects."scoringAlgorithmVersion" IS 'Algorithm build that produced the score (e.g. lead/v1).';

COMMENT ON COLUMN public.prospects."scoreInputHash" IS 'Content hash of the scored inputs — half of the write gate (§6).';

COMMENT ON COLUMN public.prospects."scoreDirtyAt" IS 'Lead-grain dirty marker (§10). Set by every choke-point writer; cleared by a rescore. A dirty lead is provably stale, so it rides the sweep''s stale-first phase.';

COMMENT ON COLUMN public.prospects."externalAgentId" IS 'Set when this lead is assigned to an external MKTR Leads buyer (mutually exclusive with assignedAgentId).';

COMMENT ON COLUMN public.prospects."consumerId" IS 'Cross-campaign person link (consumer spine, migration 078) — SET NULL on consumer delete; null for call_bot leads and pre-spine rows until reconciled';

COMMENT ON COLUMN public.prospects."sourceMetadata" IS 'Additional data about the lead source (referrer URL, QR code location, etc.)';

COMMENT ON COLUMN public.prospects."consentMetadata" IS 'Third-party-disclosure consent evidence; consentMetadata.external gates external (MKTR Leads) delivery.';

COMMENT ON COLUMN public.prospects."retellCallId" IS 'Retell AI call_id for idempotent webhook processing';

COMMENT ON COLUMN public.prospects."quarantinedAt" IS 'Set when held under lead-quota (no funded agent). NULL = not quarantined.';

COMMENT ON COLUMN public.prospects."quarantineReason" IS 'Why the lead was quarantined, e.g. no_funded_agent. DNC adds dnc_pending / dnc_registered.';

COMMENT ON COLUMN public.prospects."dncStatus" IS 'DNC check state: pending|clear|registered|error|skipped. NULL = never checked.';

COMMENT ON COLUMN public.prospects."dncNoVoiceCall" IS 'true = registered on the DNC no-voice-call register (do NOT call).';

COMMENT ON COLUMN public.prospects."dncNoTextMessage" IS 'true = registered on the DNC no-text-message register.';

COMMENT ON COLUMN public.prospects."dncNoFax" IS 'true = registered on the DNC no-fax register.';

COMMENT ON COLUMN public.prospects."dncCheckedAt" IS 'Timestamp of the last successful DNC check.';

COMMENT ON COLUMN public.prospects."dncValidUntil" IS 'DNC result validity end date (from API msg). Cache hit while now() < this.';

COMMENT ON COLUMN public.prospects."dncMetadata" IS 'DNC check evidence (transactionId, createdTime, rawMsg, statusCode, checkOnBehalf, numberChecked).';

COMMENT ON COLUMN public.prospects."screeningActiveCallId" IS 'In-flight dial fence: ''pend_<token>'' after claim, Retell call_id once bound. NULL = no active attempt.';

COMMENT ON COLUMN public.prospects."screeningAttemptCount" IS 'Dial attempts started (incl. dispatch failures).';

COMMENT ON COLUMN public.prospects."screeningNextAttemptAt" IS 'Sweep retry schedule (backoff / call-window deferral).';

COMMENT ON COLUMN public.prospects."screeningVerdict" IS 'AI verdict: ''qualified'' | ''not_qualified''. Qualified + still screening_pending = delivery-retry state.';

COMMENT ON COLUMN public.prospects."screeningMetadata" IS 'Evidence only (state lives in the discrete columns): { intendedAgentId, alreadyCharged, chargeRefunded, attempts: {<token>: {…}}, verdictDetail }. Excluded from list projections (transcripts are detail-only).';

COMMENT ON COLUMN public.prospects."enrichmentRevision" IS 'Monotonic revision of this prospect''s FORM artifact (capture=1; each staff edit to mapped fields increments + enqueues a new map job). Revision identity for consumer_observations — plan §3.1/§5.';

CREATE TABLE public.qr_scans (
    id uuid NOT NULL,
    "qrTagId" uuid NOT NULL,
    ts timestamp with time zone NOT NULL,
    "ipHash" character varying(128) NOT NULL,
    ua text,
    referer text,
    device character varying(32),
    "geoCity" character varying(128),
    "botFlag" boolean DEFAULT false NOT NULL,
    "isDuplicate" boolean DEFAULT false NOT NULL,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);

CREATE TABLE public.qr_tags (
    id uuid NOT NULL,
    "scanCount" integer DEFAULT 0 NOT NULL,
    "uniqueScanCount" integer DEFAULT 0 NOT NULL,
    "lastScanned" timestamp with time zone,
    analytics json DEFAULT '{}'::json,
    status public.enum_qr_tags_status DEFAULT 'active'::public.enum_qr_tags_status NOT NULL,
    slug character varying(64),
    label character varying(128),
    name character varying(255),
    description text,
    type character varying(255),
    "qrCode" text,
    "qrImageUrl" character varying(255),
    "targetHost" character varying(16),
    active boolean DEFAULT true NOT NULL,
    location json DEFAULT '{"name":"","address":"","city":"","state":"","zipCode":"","latitude":null,"longitude":null}'::json,
    placement json DEFAULT '{"position":"","size":"","material":"","visibility":"high"}'::json,
    tags text DEFAULT '[]'::text,
    "assignedAgentId" uuid,
    "assignedAgentPhone" character varying(255),
    "assignedAgentEmail" character varying(255),
    "assignedAgentName" character varying(255),
    "agentAssignmentMode" character varying(255) DEFAULT 'direct'::character varying NOT NULL,
    "agentGroupId" uuid,
    "roundRobinIndex" integer DEFAULT 0 NOT NULL,
    "campaignId" uuid,
    "ownerUserId" uuid,
    "carId" uuid,
    "parentQrTagId" uuid,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL,
    tenant_id uuid DEFAULT '00000000-0000-0000-0000-000000000000'::uuid NOT NULL,
    CONSTRAINT ck_qr_tags_lifecycle_coherent CHECK (((status = 'active'::public.enum_qr_tags_status) = active))
);

COMMENT ON COLUMN public.qr_tags."qrCode" IS 'QR code SVG markup';

CREATE TABLE public.rate_counters (
    key text NOT NULL,
    count integer DEFAULT 0 NOT NULL,
    "expiresAt" timestamp with time zone NOT NULL,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);

CREATE TABLE public.redeem_ops_audit_events (
    id uuid NOT NULL,
    "actorUserId" uuid,
    "actorType" character varying(16) DEFAULT 'staff'::character varying NOT NULL,
    action character varying(64) NOT NULL,
    "entityType" character varying(32) NOT NULL,
    "entityId" uuid,
    before jsonb,
    after jsonb,
    reason character varying(255),
    "requestId" character varying(64),
    "createdAt" timestamp with time zone NOT NULL
);

COMMENT ON COLUMN public.redeem_ops_audit_events."actorType" IS 'staff | agent | partner_user | consumer | system';

COMMENT ON COLUMN public.redeem_ops_audit_events.action IS 'Dot-namespaced action, e.g. access.role_granted, partner.claimed';

CREATE TABLE public.redeem_ops_categories (
    id uuid NOT NULL,
    name character varying(64) NOT NULL,
    "providerSearchTerms" text[],
    "igHashtags" text[],
    "categoryFilterWords" text[],
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);

CREATE TABLE public.redemption_events (
    id uuid NOT NULL,
    "entitlementId" uuid NOT NULL,
    "redemptionId" uuid,
    type character varying(24) NOT NULL,
    metadata jsonb,
    "actorType" character varying(16) DEFAULT 'system'::character varying NOT NULL,
    "actorUserId" uuid,
    "createdAt" timestamp with time zone NOT NULL
);

COMMENT ON COLUMN public.redemption_events.type IS 'reserved|unlocked|claim_viewed|verify_attempt|verified|redeemed|rejected|expired|manual_override|reversed';

COMMENT ON COLUMN public.redemption_events."actorType" IS 'staff|agent|partner_user|consumer|system';

CREATE TABLE public.redemptions (
    id uuid NOT NULL,
    "entitlementId" uuid NOT NULL,
    "rewardOfferId" uuid NOT NULL,
    "activationId" uuid NOT NULL,
    "partnerOrganisationId" uuid NOT NULL,
    "locationId" uuid,
    "redeemedAt" timestamp with time zone NOT NULL,
    method character varying(24) DEFAULT 'code'::character varying NOT NULL,
    status character varying(16) DEFAULT 'completed'::character varying NOT NULL,
    "actorType" character varying(16) DEFAULT 'staff'::character varying NOT NULL,
    "actorUserId" uuid,
    notes text,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);

COMMENT ON COLUMN public.redemptions.method IS 'code|qr|partner_verification|manual_override';

COMMENT ON COLUMN public.redemptions.status IS 'completed|reversed|flagged';

CREATE TABLE public.reward_entitlements (
    id uuid NOT NULL,
    "rewardOfferId" uuid NOT NULL,
    "activationId" uuid NOT NULL,
    "prospectId" uuid,
    "consumerId" uuid,
    status character varying(16) DEFAULT 'eligible'::character varying NOT NULL,
    "reservedAt" timestamp with time zone NOT NULL,
    "unlockedAt" timestamp with time zone,
    "unlockedByUserId" uuid,
    "unlockedVia" character varying(16),
    "expiresAt" timestamp with time zone,
    "presentationTokenHash" character varying(64) NOT NULL,
    "tokenHash" character varying(64),
    "tokenHint" character varying(8),
    "issuedVia" character varying(16) DEFAULT 'hook'::character varying NOT NULL,
    "phoneKey" character varying(20),
    "createdBy" uuid,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);

COMMENT ON COLUMN public.reward_entitlements."prospectId" IS 'Canonical MKTR lead reference — SET NULL on lead delete; entitlement survives PII removal';

COMMENT ON COLUMN public.reward_entitlements."consumerId" IS 'Cross-campaign person link (consumer spine, migration 078) — set unconditionally at issuance from the prospect, phoneKey fallback for legacy rows';

COMMENT ON COLUMN public.reward_entitlements.status IS 'eligible(reserved/locked)|issued(unlocked)|redeemed|expired|cancelled|blocked';

COMMENT ON COLUMN public.reward_entitlements."unlockedVia" IS 'agent_scan|agent_button|auto_on_capture|manual';

COMMENT ON COLUMN public.reward_entitlements."expiresAt" IS 'State-dependent: reservation window while eligible; re-stamped to the redemption window at unlock';

COMMENT ON COLUMN public.reward_entitlements."presentationTokenHash" IS 'SHA-256 of the reservation-pass token (meeting QR)';

COMMENT ON COLUMN public.reward_entitlements."tokenHash" IS 'SHA-256 of the redemption voucher token — minted at unlock';

COMMENT ON COLUMN public.reward_entitlements."tokenHint" IS 'Last 4 of the voucher code, for support';

COMMENT ON COLUMN public.reward_entitlements."issuedVia" IS 'hook|sweep|manual';

COMMENT ON COLUMN public.reward_entitlements."phoneKey" IS 'Digits-only holder phone at issuance — anti-farming dedupe key (one live reward per phone per activation)';

CREATE TABLE public.reward_inventory_events (
    id uuid NOT NULL,
    "rewardOfferId" uuid NOT NULL,
    "activationId" uuid,
    "entitlementId" uuid,
    "redemptionId" uuid,
    type character varying(24) NOT NULL,
    quantity integer NOT NULL,
    "actorType" character varying(16) DEFAULT 'staff'::character varying NOT NULL,
    "actorUserId" uuid,
    reason character varying(255),
    "createdAt" timestamp with time zone NOT NULL
);

COMMENT ON COLUMN public.reward_inventory_events.type IS 'committed|increased|decreased|allocated|deallocated|issued|issue_reversed|redeemed|redeem_reversed|expired|cancelled|manual_adjustment';

CREATE TABLE public.reward_offer_locations (
    id uuid NOT NULL,
    "rewardOfferId" uuid NOT NULL,
    "partnerLocationId" uuid NOT NULL,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);

CREATE TABLE public.reward_offers (
    id uuid NOT NULL,
    "partnerOrganisationId" uuid NOT NULL,
    title character varying(160) NOT NULL,
    "publicTitle" character varying(160),
    "internalRef" character varying(64),
    description text,
    category character varying(64),
    "rewardType" character varying(24) DEFAULT 'free_service'::character varying NOT NULL,
    "retailValue" numeric(10,2),
    "fulfilmentCost" numeric(10,2),
    currency character varying(3) DEFAULT 'SGD'::character varying NOT NULL,
    "fundingSource" character varying(24) DEFAULT 'partner'::character varying NOT NULL,
    "committedQuantity" integer DEFAULT 0 NOT NULL,
    "allocatedQuantity" integer DEFAULT 0 NOT NULL,
    "issuedQuantity" integer DEFAULT 0 NOT NULL,
    "redeemedQuantity" integer DEFAULT 0 NOT NULL,
    "validityStart" timestamp with time zone,
    "validityEnd" timestamp with time zone,
    "claimExpiryDays" integer,
    "redemptionExpiryDays" integer,
    "fulfilmentMethod" character varying(24) DEFAULT 'partner_verification'::character varying NOT NULL,
    "externalBookingUrl" character varying(255),
    status character varying(16) DEFAULT 'draft'::character varying NOT NULL,
    "currentTermsVersion" integer DEFAULT 0 NOT NULL,
    "createdBy" uuid NOT NULL,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL,
    CONSTRAINT chk_reward_offers_quantity_ordering CHECK ((("committedQuantity" >= "allocatedQuantity") AND ("allocatedQuantity" >= "issuedQuantity") AND ("issuedQuantity" >= "redeemedQuantity") AND ("redeemedQuantity" >= 0)))
);

COMMENT ON COLUMN public.reward_offers."publicTitle" IS 'Consumer-facing name; falls back to title';

COMMENT ON COLUMN public.reward_offers."rewardType" IS 'REWARD_TYPES in services/redeemOps/constants.js';

COMMENT ON COLUMN public.reward_offers."fundingSource" IS 'partner|mktr|shared|agent';

COMMENT ON COLUMN public.reward_offers."claimExpiryDays" IS 'Reservation window: attend the review within N days';

COMMENT ON COLUMN public.reward_offers."redemptionExpiryDays" IS 'Redeem-at-partner window, from unlock';

COMMENT ON COLUMN public.reward_offers."fulfilmentMethod" IS 'unique_code|qr|partner_verification|manual_booking|external_link|physical_voucher';

COMMENT ON COLUMN public.reward_offers.status IS 'draft|active|paused|ended';

CREATE TABLE public.reward_terms_versions (
    id uuid NOT NULL,
    "rewardOfferId" uuid NOT NULL,
    version integer NOT NULL,
    structured jsonb DEFAULT '{}'::jsonb NOT NULL,
    "freeText" text,
    "createdBy" uuid NOT NULL,
    "createdAt" timestamp with time zone NOT NULL
);

COMMENT ON COLUMN public.reward_terms_versions.structured IS 'Open shape: {firstTimeOnly, minAge, appointmentRequired, validDays[], …} — never boolean-per-condition';

CREATE TABLE public.round_robin_cursor (
    id uuid NOT NULL,
    "campaignId" uuid NOT NULL,
    cursor integer DEFAULT 0 NOT NULL,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);

CREATE TABLE public.session_visits (
    id uuid NOT NULL,
    "sessionId" character varying(64) NOT NULL,
    "startedAt" timestamp with time zone NOT NULL,
    "landingPath" character varying(255),
    "utmSource" character varying(255),
    "utmMedium" character varying(255),
    "utmCampaign" character varying(255),
    "utmTerm" character varying(255),
    "utmContent" character varying(255),
    "eventsJson" json DEFAULT '[]'::json NOT NULL,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);

CREATE TABLE public.short_link_clicks (
    id uuid NOT NULL,
    "shortLinkId" uuid NOT NULL,
    ua text,
    device character varying(16),
    referer text,
    "ipHash" character varying(128),
    ts timestamp with time zone,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);

CREATE TABLE public.short_links (
    id uuid NOT NULL,
    slug character varying(64) NOT NULL,
    "targetUrl" text NOT NULL,
    purpose character varying(32) DEFAULT 'share'::character varying NOT NULL,
    "campaignId" uuid,
    "prospectId" uuid,
    "createdBy" uuid,
    "expiresAt" timestamp with time zone,
    "clickCount" integer DEFAULT 0,
    "lastClickedAt" timestamp with time zone,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);

CREATE TABLE public.suppression_propagations (
    id uuid NOT NULL,
    "consumerId" uuid NOT NULL,
    "prospectId" uuid NOT NULL,
    "subscriberId" uuid NOT NULL,
    scope character varying(16) NOT NULL,
    reason character varying(32) NOT NULL,
    "occurredAt" timestamp with time zone NOT NULL,
    state character varying(16) DEFAULT 'suppressed'::character varying NOT NULL,
    "deliveredState" character varying(16),
    "deliveryId" uuid,
    "queuedAt" timestamp with time zone,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL,
    CONSTRAINT chk_sp_delivered_state CHECK (((("deliveredState")::text = ANY ((ARRAY['suppressed'::character varying, 'lifted'::character varying])::text[])) OR ("deliveredState" IS NULL))),
    CONSTRAINT chk_sp_reason CHECK (((reason)::text = ANY ((ARRAY['unsubscribe'::character varying, 'complaint'::character varying, 'admin'::character varying, 'erasure'::character varying, 'resubscribe'::character varying])::text[]))),
    CONSTRAINT chk_sp_scope CHECK (((scope)::text = ANY ((ARRAY['marketing'::character varying, 'all'::character varying])::text[]))),
    CONSTRAINT chk_sp_state CHECK (((state)::text = ANY ((ARRAY['suppressed'::character varying, 'lifted'::character varying])::text[])))
);

COMMENT ON COLUMN public.suppression_propagations."occurredAt" IS 'Authoritative transition time (suppression.createdAt / erasedAt / resubscribe event) — stable across repairs';

COMMENT ON COLUMN public.suppression_propagations.state IS 'Desired downstream state; ''all''-scope pairs are a latch and never flip to lifted';

COMMENT ON COLUMN public.suppression_propagations."deliveredState" IS 'What the last queued delivery conveyed; null = nothing queued. Needs-queue = differs from state.';

CREATE TABLE public.users (
    id uuid NOT NULL,
    email character varying(255),
    password character varying(255),
    "firstName" character varying(255),
    "lastName" character varying(255),
    role public.enum_users_role DEFAULT 'customer'::public.enum_users_role NOT NULL,
    "redeemOpsRole" character varying(32),
    phone character varying(255),
    "companyName" character varying(255),
    "dateOfBirth" date,
    avatar character varying(255),
    "isActive" boolean DEFAULT true,
    "lastLogin" timestamp with time zone,
    "emailVerified" boolean DEFAULT false,
    "emailVerificationToken" character varying(255),
    "resetPasswordToken" character varying(255),
    "resetPasswordExpires" timestamp with time zone,
    "invitationToken" character varying(255),
    "invitationExpires" timestamp with time zone,
    "fullName" character varying(255),
    "avatarUrl" character varying(255),
    "googleSub" character varying(255),
    owed_leads_count integer DEFAULT 0,
    "approvalStatus" public."enum_users_approvalStatus" DEFAULT 'pending'::public."enum_users_approvalStatus" NOT NULL,
    "lyfeId" character varying(255),
    "mktrLeadsId" character varying(255),
    "walletBalanceCents" integer DEFAULT 0 NOT NULL,
    external_role character varying(32),
    pending_deletion_at timestamp with time zone,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL,
    CONSTRAINT chk_users_wallet_balance_non_negative CHECK (("walletBalanceCents" >= 0)),
    CONSTRAINT users_single_provenance_chk CHECK ((("lyfeId" IS NULL) OR ("mktrLeadsId" IS NULL)))
);

CREATE TABLE public.verifications (
    phone character varying(255) NOT NULL,
    code character varying(6) NOT NULL,
    attempts integer DEFAULT 0,
    "expiresAt" timestamp with time zone NOT NULL,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);

CREATE TABLE public.wa_message_sends (
    wamid character varying(128) NOT NULL,
    "prospectId" uuid NOT NULL,
    "campaignId" uuid,
    "consumerId" uuid,
    kind character varying(24) NOT NULL,
    "sentAt" timestamp with time zone NOT NULL,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);

COMMENT ON COLUMN public.wa_message_sends.wamid IS 'Meta message id — joins wa_message_statuses';

COMMENT ON COLUMN public.wa_message_sends."prospectId" IS 'The lead this message was sent for — immutable, never derived';

COMMENT ON COLUMN public.wa_message_sends."campaignId" IS 'Campaign as of the send. NULL = the lead carried none; NOT a live lookup';

COMMENT ON COLUMN public.wa_message_sends."consumerId" IS 'Person as of the send — the PDPA erasure key for this table';

COMMENT ON COLUMN public.wa_message_sends.kind IS 'pass | draw_pass | voucher | boost_receipt | screening_callback';

CREATE TABLE public.wa_message_statuses (
    wamid character varying(128) NOT NULL,
    status character varying(16) NOT NULL,
    "errorCode" character varying(16),
    "errorTitle" character varying(200),
    "recipientHash" character varying(64),
    "occurredAt" timestamp with time zone,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);

COMMENT ON COLUMN public.wa_message_statuses.status IS 'sent|delivered|read|failed — rank-guarded, never downgraded';

COMMENT ON COLUMN public.wa_message_statuses."recipientHash" IS 'sha256 hex of the E.164 recipient — PDPA erasure key, no raw phone';

CREATE TABLE public.waitlist_signups (
    id uuid NOT NULL,
    email character varying(255) NOT NULL,
    name character varying(255),
    phone character varying(255),
    source character varying(255),
    "ipAddress" character varying(255),
    "userAgent" text,
    "notifiedAt" timestamp with time zone,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.wallet_ledger (
    id uuid NOT NULL,
    "agentId" uuid NOT NULL,
    type character varying(24) NOT NULL,
    "amountCents" integer NOT NULL,
    "balanceAfterCents" integer NOT NULL,
    "paymentId" uuid,
    "assignmentId" uuid,
    "campaignId" uuid,
    note text,
    "createdBy" uuid,
    "createdAt" timestamp with time zone NOT NULL
);

COMMENT ON COLUMN public.wallet_ledger."amountCents" IS 'Signed: credits positive, debits negative';

COMMENT ON COLUMN public.wallet_ledger."createdBy" IS 'Acting admin for adjustments; null = system';

CREATE TABLE public.webhook_deliveries (
    id uuid NOT NULL,
    "subscriberId" uuid,
    "deliveryId" uuid,
    "eventType" character varying(255) NOT NULL,
    payload json NOT NULL,
    status character varying(255) DEFAULT 'pending'::character varying NOT NULL,
    attempts integer DEFAULT 0,
    "maxAttempts" integer DEFAULT 3,
    "lastAttemptAt" timestamp with time zone,
    "nextRetryAt" timestamp with time zone,
    "responseCode" integer,
    "responseBody" text,
    "errorMessage" text,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);

CREATE TABLE public.webhook_subscribers (
    id uuid NOT NULL,
    name character varying(255) NOT NULL,
    url character varying(255) NOT NULL,
    secret character varying(255) NOT NULL,
    events json DEFAULT '[]'::json NOT NULL,
    enabled boolean DEFAULT true,
    description character varying(255),
    metadata json DEFAULT '{}'::json,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);

ALTER TABLE ONLY public.enrichment_scoring_configs ALTER COLUMN version SET DEFAULT nextval('public.enrichment_scoring_configs_version_seq'::regclass);

ALTER TABLE ONLY auth.tenants
    ADD CONSTRAINT tenants_pkey PRIMARY KEY (id);

ALTER TABLE ONLY auth.tenants
    ADD CONSTRAINT tenants_slug_key UNIQUE (slug);

ALTER TABLE ONLY public._migrations
    ADD CONSTRAINT _migrations_pkey PRIMARY KEY (name);

ALTER TABLE ONLY public.activation_issuance_skips
    ADD CONSTRAINT activation_issuance_skips_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.activations
    ADD CONSTRAINT activations_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.agent_group_members
    ADD CONSTRAINT agent_group_members_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.agent_groups
    ADD CONSTRAINT agent_groups_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.ai_settings
    ADD CONSTRAINT ai_settings_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.attributions
    ADD CONSTRAINT attributions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.campaign_agent_assignments
    ADD CONSTRAINT "campaign_agent_assignments_campaignId_agentId_key" UNIQUE ("campaignId", "agentId");

ALTER TABLE ONLY public.campaign_agent_assignments
    ADD CONSTRAINT campaign_agent_assignments_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.campaign_media_items
    ADD CONSTRAINT campaign_media_items_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.campaign_previews
    ADD CONSTRAINT "campaign_previews_campaignId_key" UNIQUE ("campaignId");

ALTER TABLE ONLY public.campaign_previews
    ADD CONSTRAINT campaign_previews_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.campaign_previews
    ADD CONSTRAINT campaign_previews_slug_key UNIQUE (slug);

ALTER TABLE ONLY public.campaigns
    ADD CONSTRAINT campaigns_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.cohorts
    ADD CONSTRAINT cohorts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.consent_events
    ADD CONSTRAINT consent_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.consumer_observations
    ADD CONSTRAINT consumer_observations_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.consumer_profiles
    ADD CONSTRAINT consumer_profiles_pkey PRIMARY KEY ("consumerId");

ALTER TABLE ONLY public.consumer_suppressions
    ADD CONSTRAINT consumer_suppressions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.consumers
    ADD CONSTRAINT consumers_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.discovery_candidates
    ADD CONSTRAINT discovery_candidates_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.discovery_daily_usage
    ADD CONSTRAINT discovery_daily_usage_pkey PRIMARY KEY ("userId", "sgDate");

ALTER TABLE ONLY public.discovery_place_memory
    ADD CONSTRAINT discovery_place_memory_pkey PRIMARY KEY ("externalPlaceId");

ALTER TABLE ONLY public.discovery_runs
    ADD CONSTRAINT discovery_runs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.discovery_territories
    ADD CONSTRAINT discovery_territories_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.draw_attempts
    ADD CONSTRAINT draw_attempts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.draw_boost_reviews
    ADD CONSTRAINT draw_boost_reviews_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.draw_entries
    ADD CONSTRAINT draw_entries_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.draw_terms_versions
    ADD CONSTRAINT draw_terms_versions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.draws
    ADD CONSTRAINT draws_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.email_broadcast_recipients
    ADD CONSTRAINT email_broadcast_recipients_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.email_broadcasts
    ADD CONSTRAINT email_broadcasts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.enrichment_jobs
    ADD CONSTRAINT enrichment_jobs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.enrichment_scoring_configs
    ADD CONSTRAINT enrichment_scoring_configs_pkey PRIMARY KEY (version);

ALTER TABLE ONLY public.enrichment_sweep_runs
    ADD CONSTRAINT enrichment_sweep_runs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.external_agents
    ADD CONSTRAINT external_agents_phone_key UNIQUE (phone);

ALTER TABLE ONLY public.external_agents
    ADD CONSTRAINT external_agents_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.external_campaign_agents
    ADD CONSTRAINT external_campaign_agents_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.idempotency_keys
    ADD CONSTRAINT idempotency_keys_pkey PRIMARY KEY (scope, key);

ALTER TABLE ONLY public.lead_package_assignments
    ADD CONSTRAINT lead_package_assignments_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.lead_packages
    ADD CONSTRAINT lead_packages_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.outreach_activities
    ADD CONSTRAINT outreach_activities_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.outreach_cadence_enrollments
    ADD CONSTRAINT outreach_cadence_enrollments_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.outreach_cadence_steps
    ADD CONSTRAINT outreach_cadence_steps_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.outreach_cadence_transitions
    ADD CONSTRAINT outreach_cadence_transitions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.outreach_cadences
    ADD CONSTRAINT outreach_cadences_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.outreach_suppressions
    ADD CONSTRAINT outreach_suppressions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.outreach_tasks
    ADD CONSTRAINT outreach_tasks_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.partner_assignment_events
    ADD CONSTRAINT partner_assignment_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.partner_contacts
    ADD CONSTRAINT partner_contacts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.partner_locations
    ADD CONSTRAINT partner_locations_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.partner_onboarding_items
    ADD CONSTRAINT partner_onboarding_items_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.partner_organisations
    ADD CONSTRAINT partner_organisations_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.partner_stage_events
    ADD CONSTRAINT partner_stage_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.phone_verification_markers
    ADD CONSTRAINT phone_verification_markers_pkey PRIMARY KEY ("phoneHash");

ALTER TABLE ONLY public.prospect_activities
    ADD CONSTRAINT prospect_activities_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.prospecting_pool_members
    ADD CONSTRAINT prospecting_pool_members_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.prospecting_pools
    ADD CONSTRAINT prospecting_pools_name_key UNIQUE (name);

ALTER TABLE ONLY public.prospecting_pools
    ADD CONSTRAINT prospecting_pools_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.prospects
    ADD CONSTRAINT prospects_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.qr_scans
    ADD CONSTRAINT qr_scans_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.qr_tags
    ADD CONSTRAINT qr_tags_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.rate_counters
    ADD CONSTRAINT rate_counters_pkey PRIMARY KEY (key);

ALTER TABLE ONLY public.redeem_ops_audit_events
    ADD CONSTRAINT redeem_ops_audit_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.redeem_ops_categories
    ADD CONSTRAINT redeem_ops_categories_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.redemption_events
    ADD CONSTRAINT redemption_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.redemptions
    ADD CONSTRAINT "redemptions_entitlementId_key" UNIQUE ("entitlementId");

ALTER TABLE ONLY public.redemptions
    ADD CONSTRAINT redemptions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.reward_entitlements
    ADD CONSTRAINT reward_entitlements_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.reward_inventory_events
    ADD CONSTRAINT reward_inventory_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.reward_offer_locations
    ADD CONSTRAINT reward_offer_locations_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.reward_offers
    ADD CONSTRAINT reward_offers_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.reward_terms_versions
    ADD CONSTRAINT reward_terms_versions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.round_robin_cursor
    ADD CONSTRAINT "round_robin_cursor_campaignId_key" UNIQUE ("campaignId");

ALTER TABLE ONLY public.round_robin_cursor
    ADD CONSTRAINT round_robin_cursor_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.session_visits
    ADD CONSTRAINT session_visits_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.short_link_clicks
    ADD CONSTRAINT short_link_clicks_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.short_links
    ADD CONSTRAINT short_links_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.short_links
    ADD CONSTRAINT short_links_slug_key UNIQUE (slug);

ALTER TABLE ONLY public.suppression_propagations
    ADD CONSTRAINT suppression_propagations_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT "users_lyfeId_key" UNIQUE ("lyfeId");

ALTER TABLE ONLY public.users
    ADD CONSTRAINT "users_mktrLeadsId_key" UNIQUE ("mktrLeadsId");

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.verifications
    ADD CONSTRAINT verifications_pkey PRIMARY KEY (phone);

ALTER TABLE ONLY public.wa_message_sends
    ADD CONSTRAINT wa_message_sends_pkey PRIMARY KEY (wamid);

ALTER TABLE ONLY public.wa_message_statuses
    ADD CONSTRAINT wa_message_statuses_pkey PRIMARY KEY (wamid);

ALTER TABLE ONLY public.waitlist_signups
    ADD CONSTRAINT waitlist_signups_email_key UNIQUE (email);

ALTER TABLE ONLY public.waitlist_signups
    ADD CONSTRAINT waitlist_signups_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.wallet_ledger
    ADD CONSTRAINT wallet_ledger_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.webhook_deliveries
    ADD CONSTRAINT "webhook_deliveries_deliveryId_key" UNIQUE ("deliveryId");

ALTER TABLE ONLY public.webhook_deliveries
    ADD CONSTRAINT webhook_deliveries_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.webhook_subscribers
    ADD CONSTRAINT webhook_subscribers_pkey PRIMARY KEY (id);

CREATE INDEX attributions_qr_tag_id_last_touch_at ON public.attributions USING btree ("qrTagId", "lastTouchAt");

CREATE INDEX attributions_session_id ON public.attributions USING btree ("sessionId");

CREATE INDEX campaign_agent_assignments_agent_id ON public.campaign_agent_assignments USING btree ("agentId");

CREATE INDEX campaign_agent_assignments_campaign_id ON public.campaign_agent_assignments USING btree ("campaignId");

CREATE UNIQUE INDEX campaign_agent_assignments_campaign_id_agent_id ON public.campaign_agent_assignments USING btree ("campaignId", "agentId");

CREATE INDEX campaign_previews_campaign_id ON public.campaign_previews USING btree ("campaignId");

CREATE INDEX campaign_previews_slug ON public.campaign_previews USING btree (slug);

CREATE INDEX campaigns_created_by ON public.campaigns USING btree ("createdBy");

CREATE INDEX campaigns_start_date_end_date ON public.campaigns USING btree ("startDate", "endDate");

CREATE INDEX campaigns_status ON public.campaigns USING btree (status);

CREATE INDEX campaigns_type ON public.campaigns USING btree (type);

CREATE INDEX external_campaign_agents_campaign_id ON public.external_campaign_agents USING btree ("campaignId");

CREATE INDEX external_campaign_agents_external_agent_id ON public.external_campaign_agents USING btree ("externalAgentId");

CREATE INDEX idempotency_keys_device_id ON public.idempotency_keys USING btree ("deviceId");

CREATE INDEX idempotency_keys_expires_at ON public.idempotency_keys USING btree ("expiresAt");

CREATE INDEX idx_act_offer ON public.activations USING btree ("rewardOfferId");

CREATE INDEX idx_act_partner ON public.activations USING btree ("partnerOrganisationId");

CREATE INDEX idx_act_status ON public.activations USING btree (status);

CREATE INDEX idx_agm_group ON public.agent_group_members USING btree ("agentGroupId");

CREATE INDEX idx_agm_phone ON public.agent_group_members USING btree (phone);

CREATE UNIQUE INDEX idx_agm_unique ON public.agent_group_members USING btree ("agentGroupId", phone);

CREATE INDEX idx_agm_user ON public.agent_group_members USING btree ("userId");

CREATE INDEX idx_ais_activation_created ON public.activation_issuance_skips USING btree ("activationId", "createdAt");

CREATE INDEX idx_ais_campaign_created ON public.activation_issuance_skips USING btree ("campaignId", "createdAt");

CREATE INDEX idx_caa_agent ON public.campaign_agent_assignments USING btree ("agentId");

CREATE INDEX idx_caa_campaign ON public.campaign_agent_assignments USING btree ("campaignId");

CREATE UNIQUE INDEX idx_caa_unique ON public.campaign_agent_assignments USING btree ("campaignId", "agentId");

CREATE INDEX idx_campaigns_tenant ON public.campaigns USING btree (tenant_id);

CREATE INDEX idx_ce_consumer_kind_time ON public.consent_events USING btree ("consumerId", kind, "occurredAt");

CREATE INDEX idx_ce_prospect ON public.consent_events USING btree ("prospectId");

CREATE INDEX idx_cmi_campaign ON public.campaign_media_items USING btree ("campaignId");

CREATE INDEX idx_cobs_artifact ON public.consumer_observations USING btree ("sourceArtifactId") WHERE ("sourceArtifactId" IS NOT NULL);

CREATE INDEX idx_cobs_consumer_key ON public.consumer_observations USING btree ("consumerId", key) WHERE ("consumerId" IS NOT NULL);

CREATE INDEX idx_cobs_prospect_key ON public.consumer_observations USING btree ("sourceProspectId", key) WHERE ("sourceProspectId" IS NOT NULL);

CREATE INDEX idx_cohorts_archived_created ON public.cohorts USING btree ("archivedAt", "createdAt");

CREATE INDEX idx_consumers_last_seen ON public.consumers USING btree ("lastSeenAt");

CREATE INDEX idx_consumers_phone_hash ON public.consumers USING btree ("phoneHash");

CREATE INDEX idx_consumers_unsub_token ON public.consumers USING btree ("unsubTokenHash") WHERE ("unsubTokenHash" IS NOT NULL);

CREATE INDEX idx_cprof_buy_score ON public.consumer_profiles USING btree ("buyScore" DESC) WHERE ("buyScore" IS NOT NULL);

CREATE INDEX idx_cprof_dirty ON public.consumer_profiles USING btree ("consumerId") WHERE ("inputVersion" > "syncedInputVersion");

CREATE INDEX idx_cprof_meet_score ON public.consumer_profiles USING btree ("meetScore" DESC) WHERE ("meetScore" IS NOT NULL);

CREATE INDEX idx_cprof_scored_config ON public.consumer_profiles USING btree ("scoredConfigVersion");

CREATE INDEX idx_de_draw ON public.draw_entries USING btree ("drawId");

CREATE INDEX idx_de_phone_hash ON public.draw_entries USING btree ("phoneHash");

CREATE INDEX idx_de_prospect ON public.draw_entries USING btree ("prospectId") WHERE ("prospectId" IS NOT NULL);

CREATE INDEX idx_discovery_candidates_run ON public.discovery_candidates USING btree ("discoveryRunId", status);

CREATE INDEX idx_discovery_runs_creator ON public.discovery_runs USING btree ("createdBy", "createdAt");

CREATE INDEX idx_discovery_runs_status ON public.discovery_runs USING btree (status, "startedAt");

CREATE INDEX idx_draws_campaign ON public.draws USING btree ("campaignId");

CREATE INDEX idx_dtv_campaign_hash ON public.draw_terms_versions USING btree ("campaignId", "contentSha256");

CREATE INDEX idx_eb_status_created ON public.email_broadcasts USING btree (status, "createdAt");

CREATE INDEX idx_ebr_broadcast_status ON public.email_broadcast_recipients USING btree ("broadcastId", status);

CREATE INDEX idx_ebr_consumer_created ON public.email_broadcast_recipients USING btree ("consumerId", "createdAt");

CREATE INDEX idx_eca_campaign ON public.external_campaign_agents USING btree ("campaignId");

CREATE INDEX idx_eca_external_agent ON public.external_campaign_agents USING btree ("externalAgentId");

CREATE UNIQUE INDEX idx_eca_unique ON public.external_campaign_agents USING btree ("externalAgentId", "campaignId");

CREATE INDEX idx_ejobs_lease_expiry ON public.enrichment_jobs USING btree ("leaseExpiresAt") WHERE ((status)::text = 'leased'::text);

CREATE INDEX idx_ejobs_pending ON public.enrichment_jobs USING btree (kind, "createdAt") WHERE ((status)::text = 'pending'::text);

CREATE INDEX idx_ejobs_subject_consumer ON public.enrichment_jobs USING btree ("subjectConsumerId") WHERE ("subjectConsumerId" IS NOT NULL);

CREATE INDEX idx_ejobs_subject_prospect ON public.enrichment_jobs USING btree ("subjectProspectId") WHERE ("subjectProspectId" IS NOT NULL);

CREATE INDEX idx_escfg_campaign ON public.enrichment_scoring_configs USING btree ("campaignId", version DESC) WHERE ("campaignId" IS NOT NULL);

CREATE INDEX idx_escfg_global ON public.enrichment_scoring_configs USING btree (version DESC) WHERE (("campaignId" IS NULL) AND ("productKey" IS NULL));

CREATE INDEX idx_escfg_product ON public.enrichment_scoring_configs USING btree ("productKey", version DESC) WHERE ("productKey" IS NOT NULL);

CREATE INDEX idx_external_agents_active ON public.external_agents USING btree ("isActive");

CREATE INDEX idx_lpa_agent_status_remaining ON public.lead_package_assignments USING btree ("agentId", status, "leadsRemaining");

CREATE INDEX idx_lpa_open_wallet ON public.lead_package_assignments USING btree ("leadPackageId", "agentId") WHERE (((source)::text = 'wallet'::text) AND (status = 'active'::public.enum_lead_package_assignments_status) AND ("leadsRemaining" > 0));

CREATE INDEX idx_oa_actor_occurred ON public.outreach_activities USING btree ("actorUserId", "occurredAt");

CREATE INDEX idx_oa_partner_occurred ON public.outreach_activities USING btree ("partnerOrganisationId", "occurredAt");

CREATE INDEX idx_oce_state_updated ON public.outreach_cadence_enrollments USING btree (state, "updatedAt");

CREATE INDEX idx_ot_assignee_status_due ON public.outreach_tasks USING btree ("assigneeUserId", status, "dueAt");

CREATE INDEX idx_ot_cadence_enrollment ON public.outreach_tasks USING btree ("cadenceEnrollmentId") WHERE ("cadenceEnrollmentId" IS NOT NULL);

CREATE INDEX idx_ot_due_open ON public.outreach_tasks USING btree ("dueAt") WHERE ((status)::text = ANY ((ARRAY['open'::character varying, 'in_progress'::character varying])::text[]));

CREATE INDEX idx_ot_partner_status ON public.outreach_tasks USING btree ("partnerOrganisationId", status);

CREATE INDEX idx_pae_partner_created ON public.partner_assignment_events USING btree ("partnerOrganisationId", "createdAt");

CREATE INDEX idx_payments_agent_status ON public.payments USING btree ("agentId", status);

CREATE INDEX idx_payments_status ON public.payments USING btree (status);

CREATE INDEX idx_pc_partner ON public.partner_contacts USING btree ("partnerOrganisationId");

CREATE INDEX idx_pl_partner ON public.partner_locations USING btree ("partnerOrganisationId");

CREATE INDEX idx_pl_postal ON public.partner_locations USING btree ("postalCode");

CREATE INDEX idx_po_availability ON public.partner_organisations USING btree (availability);

CREATE INDEX idx_po_category ON public.partner_organisations USING btree (category);

CREATE INDEX idx_po_domain ON public.partner_organisations USING btree ("websiteDomain");

CREATE INDEX idx_po_last_activity ON public.partner_organisations USING btree ("lastActivityAt");

CREATE INDEX idx_po_name_trgm ON public.partner_organisations USING gin ("normalizedName" public.gin_trgm_ops);

CREATE INDEX idx_po_next_task ON public.partner_organisations USING btree ("nextTaskAt");

CREATE INDEX idx_po_normalized_name ON public.partner_organisations USING btree ("normalizedName");

CREATE INDEX idx_po_owner_stage ON public.partner_organisations USING btree ("ownerUserId", "pipelineStage");

CREATE INDEX idx_po_stage ON public.partner_organisations USING btree ("pipelineStage");

CREATE INDEX idx_ppm_pool_status ON public.prospecting_pool_members USING btree ("poolId", status);

CREATE INDEX idx_prospects_agent_created ON public.prospects USING btree ("assignedAgentId", "createdAt");

CREATE INDEX idx_prospects_agent_status ON public.prospects USING btree ("assignedAgentId", "leadStatus");

CREATE INDEX idx_prospects_campaign_created ON public.prospects USING btree ("campaignId", "createdAt");

CREATE INDEX idx_prospects_consumer ON public.prospects USING btree ("consumerId");

CREATE INDEX idx_prospects_consumer_score ON public.prospects USING btree ("consumerId", score DESC, "createdAt" DESC, id DESC);

CREATE INDEX idx_prospects_conversiondate ON public.prospects USING btree ("conversionDate") WHERE ("conversionDate" IS NOT NULL);

CREATE INDEX idx_prospects_createdat ON public.prospects USING btree ("createdAt");

CREATE INDEX idx_prospects_dnc_status ON public.prospects USING btree ("dncStatus");

CREATE INDEX idx_prospects_dnc_valid_until ON public.prospects USING btree ("dncValidUntil");

CREATE INDEX idx_prospects_external_agent ON public.prospects USING btree ("externalAgentId");

CREATE INDEX idx_prospects_quarantinedat ON public.prospects USING btree ("quarantinedAt");

CREATE INDEX idx_prospects_score_dirty ON public.prospects USING btree ("scoreDirtyAt") WHERE ("scoreDirtyAt" IS NOT NULL);

CREATE INDEX idx_prospects_score_stale ON public.prospects USING btree ("scoredConfigVersion", "scoringAlgorithmVersion", id);

CREATE INDEX idx_prospects_tenant ON public.prospects USING btree (tenant_id);

CREATE INDEX idx_pse_partner_created ON public.partner_stage_events USING btree ("partnerOrganisationId", "createdAt");

CREATE INDEX idx_pvm_verified_at ON public.phone_verification_markers USING btree ("verifiedAt");

CREATE INDEX idx_qr_scans_dedup_window ON public.qr_scans USING btree ("qrTagId", "ipHash", ts);

CREATE INDEX idx_qr_tags_tenant ON public.qr_tags USING btree (tenant_id);

CREATE INDEX idx_qrtags_agent_group ON public.qr_tags USING btree ("agentGroupId");

CREATE INDEX idx_qrtags_agentgroupid ON public.qr_tags USING btree ("agentGroupId") WHERE ("agentGroupId" IS NOT NULL);

CREATE INDEX idx_qrtags_assignedagentid ON public.qr_tags USING btree ("assignedAgentId");

CREATE INDEX idx_qrtags_owneruserid ON public.qr_tags USING btree ("ownerUserId");

CREATE UNIQUE INDEX idx_qrtags_slug_unique ON public.qr_tags USING btree (slug) WHERE (slug IS NOT NULL);

CREATE INDEX idx_rde_entitlement_created ON public.redemption_events USING btree ("entitlementId", "createdAt");

CREATE INDEX idx_re_activation_status ON public.reward_entitlements USING btree ("activationId", status);

CREATE INDEX idx_re_consumer ON public.reward_entitlements USING btree ("consumerId");

CREATE INDEX idx_re_expiry_eligible ON public.reward_entitlements USING btree ("expiresAt") WHERE ((status)::text = 'eligible'::text);

CREATE INDEX idx_re_prospect ON public.reward_entitlements USING btree ("prospectId");

CREATE INDEX idx_red_partner_redeemed ON public.redemptions USING btree ("partnerOrganisationId", "redeemedAt");

CREATE INDEX idx_rie_activation ON public.reward_inventory_events USING btree ("activationId");

CREATE INDEX idx_rie_offer_created ON public.reward_inventory_events USING btree ("rewardOfferId", "createdAt");

CREATE INDEX idx_ro_partner_status ON public.reward_offers USING btree ("partnerOrganisationId", status);

CREATE INDEX idx_roae_action ON public.redeem_ops_audit_events USING btree (action, "createdAt");

CREATE INDEX idx_roae_actor ON public.redeem_ops_audit_events USING btree ("actorUserId", "createdAt");

CREATE INDEX idx_roae_entity ON public.redeem_ops_audit_events USING btree ("entityType", "entityId", "createdAt");

CREATE INDEX idx_sp_consumer ON public.suppression_propagations USING btree ("consumerId");

CREATE INDEX idx_sp_needs_queue ON public.suppression_propagations USING btree ("createdAt") WHERE ("queuedAt" IS NULL);

CREATE INDEX idx_sp_state_pending ON public.suppression_propagations USING btree ("createdAt");

CREATE UNIQUE INDEX idx_users_lyfe_id ON public.users USING btree ("lyfeId");

CREATE INDEX idx_users_phone ON public.users USING btree (phone) WHERE (phone IS NOT NULL);

CREATE INDEX idx_users_role_isactive ON public.users USING btree (role, "isActive");

CREATE INDEX idx_wa_sends_consumer ON public.wa_message_sends USING btree ("consumerId");

CREATE INDEX idx_wa_sends_prospect ON public.wa_message_sends USING btree ("prospectId");

CREATE INDEX idx_waitlist_signups_created ON public.waitlist_signups USING btree ("createdAt");

CREATE UNIQUE INDEX idx_waitlist_signups_email ON public.waitlist_signups USING btree (email);

CREATE INDEX idx_wallet_ledger_agent_created ON public.wallet_ledger USING btree ("agentId", "createdAt");

CREATE INDEX idx_wd_lead_external_created ON public.webhook_deliveries USING btree ((((payload)::jsonb #>> '{data,lead,externalId}'::text[])), "createdAt" DESC) WHERE (("eventType")::text = ANY ((ARRAY['lead.created'::character varying, 'lead.assigned'::character varying])::text[]));

CREATE INDEX idx_webhook_deliveries_created_at ON public.webhook_deliveries USING btree ("createdAt");

CREATE INDEX idx_webhook_deliveries_status_subscriber ON public.webhook_deliveries USING btree (status, "subscriberId");

CREATE INDEX idx_wms_recipient_hash ON public.wa_message_statuses USING btree ("recipientHash");

CREATE INDEX lead_package_assignments_agent_id ON public.lead_package_assignments USING btree ("agentId");

CREATE INDEX lead_package_assignments_lead_package_id ON public.lead_package_assignments USING btree ("leadPackageId");

CREATE INDEX lead_package_assignments_status ON public.lead_package_assignments USING btree (status);

CREATE INDEX lead_packages_campaign_id ON public.lead_packages USING btree ("campaignId");

CREATE INDEX lead_packages_category ON public.lead_packages USING btree (category);

CREATE INDEX lead_packages_created_by ON public.lead_packages USING btree ("createdBy");

CREATE INDEX lead_packages_is_public ON public.lead_packages USING btree ("isPublic");

CREATE INDEX lead_packages_price ON public.lead_packages USING btree (price);

CREATE INDEX lead_packages_status ON public.lead_packages USING btree (status);

CREATE INDEX lead_packages_type ON public.lead_packages USING btree (type);

CREATE INDEX payments_status ON public.payments USING btree (status);

CREATE INDEX prospect_activities_actor_user_id ON public.prospect_activities USING btree ("actorUserId");

CREATE INDEX prospect_activities_prospect_id ON public.prospect_activities USING btree ("prospectId");

CREATE INDEX prospect_activities_type ON public.prospect_activities USING btree (type);

CREATE INDEX prospects_assigned_agent_id ON public.prospects USING btree ("assignedAgentId");

CREATE INDEX prospects_campaign_id ON public.prospects USING btree ("campaignId");

CREATE UNIQUE INDEX prospects_campaign_id_phone ON public.prospects USING btree ("campaignId", phone) WHERE ((phone IS NOT NULL) AND ((phone)::text <> ''::text));

CREATE INDEX prospects_email ON public.prospects USING btree (email);

CREATE INDEX prospects_email_lower_idx ON public.prospects USING btree (lower(TRIM(BOTH FROM email))) WHERE ((email IS NOT NULL) AND ((email)::text !~~ '%@calls.mktr.sg'::text));

CREATE INDEX prospects_external_agent_id ON public.prospects USING btree ("externalAgentId");

CREATE INDEX prospects_last_contact_date ON public.prospects USING btree ("lastContactDate");

CREATE INDEX prospects_lead_source ON public.prospects USING btree ("leadSource");

CREATE INDEX prospects_lead_status ON public.prospects USING btree ("leadStatus");

CREATE INDEX prospects_next_follow_up_date ON public.prospects USING btree ("nextFollowUpDate");

CREATE INDEX prospects_phone_idx ON public.prospects USING btree (phone) WHERE ((phone IS NOT NULL) AND ((phone)::text <> ''::text));

CREATE INDEX prospects_priority ON public.prospects USING btree (priority);

CREATE INDEX prospects_qr_tag_id ON public.prospects USING btree ("qrTagId");

CREATE UNIQUE INDEX prospects_retell_call_id ON public.prospects USING btree ("retellCallId") WHERE ("retellCallId" IS NOT NULL);

CREATE INDEX qr_scans_bot_flag ON public.qr_scans USING btree ("botFlag");

CREATE INDEX qr_scans_qr_tag_id_ts ON public.qr_scans USING btree ("qrTagId", ts);

CREATE INDEX qr_tags_campaign_id ON public.qr_tags USING btree ("campaignId");

CREATE INDEX qr_tags_car_id ON public.qr_tags USING btree ("carId");

CREATE INDEX qr_tags_type ON public.qr_tags USING btree (type);

CREATE INDEX rate_counters_expires_idx ON public.rate_counters USING btree ("expiresAt");

CREATE UNIQUE INDEX round_robin_cursor_campaign_id ON public.round_robin_cursor USING btree ("campaignId");

CREATE INDEX session_visits_session_id ON public.session_visits USING btree ("sessionId");

CREATE INDEX short_link_clicks_short_link_id ON public.short_link_clicks USING btree ("shortLinkId");

CREATE INDEX short_link_clicks_ts ON public.short_link_clicks USING btree (ts);

CREATE INDEX short_links_campaign_id ON public.short_links USING btree ("campaignId");

CREATE UNIQUE INDEX short_links_prospect_id_unique ON public.short_links USING btree ("prospectId") WHERE ("prospectId" IS NOT NULL);

CREATE INDEX short_links_purpose ON public.short_links USING btree (purpose);

CREATE UNIQUE INDEX short_links_slug ON public.short_links USING btree (slug);

CREATE UNIQUE INDEX uniq_car_qr ON public.qr_tags USING btree ("carId") WHERE ((type)::text = 'car'::text);

CREATE UNIQUE INDEX uniq_payments_assignment ON public.payments USING btree ("leadPackageAssignmentId") WHERE ("leadPackageAssignmentId" IS NOT NULL);

CREATE UNIQUE INDEX uniq_payments_provider_payment ON public.payments USING btree ("providerPaymentId") WHERE ("providerPaymentId" IS NOT NULL);

CREATE UNIQUE INDEX uniq_payments_provider_request ON public.payments USING btree ("providerRequestId") WHERE ("providerRequestId" IS NOT NULL);

CREATE UNIQUE INDEX uq_act_live_campaign ON public.activations USING btree ("campaignId") WHERE (((status)::text = ANY ((ARRAY['preparing'::character varying, 'active'::character varying, 'paused'::character varying])::text[])) AND ("campaignId" IS NOT NULL));

CREATE UNIQUE INDEX uq_campaigns_slug ON public.campaigns USING btree (slug) WHERE (slug IS NOT NULL);

CREATE UNIQUE INDEX uq_ce_backfill ON public.consent_events USING btree ("prospectId", kind) WHERE ((source)::text = 'backfill'::text);

CREATE UNIQUE INDEX uq_cobs_artifact_revision_key ON public.consumer_observations USING btree ("sourceArtifactId", "sourceRevisionId", pipeline, "pipelineVersion", key) WHERE ("sourceArtifactId" IS NOT NULL);

CREATE UNIQUE INDEX uq_consumers_phone ON public.consumers USING btree (phone) WHERE (phone IS NOT NULL);

CREATE UNIQUE INDEX uq_cs_consumer_channel ON public.consumer_suppressions USING btree ("consumerId", channel);

CREATE UNIQUE INDEX uq_da_draw_attempt ON public.draw_attempts USING btree ("drawId", "attemptNo");

CREATE UNIQUE INDEX uq_dbr_draw_entitlement ON public.draw_boost_reviews USING btree ("drawId", "entitlementId");

CREATE UNIQUE INDEX uq_de_draw_prospect ON public.draw_entries USING btree ("drawId", "prospectId") WHERE ("prospectId" IS NOT NULL);

CREATE UNIQUE INDEX uq_discovery_candidates_run_place ON public.discovery_candidates USING btree ("discoveryRunId", "externalPlaceId") WHERE ("externalPlaceId" IS NOT NULL);

CREATE UNIQUE INDEX uq_discovery_runs_provider_run_id ON public.discovery_runs USING btree ("providerRunId") WHERE ("providerRunId" IS NOT NULL);

CREATE UNIQUE INDEX uq_discovery_territories_name_ci ON public.discovery_territories USING btree (lower((name)::text));

CREATE UNIQUE INDEX uq_draws_live_campaign ON public.draws USING btree ("campaignId") WHERE ((status)::text = ANY ((ARRAY['open'::character varying, 'frozen'::character varying, 'sealed'::character varying, 'drawn'::character varying])::text[]));

CREATE UNIQUE INDEX uq_dtv_campaign_version ON public.draw_terms_versions USING btree ("campaignId", version);

CREATE UNIQUE INDEX uq_ebr_broadcast_consumer ON public.email_broadcast_recipients USING btree ("broadcastId", "consumerId");

CREATE UNIQUE INDEX uq_ejobs_extract ON public.enrichment_jobs USING btree (kind, "subjectProspectId", "sourceArtifactId", "sourceRevisionId", "pipelineVersion") WHERE (((kind)::text = 'extract'::text) AND ((status)::text = ANY ((ARRAY['pending'::character varying, 'leased'::character varying, 'done'::character varying])::text[])));

CREATE UNIQUE INDEX uq_ejobs_map ON public.enrichment_jobs USING btree (kind, "subjectProspectId", "sourceRevisionId", "pipelineVersion") WHERE (((kind)::text = 'map'::text) AND ("sourceArtifactId" IS NULL) AND ((status)::text = ANY ((ARRAY['pending'::character varying, 'leased'::character varying, 'done'::character varying])::text[])));

CREATE UNIQUE INDEX uq_ejobs_map_artifact ON public.enrichment_jobs USING btree (kind, "subjectProspectId", "sourceArtifactId", "sourceRevisionId", "pipelineVersion") WHERE (((kind)::text = 'map'::text) AND ("sourceArtifactId" IS NOT NULL) AND ((status)::text = ANY ((ARRAY['pending'::character varying, 'leased'::character varying, 'done'::character varying])::text[])));

CREATE UNIQUE INDEX uq_ejobs_synthesize ON public.enrichment_jobs USING btree (kind, "subjectConsumerId", "inputHash", "promptVersion") WHERE (((kind)::text = 'synthesize'::text) AND ((status)::text = ANY ((ARRAY['pending'::character varying, 'leased'::character varying])::text[])));

CREATE UNIQUE INDEX uq_esruns_nightly_date ON public.enrichment_sweep_runs USING btree ("runDateSgt") WHERE ((("runType")::text = 'nightly'::text) AND ((status)::text = ANY ((ARRAY['running'::character varying, 'done'::character varying])::text[])));

CREATE UNIQUE INDEX uq_lead_packages_wallet_campaign ON public.lead_packages USING btree ("campaignId") WHERE ((kind)::text = 'wallet'::text);

CREATE UNIQUE INDEX uq_oc_key_version ON public.outreach_cadences USING btree (key, version);

CREATE UNIQUE INDEX uq_oce_live_partner ON public.outreach_cadence_enrollments USING btree ("partnerOrganisationId") WHERE ((state)::text = ANY ((ARRAY['active'::character varying, 'paused'::character varying])::text[]));

CREATE UNIQUE INDEX uq_ocs_cadence_order ON public.outreach_cadence_steps USING btree ("cadenceId", "stepOrder");

CREATE UNIQUE INDEX uq_oct_entry ON public.outreach_cadence_transitions USING btree ("cadenceId", disposition) WHERE ("fromStepId" IS NULL);

CREATE UNIQUE INDEX uq_oct_from_dispo ON public.outreach_cadence_transitions USING btree ("fromStepId", disposition) WHERE ("fromStepId" IS NOT NULL);

CREATE UNIQUE INDEX uq_osup_channel_value ON public.outreach_suppressions USING btree (channel, value);

CREATE UNIQUE INDEX uq_ot_open_per_enrollment ON public.outreach_tasks USING btree ("cadenceEnrollmentId") WHERE (("cadenceEnrollmentId" IS NOT NULL) AND ((status)::text = ANY ((ARRAY['open'::character varying, 'in_progress'::character varying])::text[])));

CREATE UNIQUE INDEX uq_pc_one_live_primary ON public.partner_contacts USING btree ("partnerOrganisationId") WHERE (("isPrimary" = true) AND ("archivedAt" IS NULL));

CREATE UNIQUE INDEX uq_po_instagram ON public.partner_organisations USING btree ("instagramHandle") WHERE ("instagramHandle" IS NOT NULL);

CREATE UNIQUE INDEX uq_po_phone ON public.partner_organisations USING btree ("primaryPhone") WHERE ("primaryPhone" IS NOT NULL);

CREATE UNIQUE INDEX uq_po_tiktok ON public.partner_organisations USING btree ("tiktokHandle") WHERE ("tiktokHandle" IS NOT NULL);

CREATE UNIQUE INDEX uq_po_uen ON public.partner_organisations USING btree (uen) WHERE (uen IS NOT NULL);

CREATE UNIQUE INDEX uq_poi_partner_key ON public.partner_onboarding_items USING btree ("partnerOrganisationId", "itemKey");

CREATE UNIQUE INDEX uq_ppm_pool_partner ON public.prospecting_pool_members USING btree ("poolId", "partnerOrganisationId");

CREATE UNIQUE INDEX uq_re_activation_phone ON public.reward_entitlements USING btree ("activationId", "phoneKey") WHERE (("phoneKey" IS NOT NULL) AND ((status)::text = ANY ((ARRAY['eligible'::character varying, 'issued'::character varying, 'redeemed'::character varying])::text[])));

CREATE UNIQUE INDEX uq_re_activation_prospect ON public.reward_entitlements USING btree ("activationId", "prospectId") WHERE ("prospectId" IS NOT NULL);

CREATE UNIQUE INDEX uq_re_presentation_token ON public.reward_entitlements USING btree ("presentationTokenHash");

CREATE UNIQUE INDEX uq_re_voucher_token ON public.reward_entitlements USING btree ("tokenHash") WHERE ("tokenHash" IS NOT NULL);

CREATE UNIQUE INDEX uq_redeem_ops_categories_name_ci ON public.redeem_ops_categories USING btree (lower((name)::text));

CREATE UNIQUE INDEX uq_rol_offer_location ON public.reward_offer_locations USING btree ("rewardOfferId", "partnerLocationId");

CREATE UNIQUE INDEX uq_rtv_offer_version ON public.reward_terms_versions USING btree ("rewardOfferId", version);

CREATE UNIQUE INDEX uq_sp_sub_prospect_scope ON public.suppression_propagations USING btree ("subscriberId", "prospectId", scope);

CREATE UNIQUE INDEX uq_wallet_ledger_refund_assignment ON public.wallet_ledger USING btree ("assignmentId") WHERE ((type)::text = 'takedown_refund'::text);

CREATE UNIQUE INDEX uq_wallet_ledger_topup_payment ON public.wallet_ledger USING btree ("paymentId") WHERE ((type)::text = 'topup'::text);

CREATE INDEX users_external_role_idx ON public.users USING btree (external_role) WHERE (external_role IS NOT NULL);

CREATE UNIQUE INDEX users_mktr_leads_id_uniq ON public.users USING btree ("mktrLeadsId") WHERE ("mktrLeadsId" IS NOT NULL);

CREATE INDEX users_pending_deletion_at_idx ON public.users USING btree (pending_deletion_at) WHERE (pending_deletion_at IS NOT NULL);

CREATE INDEX waitlist_signups_created_at ON public.waitlist_signups USING btree ("createdAt");

CREATE INDEX webhook_deliveries_status_next_retry_at ON public.webhook_deliveries USING btree (status, "nextRetryAt");

CREATE INDEX webhook_deliveries_subscriber_id ON public.webhook_deliveries USING btree ("subscriberId");

ALTER TABLE ONLY public.activations
    ADD CONSTRAINT "activations_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES public.campaigns(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY public.activations
    ADD CONSTRAINT "activations_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES public.users(id);

ALTER TABLE ONLY public.activations
    ADD CONSTRAINT "activations_partnerOrganisationId_fkey" FOREIGN KEY ("partnerOrganisationId") REFERENCES public.partner_organisations(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY public.activations
    ADD CONSTRAINT "activations_rewardOfferId_fkey" FOREIGN KEY ("rewardOfferId") REFERENCES public.reward_offers(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY public.agent_group_members
    ADD CONSTRAINT "agent_group_members_agentGroupId_fkey" FOREIGN KEY ("agentGroupId") REFERENCES public.agent_groups(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.agent_group_members
    ADD CONSTRAINT "agent_group_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY public.agent_groups
    ADD CONSTRAINT "agent_groups_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES public.users(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.attributions
    ADD CONSTRAINT "attributions_qrScanId_fkey" FOREIGN KEY ("qrScanId") REFERENCES public.qr_scans(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.attributions
    ADD CONSTRAINT "attributions_qrTagId_fkey" FOREIGN KEY ("qrTagId") REFERENCES public.qr_tags(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.campaign_agent_assignments
    ADD CONSTRAINT "campaign_agent_assignments_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.campaign_agent_assignments
    ADD CONSTRAINT "campaign_agent_assignments_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES public.campaigns(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.campaign_media_items
    ADD CONSTRAINT "campaign_media_items_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES public.campaigns(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.campaign_previews
    ADD CONSTRAINT "campaign_previews_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES public.campaigns(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.campaigns
    ADD CONSTRAINT "campaigns_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES public.users(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.cohorts
    ADD CONSTRAINT "cohorts_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY public.consent_events
    ADD CONSTRAINT "consent_events_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES public.campaigns(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY public.consent_events
    ADD CONSTRAINT "consent_events_consumerId_fkey" FOREIGN KEY ("consumerId") REFERENCES public.consumers(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY public.consent_events
    ADD CONSTRAINT "consent_events_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES public.prospects(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY public.consumer_observations
    ADD CONSTRAINT "consumer_observations_consumerId_fkey" FOREIGN KEY ("consumerId") REFERENCES public.consumers(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.consumer_observations
    ADD CONSTRAINT "consumer_observations_sourceProspectId_fkey" FOREIGN KEY ("sourceProspectId") REFERENCES public.prospects(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.consumer_profiles
    ADD CONSTRAINT "consumer_profiles_consumerId_fkey" FOREIGN KEY ("consumerId") REFERENCES public.consumers(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.consumer_suppressions
    ADD CONSTRAINT "consumer_suppressions_consumerId_fkey" FOREIGN KEY ("consumerId") REFERENCES public.consumers(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY public.discovery_candidates
    ADD CONSTRAINT "discovery_candidates_addedPartnerId_fkey" FOREIGN KEY ("addedPartnerId") REFERENCES public.partner_organisations(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY public.discovery_candidates
    ADD CONSTRAINT "discovery_candidates_discoveryRunId_fkey" FOREIGN KEY ("discoveryRunId") REFERENCES public.discovery_runs(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.discovery_candidates
    ADD CONSTRAINT "discovery_candidates_matchedPartnerId_fkey" FOREIGN KEY ("matchedPartnerId") REFERENCES public.partner_organisations(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY public.discovery_place_memory
    ADD CONSTRAINT "discovery_place_memory_addedPartnerId_fkey" FOREIGN KEY ("addedPartnerId") REFERENCES public.partner_organisations(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY public.discovery_runs
    ADD CONSTRAINT "discovery_runs_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.draw_attempts
    ADD CONSTRAINT "draw_attempts_drawId_fkey" FOREIGN KEY ("drawId") REFERENCES public.draws(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.draw_attempts
    ADD CONSTRAINT "draw_attempts_pickedEntryId_fkey" FOREIGN KEY ("pickedEntryId") REFERENCES public.draw_entries(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY public.draw_attempts
    ADD CONSTRAINT "draw_attempts_witnessedByUserId_fkey" FOREIGN KEY ("witnessedByUserId") REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.draw_boost_reviews
    ADD CONSTRAINT "draw_boost_reviews_drawId_fkey" FOREIGN KEY ("drawId") REFERENCES public.draws(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.draw_boost_reviews
    ADD CONSTRAINT "draw_boost_reviews_entitlementId_fkey" FOREIGN KEY ("entitlementId") REFERENCES public.reward_entitlements(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY public.draw_boost_reviews
    ADD CONSTRAINT "draw_boost_reviews_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES public.users(id);

ALTER TABLE ONLY public.draw_entries
    ADD CONSTRAINT "draw_entries_boostEventId_fkey" FOREIGN KEY ("boostEventId") REFERENCES public.redemption_events(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.draw_entries
    ADD CONSTRAINT "draw_entries_drawId_fkey" FOREIGN KEY ("drawId") REFERENCES public.draws(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.draw_entries
    ADD CONSTRAINT "draw_entries_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES public.prospects(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY public.draw_terms_versions
    ADD CONSTRAINT "draw_terms_versions_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES public.campaigns(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.draw_terms_versions
    ADD CONSTRAINT "draw_terms_versions_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES public.users(id);

ALTER TABLE ONLY public.draws
    ADD CONSTRAINT "draws_activationId_fkey" FOREIGN KEY ("activationId") REFERENCES public.activations(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY public.draws
    ADD CONSTRAINT "draws_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES public.campaigns(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY public.draws
    ADD CONSTRAINT "draws_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES public.users(id);

ALTER TABLE ONLY public.draws
    ADD CONSTRAINT "draws_termsVersionId_fkey" FOREIGN KEY ("termsVersionId") REFERENCES public.draw_terms_versions(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY public.draws
    ADD CONSTRAINT "draws_witnessedByUserId_fkey" FOREIGN KEY ("witnessedByUserId") REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.email_broadcast_recipients
    ADD CONSTRAINT "email_broadcast_recipients_broadcastId_fkey" FOREIGN KEY ("broadcastId") REFERENCES public.email_broadcasts(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.email_broadcast_recipients
    ADD CONSTRAINT "email_broadcast_recipients_consumerId_fkey" FOREIGN KEY ("consumerId") REFERENCES public.consumers(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY public.email_broadcasts
    ADD CONSTRAINT "email_broadcasts_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES public.campaigns(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY public.email_broadcasts
    ADD CONSTRAINT "email_broadcasts_cohortId_fkey" FOREIGN KEY ("cohortId") REFERENCES public.cohorts(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY public.email_broadcasts
    ADD CONSTRAINT "email_broadcasts_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY public.enrichment_jobs
    ADD CONSTRAINT "enrichment_jobs_subjectConsumerId_fkey" FOREIGN KEY ("subjectConsumerId") REFERENCES public.consumers(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.enrichment_jobs
    ADD CONSTRAINT "enrichment_jobs_subjectProspectId_fkey" FOREIGN KEY ("subjectProspectId") REFERENCES public.prospects(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.enrichment_scoring_configs
    ADD CONSTRAINT "enrichment_scoring_configs_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY public.external_campaign_agents
    ADD CONSTRAINT "external_campaign_agents_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES public.campaigns(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.external_campaign_agents
    ADD CONSTRAINT "external_campaign_agents_externalAgentId_fkey" FOREIGN KEY ("externalAgentId") REFERENCES public.external_agents(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.consumer_observations
    ADD CONSTRAINT fk_cobs_consumer FOREIGN KEY ("consumerId") REFERENCES public.consumers(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.consumer_observations
    ADD CONSTRAINT fk_cobs_prospect FOREIGN KEY ("sourceProspectId") REFERENCES public.prospects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.consumer_profiles
    ADD CONSTRAINT fk_cprof_consumer FOREIGN KEY ("consumerId") REFERENCES public.consumers(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.consumer_profiles
    ADD CONSTRAINT fk_cprof_score_source FOREIGN KEY ("scoreSourceProspectId") REFERENCES public.prospects(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.enrichment_jobs
    ADD CONSTRAINT fk_ejobs_consumer FOREIGN KEY ("subjectConsumerId") REFERENCES public.consumers(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.enrichment_jobs
    ADD CONSTRAINT fk_ejobs_prospect FOREIGN KEY ("subjectProspectId") REFERENCES public.prospects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.enrichment_scoring_configs
    ADD CONSTRAINT fk_escfg_actor FOREIGN KEY ("actorUserId") REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.redemption_events
    ADD CONSTRAINT fk_rde_entitlement FOREIGN KEY ("entitlementId") REFERENCES public.reward_entitlements(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.redemption_events
    ADD CONSTRAINT fk_rde_redemption FOREIGN KEY ("redemptionId") REFERENCES public.redemptions(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.reward_inventory_events
    ADD CONSTRAINT fk_rie_activation FOREIGN KEY ("activationId") REFERENCES public.activations(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.reward_inventory_events
    ADD CONSTRAINT fk_rie_entitlement FOREIGN KEY ("entitlementId") REFERENCES public.reward_entitlements(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.reward_inventory_events
    ADD CONSTRAINT fk_rie_redemption FOREIGN KEY ("redemptionId") REFERENCES public.redemptions(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.suppression_propagations
    ADD CONSTRAINT fk_sp_consumer FOREIGN KEY ("consumerId") REFERENCES public.consumers(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.suppression_propagations
    ADD CONSTRAINT fk_sp_prospect FOREIGN KEY ("prospectId") REFERENCES public.prospects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.suppression_propagations
    ADD CONSTRAINT fk_sp_subscriber FOREIGN KEY ("subscriberId") REFERENCES public.webhook_subscribers(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.lead_package_assignments
    ADD CONSTRAINT "lead_package_assignments_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.lead_package_assignments
    ADD CONSTRAINT "lead_package_assignments_leadPackageId_fkey" FOREIGN KEY ("leadPackageId") REFERENCES public.lead_packages(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.lead_packages
    ADD CONSTRAINT "lead_packages_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES public.campaigns(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.lead_packages
    ADD CONSTRAINT "lead_packages_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES public.users(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.outreach_activities
    ADD CONSTRAINT "outreach_activities_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY public.outreach_activities
    ADD CONSTRAINT "outreach_activities_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES public.partner_contacts(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY public.outreach_activities
    ADD CONSTRAINT "outreach_activities_partnerOrganisationId_fkey" FOREIGN KEY ("partnerOrganisationId") REFERENCES public.partner_organisations(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.outreach_cadence_enrollments
    ADD CONSTRAINT "outreach_cadence_enrollments_cadenceId_fkey" FOREIGN KEY ("cadenceId") REFERENCES public.outreach_cadences(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY public.outreach_cadence_enrollments
    ADD CONSTRAINT "outreach_cadence_enrollments_currentStepId_fkey" FOREIGN KEY ("currentStepId") REFERENCES public.outreach_cadence_steps(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY public.outreach_cadence_enrollments
    ADD CONSTRAINT "outreach_cadence_enrollments_enrolledBy_fkey" FOREIGN KEY ("enrolledBy") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY public.outreach_cadence_enrollments
    ADD CONSTRAINT "outreach_cadence_enrollments_partnerOrganisationId_fkey" FOREIGN KEY ("partnerOrganisationId") REFERENCES public.partner_organisations(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.outreach_cadence_steps
    ADD CONSTRAINT "outreach_cadence_steps_cadenceId_fkey" FOREIGN KEY ("cadenceId") REFERENCES public.outreach_cadences(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY public.outreach_cadence_transitions
    ADD CONSTRAINT "outreach_cadence_transitions_cadenceId_fkey" FOREIGN KEY ("cadenceId") REFERENCES public.outreach_cadences(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY public.outreach_cadence_transitions
    ADD CONSTRAINT "outreach_cadence_transitions_fromStepId_fkey" FOREIGN KEY ("fromStepId") REFERENCES public.outreach_cadence_steps(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY public.outreach_cadence_transitions
    ADD CONSTRAINT "outreach_cadence_transitions_toStepId_fkey" FOREIGN KEY ("toStepId") REFERENCES public.outreach_cadence_steps(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY public.outreach_cadences
    ADD CONSTRAINT "outreach_cadences_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY public.outreach_tasks
    ADD CONSTRAINT "outreach_tasks_assigneeUserId_fkey" FOREIGN KEY ("assigneeUserId") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.outreach_tasks
    ADD CONSTRAINT "outreach_tasks_cadenceEnrollmentId_fkey" FOREIGN KEY ("cadenceEnrollmentId") REFERENCES public.outreach_cadence_enrollments(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY public.outreach_tasks
    ADD CONSTRAINT "outreach_tasks_cadenceStepId_fkey" FOREIGN KEY ("cadenceStepId") REFERENCES public.outreach_cadence_steps(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY public.outreach_tasks
    ADD CONSTRAINT "outreach_tasks_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES public.partner_contacts(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY public.outreach_tasks
    ADD CONSTRAINT "outreach_tasks_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY public.outreach_tasks
    ADD CONSTRAINT "outreach_tasks_partnerOrganisationId_fkey" FOREIGN KEY ("partnerOrganisationId") REFERENCES public.partner_organisations(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.partner_assignment_events
    ADD CONSTRAINT "partner_assignment_events_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY public.partner_assignment_events
    ADD CONSTRAINT "partner_assignment_events_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY public.partner_assignment_events
    ADD CONSTRAINT "partner_assignment_events_partnerOrganisationId_fkey" FOREIGN KEY ("partnerOrganisationId") REFERENCES public.partner_organisations(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.partner_assignment_events
    ADD CONSTRAINT "partner_assignment_events_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY public.partner_contacts
    ADD CONSTRAINT "partner_contacts_partnerOrganisationId_fkey" FOREIGN KEY ("partnerOrganisationId") REFERENCES public.partner_organisations(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.partner_locations
    ADD CONSTRAINT "partner_locations_partnerOrganisationId_fkey" FOREIGN KEY ("partnerOrganisationId") REFERENCES public.partner_organisations(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.partner_onboarding_items
    ADD CONSTRAINT "partner_onboarding_items_assigneeUserId_fkey" FOREIGN KEY ("assigneeUserId") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY public.partner_onboarding_items
    ADD CONSTRAINT "partner_onboarding_items_partnerOrganisationId_fkey" FOREIGN KEY ("partnerOrganisationId") REFERENCES public.partner_organisations(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.partner_organisations
    ADD CONSTRAINT "partner_organisations_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY public.partner_organisations
    ADD CONSTRAINT "partner_organisations_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES public.partner_organisations(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY public.partner_organisations
    ADD CONSTRAINT "partner_organisations_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY public.partner_stage_events
    ADD CONSTRAINT "partner_stage_events_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY public.partner_stage_events
    ADD CONSTRAINT "partner_stage_events_partnerOrganisationId_fkey" FOREIGN KEY ("partnerOrganisationId") REFERENCES public.partner_organisations(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT "payments_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT "payments_beneficiaryUserId_fkey" FOREIGN KEY ("beneficiaryUserId") REFERENCES public.users(id);

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT "payments_leadPackageAssignmentId_fkey" FOREIGN KEY ("leadPackageAssignmentId") REFERENCES public.lead_package_assignments(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT "payments_leadPackageId_fkey" FOREIGN KEY ("leadPackageId") REFERENCES public.lead_packages(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY public.prospect_activities
    ADD CONSTRAINT "prospect_activities_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.prospect_activities
    ADD CONSTRAINT "prospect_activities_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES public.prospects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.prospecting_pool_members
    ADD CONSTRAINT "prospecting_pool_members_addedBy_fkey" FOREIGN KEY ("addedBy") REFERENCES public.users(id);

ALTER TABLE ONLY public.prospecting_pool_members
    ADD CONSTRAINT "prospecting_pool_members_partnerOrganisationId_fkey" FOREIGN KEY ("partnerOrganisationId") REFERENCES public.partner_organisations(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.prospecting_pool_members
    ADD CONSTRAINT "prospecting_pool_members_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES public.prospecting_pools(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.prospecting_pools
    ADD CONSTRAINT "prospecting_pools_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES public.users(id);

ALTER TABLE ONLY public.prospects
    ADD CONSTRAINT "prospects_assignedAgentId_fkey" FOREIGN KEY ("assignedAgentId") REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.prospects
    ADD CONSTRAINT "prospects_attributionId_fkey" FOREIGN KEY ("attributionId") REFERENCES public.attributions(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.prospects
    ADD CONSTRAINT "prospects_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES public.campaigns(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.prospects
    ADD CONSTRAINT "prospects_consumerId_fkey" FOREIGN KEY ("consumerId") REFERENCES public.consumers(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY public.prospects
    ADD CONSTRAINT "prospects_externalAgentId_fkey" FOREIGN KEY ("externalAgentId") REFERENCES public.external_agents(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY public.prospects
    ADD CONSTRAINT "prospects_qrTagId_fkey" FOREIGN KEY ("qrTagId") REFERENCES public.qr_tags(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.qr_scans
    ADD CONSTRAINT "qr_scans_qrTagId_fkey" FOREIGN KEY ("qrTagId") REFERENCES public.qr_tags(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.qr_tags
    ADD CONSTRAINT "qr_tags_agentGroupId_fkey" FOREIGN KEY ("agentGroupId") REFERENCES public.agent_groups(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.qr_tags
    ADD CONSTRAINT "qr_tags_assignedAgentId_fkey" FOREIGN KEY ("assignedAgentId") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY public.qr_tags
    ADD CONSTRAINT "qr_tags_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES public.campaigns(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.qr_tags
    ADD CONSTRAINT "qr_tags_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.qr_tags
    ADD CONSTRAINT "qr_tags_parentQrTagId_fkey" FOREIGN KEY ("parentQrTagId") REFERENCES public.qr_tags(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.redeem_ops_audit_events
    ADD CONSTRAINT "redeem_ops_audit_events_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY public.redemptions
    ADD CONSTRAINT "redemptions_activationId_fkey" FOREIGN KEY ("activationId") REFERENCES public.activations(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY public.redemptions
    ADD CONSTRAINT "redemptions_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY public.redemptions
    ADD CONSTRAINT "redemptions_entitlementId_fkey" FOREIGN KEY ("entitlementId") REFERENCES public.reward_entitlements(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.redemptions
    ADD CONSTRAINT "redemptions_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES public.partner_locations(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY public.redemptions
    ADD CONSTRAINT "redemptions_partnerOrganisationId_fkey" FOREIGN KEY ("partnerOrganisationId") REFERENCES public.partner_organisations(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY public.redemptions
    ADD CONSTRAINT "redemptions_rewardOfferId_fkey" FOREIGN KEY ("rewardOfferId") REFERENCES public.reward_offers(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY public.reward_entitlements
    ADD CONSTRAINT "reward_entitlements_activationId_fkey" FOREIGN KEY ("activationId") REFERENCES public.activations(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY public.reward_entitlements
    ADD CONSTRAINT "reward_entitlements_consumerId_fkey" FOREIGN KEY ("consumerId") REFERENCES public.consumers(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY public.reward_entitlements
    ADD CONSTRAINT "reward_entitlements_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES public.prospects(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY public.reward_entitlements
    ADD CONSTRAINT "reward_entitlements_rewardOfferId_fkey" FOREIGN KEY ("rewardOfferId") REFERENCES public.reward_offers(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY public.reward_entitlements
    ADD CONSTRAINT "reward_entitlements_unlockedByUserId_fkey" FOREIGN KEY ("unlockedByUserId") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY public.reward_inventory_events
    ADD CONSTRAINT "reward_inventory_events_activationId_fkey" FOREIGN KEY ("activationId") REFERENCES public.activations(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY public.reward_inventory_events
    ADD CONSTRAINT "reward_inventory_events_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY public.reward_inventory_events
    ADD CONSTRAINT "reward_inventory_events_entitlementId_fkey" FOREIGN KEY ("entitlementId") REFERENCES public.reward_entitlements(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY public.reward_inventory_events
    ADD CONSTRAINT "reward_inventory_events_redemptionId_fkey" FOREIGN KEY ("redemptionId") REFERENCES public.redemptions(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY public.reward_inventory_events
    ADD CONSTRAINT "reward_inventory_events_rewardOfferId_fkey" FOREIGN KEY ("rewardOfferId") REFERENCES public.reward_offers(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY public.reward_offer_locations
    ADD CONSTRAINT "reward_offer_locations_partnerLocationId_fkey" FOREIGN KEY ("partnerLocationId") REFERENCES public.partner_locations(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.reward_offer_locations
    ADD CONSTRAINT "reward_offer_locations_rewardOfferId_fkey" FOREIGN KEY ("rewardOfferId") REFERENCES public.reward_offers(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.reward_offers
    ADD CONSTRAINT "reward_offers_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES public.users(id);

ALTER TABLE ONLY public.reward_offers
    ADD CONSTRAINT "reward_offers_partnerOrganisationId_fkey" FOREIGN KEY ("partnerOrganisationId") REFERENCES public.partner_organisations(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY public.reward_terms_versions
    ADD CONSTRAINT "reward_terms_versions_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES public.users(id);

ALTER TABLE ONLY public.reward_terms_versions
    ADD CONSTRAINT "reward_terms_versions_rewardOfferId_fkey" FOREIGN KEY ("rewardOfferId") REFERENCES public.reward_offers(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.round_robin_cursor
    ADD CONSTRAINT "round_robin_cursor_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES public.campaigns(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.short_link_clicks
    ADD CONSTRAINT "short_link_clicks_shortLinkId_fkey" FOREIGN KEY ("shortLinkId") REFERENCES public.short_links(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.short_links
    ADD CONSTRAINT "short_links_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES public.campaigns(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.short_links
    ADD CONSTRAINT "short_links_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.suppression_propagations
    ADD CONSTRAINT "suppression_propagations_consumerId_fkey" FOREIGN KEY ("consumerId") REFERENCES public.consumers(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY public.suppression_propagations
    ADD CONSTRAINT "suppression_propagations_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES public.prospects(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.suppression_propagations
    ADD CONSTRAINT "suppression_propagations_subscriberId_fkey" FOREIGN KEY ("subscriberId") REFERENCES public.webhook_subscribers(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.wallet_ledger
    ADD CONSTRAINT "wallet_ledger_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY public.wallet_ledger
    ADD CONSTRAINT "wallet_ledger_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES public.lead_package_assignments(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY public.wallet_ledger
    ADD CONSTRAINT "wallet_ledger_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES public.campaigns(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY public.wallet_ledger
    ADD CONSTRAINT "wallet_ledger_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY public.wallet_ledger
    ADD CONSTRAINT "wallet_ledger_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES public.payments(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY public.webhook_deliveries
    ADD CONSTRAINT "webhook_deliveries_subscriberId_fkey" FOREIGN KEY ("subscriberId") REFERENCES public.webhook_subscribers(id) ON DELETE SET NULL;

--
-- RETIRED-DOMAIN TABLES (fleet era). Present in PROD with historical rows and
-- still referenced by live reads (agents roster joins commissions; campaign
-- media cleanup). The old boot leaked them across suites via helpers'
-- CREATE TABLE IF NOT EXISTS; the baseline declares them explicitly.
--
CREATE TABLE public.fleet_owners (
    id uuid PRIMARY KEY,
    full_name character varying(255),
    email character varying(255),
    phone character varying(50),
    company_name character varying(255),
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);
CREATE TABLE public.cars (
    id uuid PRIMARY KEY,
    make character varying(255),
    model character varying(255),
    year integer,
    plate_number character varying(50),
    type character varying(50),
    status character varying(50),
    fleet_owner_id uuid,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);
CREATE TABLE public.commissions (
    id uuid PRIMARY KEY,
    "agentId" uuid,
    "campaignId" uuid,
    "prospectId" uuid,
    amount numeric(10,2),
    type character varying(50),
    status character varying(50),
    description text,
    metadata jsonb,
    "earnedDate" timestamp with time zone,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);
