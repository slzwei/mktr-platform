/**
 * Shared normalizeProspect utility.
 *
 * Normalizes a backend prospect record into the flat UI shape expected by
 * tables, detail panels, and shared components. Merges field mappings from
 * AdminProspects, MyProspects and AdminAgentDetail so every consumer gets a
 * consistent object.
 */

const META_UTM_SOURCES = new Set(["facebook", "fb", "instagram", "ig", "meta"]);
const TIKTOK_UTM_SOURCES = new Set(["tiktok", "tt", "tiktokads", "tiktok_ads", "tiktok-ads"]);

// Ad-platform display labels: badge text (uppercase) vs prose name (title case).
// An unknown-but-present utm_source surfaces raw (uppercased for the badge).
const AD_PLATFORM_BADGE = { meta: "META", tiktok: "TIKTOK" };
const AD_PLATFORM_NAME = { meta: "Meta", tiktok: "TikTok" };

function adPlatformFor(utmSource) {
 if (META_UTM_SOURCES.has(utmSource)) return "meta";
 if (TIKTOK_UTM_SOURCES.has(utmSource)) return "tiktok";
 return utmSource;
}

function adPlatformBadge(platform) {
 return AD_PLATFORM_BADGE[platform] || String(platform || "").toUpperCase();
}

function adPlatformName(platform) {
 return AD_PLATFORM_NAME[platform] || String(platform || "").toUpperCase();
}

/**
 * Derive ad attribution from Prospect.sourceMetadata (stashed by the backend
 * at create time — see prospectService.createProspect).
 *
 * tier "ad"    — UTM evidence. UTMs only exist on our paid-ad URLs, so a known
 *                utm_source pins the platform (META_UTM_SOURCES → meta,
 *                TIKTOK_UTM_SOURCES → tiktok; anything else surfaces raw);
 *                campaign/adset/ad come from utm_campaign/utm_term/utm_content.
 * tier "click" — click-id fingerprint only: Meta `fbc`/fbclid, or TikTok
 *                `ttclid`. Organic clicks carry these too, so this is "came via
 *                {platform}", not a paid ad. Meta is checked first.
 * Never uses fbp/_ttp: those are minted for every tracked visitor, not just ad
 * clickers, so they are not attribution evidence.
 */
export function deriveAd(sourceMetadata) {
 const meta = sourceMetadata || {};
 const utm = meta.utm || {};
 const utmSource = String(utm.utm_source || "").toLowerCase();
 if (utmSource) {
 return {
 platform: adPlatformFor(utmSource),
 tier: "ad",
 campaign: utm.utm_campaign || "",
 adset: utm.utm_term || "",
 adName: utm.utm_content || "",
 utmSource: utm.utm_source,
 };
 }
 if (meta.fbc || /[?&]fbclid=/.test(meta.eventSourceUrl || "")) {
 return { platform: "meta", tier: "click", campaign: "", adset: "", adName: "", utmSource: "" };
 }
 if (meta.ttclid || /[?&]ttclid=/.test(meta.eventSourceUrl || "")) {
 return { platform: "tiktok", tier: "click", campaign: "", adset: "", adName: "", utmSource: "" };
 }
 return null;
}

/** Referral identity stashed by the backend (sourceMetadata.referral). */
export function deriveReferral(sourceMetadata) {
 const referral = sourceMetadata && sourceMetadata.referral;
 if (!referral || typeof referral !== "object") return null;
 return {
 ref: referral.ref || "",
 referrerProspectId: referral.referrerProspectId || null,
 referrerName: referral.referrerName || "",
 sameCampaign: referral.sameCampaign,
 };
}

/**
 * One display contract for the Source column / labels across AdminProspects,
 * MyProspects, AdminAgentDetail and ProspectDetails:
 *   label       — badge text (META AD / META CLICK / FORM / QR / REFERRAL / …)
 *   detail      — short second line (ad campaign name, referrer name)
 *   tooltip     — hover / inline-expansion text with the full story
 *   attribution — CSV/PDF export string ("" when there's nothing beyond label)
 *
 * Accepts a normalized prospect (preferred — has .ad/.referral precomputed)
 * or a raw backend record (derives from .sourceMetadata on the fly).
 * Referral wins over ad-derived labels: leadSource='referral' is explicit,
 * while a same-tab stale UTM/fbc capture is circumstantial.
 */
