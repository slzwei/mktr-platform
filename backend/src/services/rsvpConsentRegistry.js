import { createHash } from 'crypto';

/**
 * RSVP consent eras (docs/plans/rsvp-pages.md §8.1) — the same shape as
 * contactConsent.js's registry, kept separate because the GRANT is different:
 * event-operational contact only (confirmation, changes, cancellation), never
 * marketing. Nothing here feeds the consumer consent ledger.
 *
 * The copy is a TEMPLATE: `{organiser}` is the event's organiserName, which is
 * frozen at publish so the rendered sentence a person saw is reconstructable
 * from (version, organiserName). The hash pins the template bytes.
 *
 * The public GET returns the rendered copy; the client renders THAT, and the
 * submit path stamps the server-resolved era — client-supplied evidence is
 * ignored, so a cached bundle can never show old wording against a new hash.
 *
 * Wording changes mint a NEW version. A closed era's template is never edited.
 */

const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

export const ORGANISER_PLACEHOLDER = '{organiser}';
const ORGANISER_FALLBACK = 'the event organiser';

export const RSVP_CONSENT_VERSION_V1 = '2026-09-03-rsvp-v1';
export const RSVP_CONSENT_TEMPLATE_V1 =
  'I agree that MKTR PTE. LTD. (UEN 202507548M), the company behind Redeem, may collect the details in this form and share them with {organiser}, the organiser of this event, so that either of us can contact me about this event — my confirmation, any changes, or a cancellation. My details are used for this event only and not for marketing. The Redeem Personal Data Policy explains how to access, correct or delete them.';

/** version label → immutable evidence for that era. Adding wording = new entry. */
export const RSVP_CONSENT_VERSIONS = Object.freeze({
  [RSVP_CONSENT_VERSION_V1]: Object.freeze({
    template: RSVP_CONSENT_TEMPLATE_V1,
    templateHash: sha256(RSVP_CONSENT_TEMPLATE_V1),
    scope: 'event',
  }),
});

export const CURRENT_RSVP_CONSENT_VERSION = RSVP_CONSENT_VERSION_V1;

export function isKnownRsvpConsentVersion(version) {
  return typeof version === 'string'
    && Object.prototype.hasOwnProperty.call(RSVP_CONSENT_VERSIONS, version);
}

/** The era entry, or null for a label the registry cannot turn into evidence. */
export function resolveRsvpConsent(version) {
  return isKnownRsvpConsentVersion(version) ? RSVP_CONSENT_VERSIONS[version] : null;
}

/** The sentence a person sees for (version, organiserName); '' for an unknown era. */
export function renderRsvpConsentCopy(version, organiserName) {
  const era = resolveRsvpConsent(version);
  if (!era) return '';
  const name = typeof organiserName === 'string' && organiserName.trim() ? organiserName.trim() : ORGANISER_FALLBACK;
  return era.template.split(ORGANISER_PLACEHOLDER).join(name);
}
