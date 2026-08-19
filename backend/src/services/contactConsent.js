import { createHash } from 'crypto';

/**
 * Marketing-contact consent contract (PR B, plan §3.1) — the evidence-grade
 * upgrade of the bare `sourceMetadata.consent_contact` boolean, mirroring
 * externalConsent.js / dncConsent.js.
 *
 * TWO wording eras coexist, selected per capture by the payload's
 * `consent_copy_version` (absent => legacy):
 *
 *  - '2026-07-20' LEGACY (campaign-scoped, default-ticked opt-out): the old
 *    three-checkbox surfaces. The default for any capture that doesn't
 *    declare a version — after the 2026-07-21 rework that means pre-rework
 *    cached bundles only (both funnels now send the agree-all label). Its
 *    copy constant is a paraphrase-era artifact — NOT byte-identical to the
 *    old on-screen wording — kept verbatim so the hash pinned on already-
 *    recorded events stays meaningful. Do not "fix" it; the era is closed.
 *  - '2026-07-21-agree-all-v1' AGREE-ALL (brand-wide, mandatory): the single
 *    mandatory agreement block on BOTH funnels (CampaignSignupForm +
 *    MarketplaceFlow), §9.4 FINAL copy. Submitting is impossible without
 *    agreeing, so `granted` is always true in this era. The copy below MUST
 *    stay BYTE-IDENTICAL to the clause in src/lib/consentCopy.js
 *    (`${clauseContactHeadline} ${clauseContactBody}`) — enforced by
 *    src/lib/__tests__/consentCopy.lockstep.test.js.
 *
 * SCOPE: the agree-all wording grants contact + marketing about "other
 * Redeem offers, rewards and lucky draws" (brand-wide), and since "globalev"
 * a brand-scope era MINTS that grant explicitly: capture writes the
 * campaign-scoped contact row PLUS a campaignId:null GLOBAL twin (see
 * consentService.recordCaptureConsentEventsTx; backfillGlobalGrants heals
 * the pre-globalev window). `scope` in event metadata mirrors the era —
 * 'brand' eras are the only ones that ever mint global grants.
 */

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

/**
 * LEGACY contact-consent wording version — the default for captures that send
 * no `consent_copy_version` (pre-rework cached bundles; both funnels send the
 * agree-all label since #213/#214) and the label `applyUnsubscribe` stamps on
 * global revokes.
 */
export const CONTACT_CONSENT_VERSION = '2026-07-20';

/** Canonical legacy digest source — see the era note in the header. */
export const CONTACT_CONSENT_COPY =
  'I consent to being contacted (phone call, text or email) using the particulars provided, for the purposes identified in this form.';
export const CONTACT_CONSENT_COPY_HASH = sha256(CONTACT_CONSENT_COPY);

/** Channels both eras' wording covers — keep in sync with the on-screen copy. */
export const CONTACT_CONSENT_CHANNELS = Object.freeze(['phone', 'text', 'email']);

/** AGREE-ALL era (mandatory single-block consent, both funnels — §9.4 FINAL). */
export const AGREE_ALL_CONSENT_VERSION = '2026-07-21-agree-all-v1';
export const AGREE_ALL_CONTACT_COPY =
  "Contact from Redeem — this offer and future ones. MKTR Pte. Ltd. (the company behind Redeem) may contact you by phone call, text message (SMS or WhatsApp) or email about your signup and reward, and about other Redeem offers, rewards and lucky draws. You can opt out anytime — every marketing email includes an unsubscribe link, or contact us using the details in our Personal Data Policy. Opting out later won't affect a reward you've already claimed.";

/** Channels the agree-all wording covers — includes WhatsApp, per the copy. */
export const AGREE_ALL_CONSENT_CHANNELS = Object.freeze(['phone', 'text', 'whatsapp', 'email']);

/**
 * AGREE-ALL v2 era (2026-08-19): wording identical to v1 except the legal
 * entity casing — "MKTR Pte. Ltd." → "MKTR PTE. LTD." (ACRA style, matching
 * the campaign T&Cs and the Prudential introducer clause). v1 is CLOSED —
 * its bytes stay untouched so recorded evidence keeps meaning.
 */
