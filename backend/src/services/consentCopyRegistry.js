import { CONTACT_CONSENT_VERSIONS } from './contactConsent.js';
import {
  AGREE_ALL_THIRD_PARTY_VERSION, AGREE_ALL_THIRD_PARTY_COPY, THIRD_PARTY_CONSENT_CHANNELS,
} from './externalConsent.js';
import DrawTermsVersion from '../models/DrawTermsVersion.js';

/**
 * Version label → the exact consent wording shown at capture time
 * (admin-lead-profile "Raw consent versions" click-through). One version
 * label can carry SEVERAL clauses — the agree-all block records contact and
 * third-party sharing under the same label — so the resolver returns a
 * clause LIST. Copy lives in the era registries the ledger writes from
 * (contactConsent/externalConsent); pinned draw terms live as HTML rows in
 * draw_terms_versions and are addressed by uuid instead of a label. Eras
 * whose wording was never registered (legacy third-party, DNC) resolve to
 * null → the route 404s and the UI says so honestly.
 */
export async function resolveConsentCopy(version, deps = {}) {
  const d = { DrawTermsVersion, ...deps };
  const v = String(version || '').trim();
  if (!v || v.length > 80) return null;

  const clauses = [];
  const contact = CONTACT_CONSENT_VERSIONS[v];
  if (contact) {
    clauses.push({
      kind: 'contact',
      label: 'Contact & marketing',
      format: 'text',
      copy: contact.copy,
      channels: contact.channels,
      scope: contact.scope,
    });
  }
  if (v === AGREE_ALL_THIRD_PARTY_VERSION) {
    clauses.push({
      kind: 'third_party',
      label: 'Sponsor sharing',
      format: 'text',
      copy: AGREE_ALL_THIRD_PARTY_COPY,
      channels: THIRD_PARTY_CONSENT_CHANNELS,
      scope: 'campaign',
    });
  }
  if (clauses.length) return { version: v, clauses };

  // Pinned draw terms are uuid-addressed (consentMetadata.drawTerms.termsVersionId).
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) {
    const terms = await d.DrawTermsVersion.findByPk(v).catch(() => null);
    if (terms?.content) {
      return {
        version: v,
        clauses: [{
          kind: 'draw_terms',
          label: 'Lucky draw terms (as shown at signup)',
          format: 'html',
          copy: terms.content,
          pinnedAt: terms.createdAt,
        }],
      };
    }
  }
  return null;
}
