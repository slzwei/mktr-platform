/**
 * The mandatory agree-all consent block (both funnels: CampaignSignupForm +
 * MarketplaceFlow) — wording era '2026-07-21-agree-all-v1', the version label
 * the backend consent registry pins evidence for. One required checkbox under
 * a headline+body clause list (§9.4 FINAL copy, docs/plans/
 * consent-agree-all-copy-2026-07-21.md); no agree, no submit. The DNC gate is
 * a separate consent with its own copy/version.
 *
 * The contact and third-party clauses MUST stay BYTE-IDENTICAL to their
 * backend twins (AGREE_ALL_CONTACT_COPY in backend/src/services/
 * contactConsent.js and AGREE_ALL_THIRD_PARTY_COPY in backend/src/services/
 * externalConsent.js, each `${headline} ${body}`) — the ledger stores sha256
 * hashes of the backend constants as evidence of what the person actually
 * saw; src/lib/__tests__/consentCopy.lockstep.test.js fails on any drift.
 * Editing ANY user-visible string here means a NEW era: bump the version
 * label AND add a new backend registry entry — never edit in place.
 */
export const CONSENT_COPY_VERSION = '2026-07-21-agree-all-v1';

export const CONSENT_COPY = Object.freeze({
  heading: 'One agreement — read once',
  intro: "By submitting this form, you agree to the following. It's short, and it's everything:",
  clauseContactHeadline: 'Contact from Redeem — this offer and future ones.',
  clauseContactBody:
    "MKTR Pte. Ltd. (the company behind Redeem) may contact you by phone call, text message (SMS or WhatsApp) or email about your signup and reward, and about other Redeem offers, rewards and lucky draws. You can opt out anytime — every marketing email includes an unsubscribe link, or contact us using the details in our Personal Data Policy. Opting out later won't affect a reward you've already claimed.",
  // The terms clause body interleaves the T&C-modal link, so it ships in parts.
  clauseTermsHeadline: "This campaign's terms.",
  clauseTermsPrefix: "You agree to the campaign's ",
  clauseTermsLinkText: 'terms & conditions',
  clauseTermsSuffix: '.',
  // Rendered ONLY on sponsored campaigns (isSponsoredCampaign — a NAMED
  // sponsor is required, §9.5-1) and not killed by the thirdPartyDisclosure
  // toggle. "(named on this page)" is a promise: sponsorNameLine must render
  // whenever this clause does.
  clauseThirdPartyHeadline: "Sharing with this campaign's sponsor.",
  clauseThirdPartyBody:
    'This campaign is sponsored: your name, contact details and form responses will be shared with the sponsoring licensed financial advisory representative (named on this page), who may contact you about your reward and relevant financial products and services.',
  checkboxLabel: 'I agree to all of the above.',
});

/** Blocked-submit helper (chrome, not hashed) — shared by both funnels. */
export const CONSENT_BLOCK_HELPER = "You'll need to agree to the above to submit.";

/**
 * Sponsored predicate — the disclosure clause renders iff design_config has a
 * sponsor object WITH A NON-EMPTY NAME (§9.5-1: the clause says the sponsor
 * is "(named on this page)", so a name-less sponsor object falls back to the
 * base block) AND the thirdPartyDisclosure kill-switch isn't off. Fail-closed
 * end to end: clause not shown => consent_third_party:false => no external
 * evidence => the lead can never be disclosed externally.
 */
export function isSponsoredCampaign(designConfig) {
  const s = designConfig?.sponsor;
  return (
    !!s && typeof s === 'object' && !Array.isArray(s)
    && typeof s.name === 'string' && s.name.trim().length > 0
    && designConfig.thirdPartyDisclosure !== false
  );
}

/** The mandatory adjacent named-sponsor line for sponsored campaigns. */
export function sponsorNameLine(designConfig) {
  if (!isSponsoredCampaign(designConfig)) return null;
  const s = designConfig.sponsor;
  return typeof s.disclosure === 'string' && s.disclosure.trim()
    ? s.disclosure.trim()
    : `Sponsored by ${s.name.trim()}.`;
}