export function sourceDisplay(p) {
 const ad = p?.ad !== undefined ? p.ad : deriveAd(p?.sourceMetadata);
 const referral = p?.referral !== undefined ? p.referral : deriveReferral(p?.sourceMetadata);
 const source = String(p?.source || p?.leadSource || "other").toLowerCase();

 if (source === "referral") {
 const name = referral?.referrerName || "";
 return {
 label: "REFERRAL",
 detail: name,
 tooltip: name ? `Referred by ${name}` : "Referrer unknown (shared before referral tracking)",
 attribution: name ? `Referred by ${name}` : "",
 };
 }

 if (ad && ad.platform) {
 const badge = adPlatformBadge(ad.platform);
 const name = adPlatformName(ad.platform);
 if (ad.tier === "ad") {
 const parts = [
 ad.campaign ? `Campaign: ${ad.campaign}` : "",
 ad.adset ? `Ad set: ${ad.adset}` : "",
 ad.adName ? `Ad: ${ad.adName}` : "",
 ].filter(Boolean);
 return {
 label: `${badge} AD`,
 detail: ad.campaign,
 tooltip: parts.join(" · ") || `${name} ad (no campaign name in UTMs)`,
 attribution: ad.campaign ? `${name} ad: ${ad.campaign}` : `${name} ad`,
 };
 }
 const clickChannel = ad.platform === "meta" ? "Meta (Facebook/Instagram)" : name;
 return {
 label: `${badge} CLICK`,
 detail: "",
 tooltip: `Came via a ${clickChannel} click — no ad UTM data`,
 attribution: `${name} click`,
 };
 }

 return { label: source.replace(/_/g, " ").toUpperCase(), detail: "", tooltip: "", attribution: "" };
}

/** Single-line variant for compact surfaces (MyProspects, mobile cards). */
export function sourceLine(p) {
 const d = sourceDisplay(p);
 return d.detail ? `${d.label} · ${d.detail}` : d.label;
}

export default function normalizeProspect(p) {
 const name = [p.firstName, p.lastName].filter(Boolean).join(" ") || p.name ||"";
 let status = (p.leadStatus || p.status ||"new").toLowerCase();

 const createdDate = p.createdAt || p.created_date || new Date().toISOString();

 // Map leadSource to simplified UI values used in filters / display
 const source = (p.leadSource || p.source ||"other").toLowerCase();
 let simplifiedSource ="other";
 if (source ==="qr_code") simplifiedSource ="qr";
 else if (source ==="website") simplifiedSource ="form";
 else if (source ==="call_bot") simplifiedSource ="call bot";
 else if (source) simplifiedSource = source;

 const assignedAgentId = p.assignedAgentId || p.assigned_agent_id ||"";
 const assignedAgentName = p.assignedAgent
 ? ([p.assignedAgent.firstName, p.assignedAgent.lastName].filter(Boolean).join(" ") || p.assignedAgent.email ||"Agent")
 : (p.assigned_agent_name ||"");

 return {
 id: p.id,
 firstName: p.firstName,
 lastName: p.lastName,
 name,
 phone: p.phone ||"",
 email: p.email ||"",
 company: p.company ||"",
 postal_code: p.location?.zipCode || p.postal_code ||"",
 date_of_birth: p.dateOfBirth || p.date_of_birth || p.demographics?.dateOfBirth || null,
 status,
 leadStatus: status,
 created_date: createdDate,
 createdAt: createdDate,
 source: simplifiedSource,
 leadSource: p.leadSource || simplifiedSource,
 assigned_agent_id: assignedAgentId,
 assigned_agent_name: assignedAgentName,
 assignedAgentId: p.assignedAgentId,
 campaign_id: p.campaignId || p.campaign_id ||"",
 campaign: p.campaign,
 notes: p.notes,
 // Attribution: raw stash + derived ad/referral identity (see sourceDisplay)
 sourceMetadata: p.sourceMetadata || null,
 ad: deriveAd(p.sourceMetadata),
 referral: deriveReferral(p.sourceMetadata),
 // Admin-only cross-campaign repeat-signup flag (backend omits both for
 // non-admins; null → no badge / no section).
 repeatSignupCount: p.repeatSignupCount ?? null,
 repeatSignup: p.repeatSignup || null,
 };
}
