import { createHash } from 'crypto';
import {
  RSVP_CONSENT_VERSIONS, RSVP_CONSENT_VERSION_V1, RSVP_CONSENT_TEMPLATE_V1,
  CURRENT_RSVP_CONSENT_VERSION, ORGANISER_PLACEHOLDER,
  isKnownRsvpConsentVersion, resolveRsvpConsent, renderRsvpConsentCopy,
} from '../../src/services/rsvpConsentRegistry.js';

const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

describe('rsvpConsentRegistry', () => {
  test('the current era resolves to pinned template bytes', () => {
    expect(CURRENT_RSVP_CONSENT_VERSION).toBe(RSVP_CONSENT_VERSION_V1);
    const era = resolveRsvpConsent(CURRENT_RSVP_CONSENT_VERSION);
    expect(era.template).toBe(RSVP_CONSENT_TEMPLATE_V1);
    expect(era.templateHash).toBe(sha256(RSVP_CONSENT_TEMPLATE_V1));
    expect(era.scope).toBe('event');
    expect(isKnownRsvpConsentVersion(CURRENT_RSVP_CONSENT_VERSION)).toBe(true);
  });

  test('the wording names the controller, the organiser, and rules out marketing', () => {
    expect(RSVP_CONSENT_TEMPLATE_V1).toContain('MKTR PTE. LTD. (UEN 202507548M)');
    expect(RSVP_CONSENT_TEMPLATE_V1).toContain(ORGANISER_PLACEHOLDER);
    expect(RSVP_CONSENT_TEMPLATE_V1).toContain('not for marketing');
  });

  test('render substitutes the organiser and falls back when it is blank', () => {
    const copy = renderRsvpConsentCopy(CURRENT_RSVP_CONSENT_VERSION, '  Acme Pte Ltd ');
    expect(copy).toContain('share them with Acme Pte Ltd, the organiser');
    expect(copy).not.toContain(ORGANISER_PLACEHOLDER);
    expect(renderRsvpConsentCopy(CURRENT_RSVP_CONSENT_VERSION, '')).toContain('the event organiser, the organiser');
  });

  test('unknown eras resolve to nothing', () => {
    expect(isKnownRsvpConsentVersion('2030-01-01-rsvp-v9')).toBe(false);
    expect(isKnownRsvpConsentVersion(undefined)).toBe(false);
    expect(resolveRsvpConsent('nope')).toBeNull();
    expect(renderRsvpConsentCopy('nope', 'Acme')).toBe('');
  });

  test('the registry is immutable', () => {
    expect(() => { RSVP_CONSENT_VERSIONS.x = 1; }).toThrow();
    expect(() => { RSVP_CONSENT_VERSIONS[RSVP_CONSENT_VERSION_V1].template = 'edited'; }).toThrow();
  });
});
