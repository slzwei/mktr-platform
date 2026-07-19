import { createHash } from 'crypto';

/**
 * Marketing-contact consent contract (PR B, plan §3.1) — the evidence-grade
 * upgrade of the bare `sourceMetadata.consent_contact` boolean, mirroring
 * externalConsent.js / dncConsent.js.
 *
 * The checkbox is DEFAULT-TICKED (opt-out model) on both capture surfaces, so
 * an untick is an explicit act — the ledger records granted:false too.
 *
 * PURPOSE SCOPE: the live copy grants contact "for the purposes identified in
 * this form" (CampaignSignupForm) / "about this redemption" (MarketplaceFlow)
 * — i.e. CAMPAIGN-scoped. This version label + copy hash pin exactly what was
 * agreed; a future GLOBAL opt-in ("keep me posted about new offers") must use
 * a NEW version and campaignId:null events, never a reinterpretation of these.
 */

/**
 * Current contact-consent wording version. BUMP (to the date the copy
 * changes) whenever the consent_contact checkbox wording on either capture
 * surface is edited (CampaignSignupForm.jsx / MarketplaceFlow.jsx).
 */
export const CONTACT_CONSENT_VERSION = '2026-07-20';

/**
 * Canonical digest of the consent copy in force for CONTACT_CONSENT_VERSION.
 * Snapshot of the LeadCapture wording (the marketplace variant is narrower);
 * stored in event metadata so evidence survives future copy edits verbatim.
 */
export const CONTACT_CONSENT_COPY =
  'I consent to being contacted (phone call, text or email) using the particulars provided, for the purposes identified in this form.';
export const CONTACT_CONSENT_COPY_HASH = createHash('sha256')
  .update(CONTACT_CONSENT_COPY)
  .digest('hex');

/** Channels the ticked box covers — keep in sync with the checkbox copy. */
export const CONTACT_CONSENT_CHANNELS = Object.freeze(['phone', 'text', 'email']);
