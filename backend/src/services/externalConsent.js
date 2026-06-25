/**
 * External-disclosure consent contract (Phase 0.6).
 *
 * "Contact me" consent (prospects.consentToContact) is NOT the same as consent
 * to disclose a person's data to a THIRD-PARTY rival insurance agent. External
 * delivery (MKTR Leads) requires the stronger, explicit third-party-disclosure
 * consent, captured at lead-capture time and stored on the prospect under
 * `consentMetadata.external`.
 *
 * Because nothing writes `consentMetadata.external` yet, hasValidExternalConsent
 * returns false for all current data — so external assignment stays inert until
 * per-source consent capture is built (web/QR tickbox, Meta form question,
 * Retell verbal step). This is the fail-safe: no consent evidence => never
 * external => no competitor-PII leak.
 *
 * Evidence shape (all required):
 *   consentMetadata.external = {
 *     version:    string  — consent text version shown to the person
 *     consentedAt:string  — ISO timestamp (parseable)
 *     channels:   string[]— contact channels consented to (e.g. ['phone','whatsapp'])
 *     sourceUrl?: string  — capture URL / form id / call id (recommended, not required)
 *   }
 */

/**
 * @param {object|null|undefined} prospectOrMeta - a Prospect instance, plain
 *   prospect-like object, or a bare consentMetadata object.
 * @returns {boolean} true only when complete, well-formed external consent exists.
 */
export function hasValidExternalConsent(prospectOrMeta) {
  const ext = extractExternalConsent(prospectOrMeta);
  if (!ext || typeof ext !== 'object') return false;

  const versionOk = typeof ext.version === 'string' && ext.version.trim().length > 0;
  const channelsOk = Array.isArray(ext.channels) && ext.channels.length > 0
    && ext.channels.every((c) => typeof c === 'string' && c.trim().length > 0);

  let timestampOk = false;
  if (typeof ext.consentedAt === 'string' && ext.consentedAt.trim().length > 0) {
    const t = Date.parse(ext.consentedAt);
    timestampOk = !Number.isNaN(t);
  }

  return versionOk && channelsOk && timestampOk;
}

/**
 * Pull the `consentMetadata.external` block from any of the accepted input
 * shapes. Returns null when absent.
 */
export function extractExternalConsent(prospectOrMeta) {
  if (!prospectOrMeta || typeof prospectOrMeta !== 'object') return null;

  // Already a bare consentMetadata object?
  if (prospectOrMeta.external && !prospectOrMeta.consentMetadata && !prospectOrMeta.sourceMetadata) {
    return prospectOrMeta.external;
  }

  // Sequelize instance: prefer get(), fall back to direct property.
  const meta = typeof prospectOrMeta.get === 'function'
    ? (prospectOrMeta.get('consentMetadata') ?? prospectOrMeta.consentMetadata)
    : prospectOrMeta.consentMetadata;

  if (meta && typeof meta === 'object' && meta.external) return meta.external;
  return null;
}

/**
 * Current third-party-disclosure consent wording version. A label tying each
 * recorded consent to the exact copy the person agreed to. BUMP IT (to the date
 * the copy changes) whenever the consent_third_party checkbox wording on the
 * lead-capture form (CampaignSignupForm.jsx) is edited.
 */
export const THIRD_PARTY_CONSENT_VERSION = '2026-06-26';

/**
 * Contact channels the third-party-disclosure consent covers. Recorded on every
 * captured consent so a downstream buyer-agent knows how the person agreed to be
 * reached. Keep in sync with what the privacy policy / consent copy actually says.
 */
export const THIRD_PARTY_CONSENT_CHANNELS = Object.freeze(['phone', 'whatsapp', 'email']);

/**
 * Build the `consentMetadata.external` evidence for a lead-capture submission.
 *
 * Returns the evidence ONLY when the person affirmatively ticked the third-party
 * disclosure box (consented === true). For an unticked / missing / non-true box it
 * returns null so NOTHING is written — absence is the fail-safe (no evidence =>
 * never external => no competitor-PII leak). The returned object is guaranteed to
 * satisfy hasValidExternalConsent().
 *
 * @param {boolean} consented - the consent_third_party flag from the form.
 * @param {{ sourceUrl?: string, at?: string }} [opts] - sourceUrl: capture-page URL
 *   (audit breadcrumb); at: ISO timestamp (missing/unparseable falls back to now).
 * @returns {{version:string,consentedAt:string,channels:string[],sourceUrl?:string}|null}
 */
export function buildExternalConsentEvidence(consented, opts = {}) {
  if (consented !== true) return null;

  // Use a caller-supplied timestamp only if it actually parses; otherwise fall back to
  // now — so the returned evidence is ALWAYS valid per hasValidExternalConsent().
  const at = typeof opts.at === 'string' ? opts.at.trim() : '';
  const consentedAt = at && !Number.isNaN(Date.parse(at)) ? at : new Date().toISOString();
  const sourceUrl =
    typeof opts.sourceUrl === 'string' && opts.sourceUrl.trim().length > 0
      ? opts.sourceUrl.trim()
      : undefined;

  return {
    version: THIRD_PARTY_CONSENT_VERSION,
    consentedAt,
    channels: [...THIRD_PARTY_CONSENT_CHANNELS],
    ...(sourceUrl ? { sourceUrl } : {}),
  };
}
