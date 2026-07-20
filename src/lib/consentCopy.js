/**
 * The mandatory agree-all consent block (CampaignSignupForm) — wording era
 * '2026-07-21', the version label the backend consent registry pins evidence
 * for. One required checkbox under a plain-language clause list; no agree, no
 * submit. The DNC gate is a separate consent with its own copy/version.
 *
 * clauseContact and clauseThirdParty MUST stay BYTE-IDENTICAL to their backend
 * twins (AGREE_ALL_CONTACT_COPY in backend/src/services/contactConsent.js and
 * AGREE_ALL_THIRD_PARTY_COPY in backend/src/services/externalConsent.js) — the
 * ledger stores sha256 hashes of the backend constants as evidence of what the
 * person actually saw; src/lib/__tests__/consentCopy.lockstep.test.js fails on
 * any drift. Editing ANY user-visible string here means a NEW era: bump the
 * version label AND add a new backend registry entry — never edit in place.
 */
export const CONSENT_COPY_VERSION = '2026-07-21';

export const CONSENT_COPY = Object.freeze({
  heading: 'Your agreement',
  intro:
    'This reward is free because you agree to be contactable. Submitting this form means you agree to all of the following:',
  clauseContact:
    'MKTR PTE. LTD. ("Redeem") may contact me by phone call, text message (including WhatsApp) and email, using the details I provide, about this campaign and about other Redeem offers. I can unsubscribe from marketing at any time.',
  // The terms clause interleaves the T&C-modal link, so it ships in three parts.
  clauseTermsPrefix: "I accept this campaign's ",
  clauseTermsLinkText: 'terms and conditions',
  clauseTermsSuffix: '.',
  // Rendered ONLY when campaign.design_config.thirdPartyDisclosure !== false
  // (the sponsored-campaign toggle, default ON).
  clauseThirdParty:
    'This campaign is sponsored: my contact details will be shared with a partner licensed financial-advisory representative — who may be from a third-party agency — who may contact me about relevant financial products and services.',
  checkboxLabel: 'I agree to all of the above.',
});
