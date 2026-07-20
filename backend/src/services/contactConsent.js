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
 *    three-checkbox surfaces. Still what MarketplaceFlow shows, so it stays
 *    the default for any capture that doesn't declare a version. Its copy
 *    constant is a paraphrase-era artifact — NOT byte-identical to the old
 *    on-screen wording — kept verbatim so the hash pinned on already-recorded
 *    events stays meaningful. Do not "fix" it; the era is closed.
 *  - '2026-07-21' AGREE-ALL (brand-wide, mandatory): the single mandatory
 *    agreement block (CampaignSignupForm). Submitting is impossible without
 *    agreeing, so `granted` is always true in this era. The copy below MUST
 *    stay BYTE-IDENTICAL to CONSENT_COPY.clauseContact in
 *    src/lib/consentCopy.js — enforced by
 *    src/lib/__tests__/consentCopy.lockstep.test.js.
 *
 * SCOPE: the '2026-07-21' wording grants contact + marketing about "other
 * Redeem offers" (brand-wide), but ledger events remain CAMPAIGN-scoped —
 * minting campaignId:null GLOBAL grants from this copy is the separate
 * "globalev" deliverable (see consentService rules). `scope` is recorded in
 * event metadata only.
 */

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

/**
 * LEGACY contact-consent wording version — the default for captures that send
 * no `consent_copy_version` (MarketplaceFlow, pre-rework cached bundles) and
 * the label `applyUnsubscribe` stamps on global revokes.
 */
export const CONTACT_CONSENT_VERSION = '2026-07-20';

/** Canonical legacy digest source — see the era note in the header. */
export const CONTACT_CONSENT_COPY =
  'I consent to being contacted (phone call, text or email) using the particulars provided, for the purposes identified in this form.';
export const CONTACT_CONSENT_COPY_HASH = sha256(CONTACT_CONSENT_COPY);

/** Channels both eras' wording covers — keep in sync with the on-screen copy. */
export const CONTACT_CONSENT_CHANNELS = Object.freeze(['phone', 'text', 'email']);

/** AGREE-ALL era (mandatory single-block consent, CampaignSignupForm). */
export const AGREE_ALL_CONSENT_VERSION = '2026-07-21';
export const AGREE_ALL_CONTACT_COPY =
  'MKTR PTE. LTD. ("Redeem") may contact me by phone call, text message (including WhatsApp) and email, using the details I provide, about this campaign and about other Redeem offers. I can unsubscribe from marketing at any time.';

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
    channels: CONTACT_CONSENT_CHANNELS,
    scope: 'brand',
  }),
});

/** True only for version labels the registry can turn into pinned evidence. */
export function isKnownConsentCopyVersion(version) {
  return typeof version === 'string'
    && Object.prototype.hasOwnProperty.call(CONTACT_CONSENT_VERSIONS, version);
}
