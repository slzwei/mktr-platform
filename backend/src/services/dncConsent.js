/**
 * DNC (Do Not Call) consent contract — the consumer-facing half of DNC compliance.
 *
 * The backend create-path scrub (dncService/dncGate) HOLDS a lead whose number is on
 * Singapore's DNC Registry for voice (no-voice-call register) — agents may not cold-call
 * it. A person can lawfully be contacted anyway if they gave documented consent at the
 * point of opt-in. The lead-capture form's consent gate captures exactly that: when the
 * OTP-verified number is registered, the prospect must tick "I consent to be contacted"
 * before they can submit. This module turns that tick into the evidence the gate reads to
 * RELEASE the otherwise-held lead.
 *
 * Mirrors externalConsent.js deliberately: SERVER-BUILT evidence only (never trust the
 * client's consentMetadata), default-OFF (no tick => null => nothing written => the
 * registered lead stays held — the fail-safe), and a strict validator the gate calls.
 *
 * Distinct from `consent_contact` — that marketing-consent box defaults TICKED in the form
 * (CampaignSignupForm), so reusing it would silently override DNC for everyone. DNC consent
 * is its own granular, default-unticked opt-in that only ever appears for a registered
 * number, so its presence is meaningful.
 *
 * Evidence shape (consentMetadata.dnc):
 *   {
 *     consented:   true            — the affirmative tick (the gate checks === true)
 *     version:     string          — disclosure-copy version the person agreed to
 *     consentedAt: string          — ISO timestamp (parseable)
 *     channels:    string[]        — DNC channels the consent covers
 *     sourceUrl?:  string          — capture-page URL (audit breadcrumb)
 *     dncTransactionId?: string    — the PDPC check's transaction id, if known at build time
 *   }
 */

/**
 * Current DNC-consent disclosure-copy version. A label tying each recorded consent to the
 * exact wording shown on the consent gate. BUMP IT (to the date the copy changes) whenever
 * the DNC consent disclosure on the lead-capture form (DncConsentGate / CampaignSignupForm)
 * is edited.
 */
export const DNC_CONSENT_VERSION = '2026-07-17';

/**
 * DNC channels the consent covers. The PDPC register has three sub-registers
 * (no_voice_call / no_text_message / no_fax); the gate's block trigger is voice, but the
 * documented "you may contact me about this offer" consent is recorded against all three
 * so the evidence reflects the full scope the person agreed to. Frozen so a caller can't
 * mutate the shared constant.
 */
export const DNC_CONSENT_CHANNELS = Object.freeze(['voice', 'text', 'fax']);

/**
 * Pull the `consentMetadata.dnc` block from any accepted input shape (a Prospect instance,
 * a plain prospect-like object, or a bare consentMetadata object). Returns null when absent.
 */
export function extractDncConsent(prospectOrMeta) {
  if (!prospectOrMeta || typeof prospectOrMeta !== 'object') return null;

  // Already a bare consentMetadata object?
  if (prospectOrMeta.dnc && !prospectOrMeta.consentMetadata && !prospectOrMeta.sourceMetadata) {
    return prospectOrMeta.dnc;
  }

  // Sequelize instance: prefer get(), fall back to direct property.
  const meta = typeof prospectOrMeta.get === 'function'
    ? (prospectOrMeta.get('consentMetadata') ?? prospectOrMeta.consentMetadata)
    : prospectOrMeta.consentMetadata;

  if (meta && typeof meta === 'object' && meta.dnc) return meta.dnc;
  return null;
}

/**
 * @param {object|null|undefined} prospectOrMeta - a Prospect instance, plain prospect-like
 *   object, or a bare consentMetadata object.
 * @returns {boolean} true ONLY when complete, well-formed DNC consent evidence exists AND
 *   the person affirmatively consented (consented === true).
 */
export function hasValidDncConsent(prospectOrMeta) {
  const dnc = extractDncConsent(prospectOrMeta);
  if (!dnc || typeof dnc !== 'object') return false;

  // The affirmative tick is the gate. Strict === true (a stale client sending "true"/1
  // through some other path can't satisfy it; the evidence is server-built anyway).
  if (dnc.consented !== true) return false;

  const versionOk = typeof dnc.version === 'string' && dnc.version.trim().length > 0;
  const channelsOk = Array.isArray(dnc.channels) && dnc.channels.length > 0
    && dnc.channels.every((c) => typeof c === 'string' && c.trim().length > 0);

  let timestampOk = false;
  if (typeof dnc.consentedAt === 'string' && dnc.consentedAt.trim().length > 0) {
    timestampOk = !Number.isNaN(Date.parse(dnc.consentedAt));
  }

  return versionOk && channelsOk && timestampOk;
}

/**
 * Build the `consentMetadata.dnc` evidence for a lead-capture submission.
 *
 * Returns the evidence ONLY when the person affirmatively ticked the DNC consent box
 * (consented === true). For an unticked / missing / non-true box it returns null so NOTHING
 * is written — absence is the fail-safe (no evidence => the registered lead stays held). The
 * returned object is guaranteed to satisfy hasValidDncConsent().
 *
 * @param {boolean} consented - the consent_dnc flag from the form.
 * @param {{ sourceUrl?: string, at?: string, transactionId?: string }} [opts]
 *   sourceUrl: capture-page URL (audit breadcrumb); at: ISO timestamp (missing/unparseable
 *   falls back to now); transactionId: the PDPC check's id, if already known.
 * @returns {{consented:true,version:string,consentedAt:string,channels:string[],sourceUrl?:string,dncTransactionId?:string}|null}
 */
export function buildDncConsentEvidence(consented, opts = {}) {
  if (consented !== true) return null;

  // Use a caller-supplied timestamp only if it actually parses; otherwise fall back to
  // now — so the returned evidence is ALWAYS valid per hasValidDncConsent().
  const at = typeof opts.at === 'string' ? opts.at.trim() : '';
  const consentedAt = at && !Number.isNaN(Date.parse(at)) ? at : new Date().toISOString();
  const sourceUrl =
    typeof opts.sourceUrl === 'string' && opts.sourceUrl.trim().length > 0
      ? opts.sourceUrl.trim()
      : undefined;
  const dncTransactionId =
    typeof opts.transactionId === 'string' && opts.transactionId.trim().length > 0
      ? opts.transactionId.trim()
      : undefined;

  return {
    consented: true,
    version: DNC_CONSENT_VERSION,
    consentedAt,
    channels: [...DNC_CONSENT_CHANNELS],
    ...(sourceUrl ? { sourceUrl } : {}),
    ...(dncTransactionId ? { dncTransactionId } : {}),
  };
}

export default {
  DNC_CONSENT_VERSION,
  DNC_CONSENT_CHANNELS,
  extractDncConsent,
  hasValidDncConsent,
  buildDncConsentEvidence,
};
