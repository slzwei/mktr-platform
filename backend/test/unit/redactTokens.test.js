import '../setup.js';
import { maskTokenUrl, maskEmail } from '../../src/utils/redactTokens.js';

const SECRET = 'sk_live_deadbeefcafebabe1234';

// Every URL-credential route shape in the app. Adding a route that
// authenticates via a URL secret? It MUST get a row here (and in
// TOKEN_PATH_RE — backend + the frontend twin in src/lib/sentryScrub.js),
// otherwise the secret lands verbatim in pino logs and Sentry.
const CREDENTIAL_SHAPES = [
  ['reward-claim API', `/api/reward-claim/${SECRET}`, '/api/reward-claim/[token]'],
  ['consumer reward link', `/r/${SECRET}`, '/r/[token]'],
  ['screening callback', `/api/screening-callback/${SECRET}`, '/api/screening-callback/[token]'],
  ['discovery webhook secret', `/api/redeem-ops/discovery/webhook/${SECRET}`, '/api/redeem-ops/discovery/webhook/[token]'],
  ['verify-email token', `/api/auth/verify-email/${SECRET}`, '/api/auth/verify-email/[token]'],
  ['reset-password token', `/api/auth/reset-password/${SECRET}`, '/api/auth/reset-password/[token]'],
  ['invite-info token', `/api/auth/invite-info/${SECRET}`, '/api/auth/invite-info/[token]'],
  ['provisioning poll code', `/api/provision/check/${SECRET}`, '/api/provision/check/[token]'],
  ['screening link query (?t=)', `/callback?t=${SECRET}`, '/callback?t=[token]'],
];

const PATH_SHAPES = CREDENTIAL_SHAPES.filter(([label]) => !label.includes('?t='));

describe('maskTokenUrl', () => {
  it.each(CREDENTIAL_SHAPES)('masks %s', (_label, input, expected) => {
    expect(maskTokenUrl(input)).toBe(expected);
  });

  it.each(PATH_SHAPES)('masks %s on an absolute URL and keeps the query string', (_label, input, expected) => {
    expect(maskTokenUrl(`https://api.mktr.sg${input}?next=1`)).toBe(`https://api.mktr.sg${expected}?next=1`);
  });

  it('masks a URL embedded in free text (Sentry breadcrumb messages)', () => {
    expect(maskTokenUrl(`GET https://api.mktr.sg/api/screening-callback/${SECRET} failed after 3 tries`)).toBe(
      'GET https://api.mktr.sg/api/screening-callback/[token] failed after 3 tries'
    );
  });

  it('masks the &t= form and repeated occurrences', () => {
    expect(maskTokenUrl(`/callback?lang=en&t=${SECRET}`)).toBe('/callback?lang=en&t=[token]');
    expect(maskTokenUrl(`/r/${SECRET} then /r/${SECRET}`)).toBe('/r/[token] then /r/[token]');
  });

  it.each([
    ['/api/campaigns/abc123'],
    ['/t/summer-promo'], // QR shortlink — slug is public, not a credential
    ['/api/auth/login'],
    ['/api/redeem-ops/discovery/runs/xyz'],
    ['/uploads/list/images'],
  ])('leaves non-credential URL %s untouched', (url) => {
    expect(maskTokenUrl(url)).toBe(url);
  });

  it('passes through non-strings and empty strings', () => {
    expect(maskTokenUrl('')).toBe('');
    expect(maskTokenUrl(null)).toBe(null);
    expect(maskTokenUrl(undefined)).toBe(undefined);
    expect(maskTokenUrl(42)).toBe(42);
  });
});

describe('maskEmail', () => {
  it('keeps first char and domain only', () => {
    expect(maskEmail('shawn@gmail.com')).toBe('s•••@gmail.com');
  });

  it('handles junk input', () => {
    expect(maskEmail('')).toBe('');
    expect(maskEmail('no-at-sign')).toBe('•••');
  });
});
