import { createHash } from 'crypto';
import {
  RSVP_CONSENT_VERSIONS, RSVP_CONSENT_VERSION_V1, RSVP_CONSENT_TEMPLATE_V1,
  RSVP_CONSENT_VERSION_V2, RSVP_CONSENT_TEMPLATE_V2,
  CURRENT_RSVP_CONSENT_VERSION, ORGANISER_PLACEHOLDER,
  isKnownRsvpConsentVersion, resolveRsvpConsent, renderRsvpConsentCopy, hashConsentCopy,
} from '../../src/services/rsvpConsentRegistry.js';

const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

describe('rsvpConsentRegistry', () => {
  test('the current era (v2) resolves to pinned template bytes; v1 stays closed and intact', () => {
    expect(CURRENT_RSVP_CONSENT_VERSION).toBe(RSVP_CONSENT_VERSION_V2);
    const era = resolveRsvpConsent(CURRENT_RSVP_CONSENT_VERSION);
    expect(era.template).toBe(RSVP_CONSENT_TEMPLATE_V2);
    expect(era.templateHash).toBe(sha256(RSVP_CONSENT_TEMPLATE_V2));
    expect(era.scope).toBe('event-and-future');
    expect(resolveRsvpConsent(RSVP_CONSENT_VERSION_V1).template).toBe(RSVP_CONSENT_TEMPLATE_V1);
    expect(RSVP_CONSENT_TEMPLATE_V1).toContain('not for marketing'); // frozen history
    expect(isKnownRsvpConsentVersion(CURRENT_RSVP_CONSENT_VERSION)).toBe(true);
  });

  test('v2 names the controller and organiser, covers future contact, offers an opt-out, and never says "not for marketing"', () => {
    expect(RSVP_CONSENT_TEMPLATE_V2).toContain('MKTR PTE. LTD. (UEN 202507548M)');
    expect(RSVP_CONSENT_TEMPLATE_V2).toContain(ORGANISER_PLACEHOLDER);
    expect(RSVP_CONSENT_TEMPLATE_V2).toContain('future events and offers');
    expect(RSVP_CONSENT_TEMPLATE_V2).toContain('opt out');
    expect(RSVP_CONSENT_TEMPLATE_V2).not.toContain('not for marketing');
  });

  test('render substitutes the organiser, falls back when blank, and honours a custom template', () => {
    const copy = renderRsvpConsentCopy(CURRENT_RSVP_CONSENT_VERSION, '  Acme Pte Ltd ');
    expect(copy).toContain('share them with Acme Pte Ltd, the organiser');
    expect(copy).not.toContain(ORGANISER_PLACEHOLDER);
    expect(renderRsvpConsentCopy(CURRENT_RSVP_CONSENT_VERSION, '')).toContain('the event organiser, the organiser');
    expect(renderRsvpConsentCopy(CURRENT_RSVP_CONSENT_VERSION, 'Acme', ' {organiser} may email me about the next one. ')).toBe('Acme may email me about the next one.');
    expect(renderRsvpConsentCopy('nope', 'Acme', 'Custom text')).toBe('Custom text');
    expect(hashConsentCopy('Custom text')).toBe(sha256('Custom text'));
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