export const AGREE_ALL_CONSENT_VERSION_V2 = '2026-08-19-agree-all-v2';
export const AGREE_ALL_CONTACT_COPY_V2 =
  "Contact from Redeem — this offer and future ones. MKTR PTE. LTD. (the company behind Redeem) may contact you by phone call, text message (SMS or WhatsApp) or email about your signup and reward, and about other Redeem offers, rewards and lucky draws. You can opt out anytime — every marketing email includes an unsubscribe link, or contact us using the details in our Personal Data Policy. Opting out later won't affect a reward you've already claimed.";

/**
 * META LEAD ADS era (native instant forms — docs/plans/meta-lead-ads-native-pipe.md §5).
 * This copy is the EXACT custom-disclaimer checkbox text operators must put on
 * every Meta instant form (checkbox key `mktr_pdpa_consent`). Editing the
 * wording = a NEW version entry; this era then closes, like the ones above.
 * Campaign-scoped on purpose: the person consented about ONE offer inside a
 * form — never a brand-wide marketing licence.
 */
export const META_LEADGEN_CONSENT_VERSION = '2026-08-06-meta-leadgen-v1';
export const META_LEADGEN_CONTACT_COPY =
  'I consent to MKTR Pte. Ltd. (Redeem) contacting me by phone call, text message (SMS or WhatsApp) or email about this offer and my sign-up, using the details provided in this form. I can opt out at any time — see the Redeem Personal Data Policy for details.';
export const META_LEADGEN_CONSENT_CHANNELS = Object.freeze(['phone', 'text', 'whatsapp', 'email']);

/**
 * The registry the ledger writes from: version label -> the exact evidence
 * (copy, hash, channels, scope) in force for that era. Adding a wording era =
 * new entry + new version string; never edit a closed era's copy.
 */
export const CONTACT_CONSENT_VERSIONS = Object.freeze({
  [CONTACT_CONSENT_VERSION]: Object.freeze({
    copy: CONTACT_CONSENT_COPY,
    copyHash: CONTACT_CONSENT_COPY_HASH,
    channels: CONTACT_CONSENT_CHANNELS,
    scope: 'campaign',
  }),
  [AGREE_ALL_CONSENT_VERSION]: Object.freeze({
    copy: AGREE_ALL_CONTACT_COPY,
    copyHash: sha256(AGREE_ALL_CONTACT_COPY),
    channels: AGREE_ALL_CONSENT_CHANNELS,
    scope: 'brand',
  }),
  [AGREE_ALL_CONSENT_VERSION_V2]: Object.freeze({
    copy: AGREE_ALL_CONTACT_COPY_V2,
    copyHash: sha256(AGREE_ALL_CONTACT_COPY_V2),
    channels: AGREE_ALL_CONSENT_CHANNELS,
    scope: 'brand',
  }),
  [META_LEADGEN_CONSENT_VERSION]: Object.freeze({
    copy: META_LEADGEN_CONTACT_COPY,
    copyHash: sha256(META_LEADGEN_CONTACT_COPY),
    channels: META_LEADGEN_CONSENT_CHANNELS,
    scope: 'campaign',
  }),
});

/** True only for version labels the registry can turn into pinned evidence. */
export function isKnownConsentCopyVersion(version) {
  return typeof version === 'string'
    && Object.prototype.hasOwnProperty.call(CONTACT_CONSENT_VERSIONS, version);
}

/**
 * Resolve one phone's grant-map entry for a campaign scope (3sites migration).
 * `scopes` is one value of consentService.getMarketableGrantMap():
 *   '*'    → latest GLOBAL contact event is granted && verified
 *   <uuid> → latest contact event in scope {that campaign, global} is
 *            granted && verified (cross-scope recency folded in by the builder)
 * Missing map / missing entry → false — FAIL CLOSED. Kept here (dependency-
 * free) so model-mocked test suites can import it without dragging Sequelize.
 */
export function contactGrantAllows(scopes, campaignId) {
  if (!(scopes instanceof Map)) return false;
  if (campaignId && scopes.has(campaignId)) return scopes.get(campaignId) === true;
  return scopes.get('*') === true;
}
