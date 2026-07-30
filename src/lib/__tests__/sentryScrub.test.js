import { describe, it, expect } from 'vitest';
import { maskTokenUrl, scrubObject, scrubEvent, scrubBreadcrumb } from '../sentryScrub';

describe('scrubObject()', () => {
 it('redacts top-level PII keys (case-insensitive substring match)', () => {
 const out = scrubObject({
 agentPhone: '+6591234567',
 lead_email: 'a@b.com',
 staff_full_name: 'Jane Doe',
 nric: 'S1234567A',
 access_token: 'abc',
 jwt: 'xyz',
 homeAddress: '123 Main',
 otpCode: '999999',
 password_hash: 'pw',
 keep: 'me',
 });
 expect(out.agentPhone).toBe('[redacted]');
 expect(out.lead_email).toBe('[redacted]');
 expect(out.staff_full_name).toBe('[redacted]');
 expect(out.nric).toBe('[redacted]');
 expect(out.access_token).toBe('[redacted]');
 expect(out.jwt).toBe('[redacted]');
 expect(out.homeAddress).toBe('[redacted]');
 expect(out.otpCode).toBe('[redacted]');
 expect(out.password_hash).toBe('[redacted]');
 expect(out.keep).toBe('me');
 });

 it('recurses into nested objects', () => {
 const out = scrubObject({ outer: { phone: '+65', value: 1 } });
 expect(out.outer.phone).toBe('[redacted]');
 expect(out.outer.value).toBe(1);
 });

 it('walks arrays of objects', () => {
 const out = scrubObject({ list: [{ email: 'a@b' }, { value: 2 }] });
 expect(out.list[0].email).toBe('[redacted]');
 expect(out.list[1].value).toBe(2);
 });

 it('passes through primitives and null/undefined', () => {
 expect(scrubObject(null)).toBe(null);
 expect(scrubObject(undefined)).toBe(undefined);
 expect(scrubObject(42)).toBe(42);
 expect(scrubObject('hi')).toBe('hi');
 });
});

describe('scrubEvent()', () => {
 it('scrubs extra/tags/contexts/request.data and strips user to id only', () => {
 const out = scrubEvent({
 extra: { agentPhone: '+65', kept: 1 },
 tags: { user_email: 'a@b' },
 contexts: { trace: { name: 'op' } },
 request: { data: { name: 'Jane', value: 2 } },
 user: { id: 'u1', email: 'a@b', ip_address: '1.2.3.4' },
 });
 expect(out.extra.agentPhone).toBe('[redacted]');
 expect(out.extra.kept).toBe(1);
 expect(out.tags.user_email).toBe('[redacted]');
 expect(out.contexts.trace.name).toBe('[redacted]');
 expect(out.request.data.name).toBe('[redacted]');
 expect(out.request.data.value).toBe(2);
 expect(out.user).toEqual({ id: 'u1' });
 });

 it('returns event unchanged when fields are absent', () => {
 const event = {};
 expect(scrubEvent(event)).toBe(event);
 });

 it('handles null/undefined event input', () => {
 expect(scrubEvent(null)).toBe(null);
 expect(scrubEvent(undefined)).toBe(undefined);
 });
});

describe('scrubBreadcrumb()', () => {
 it('scrubs breadcrumb.data', () => {
 const out = scrubBreadcrumb({ category: 'http', data: { phone: '+65', code: 200 } });
 expect(out.data.phone).toBe('[redacted]');
 expect(out.data.code).toBe(200);
 });

 it('returns crumb unchanged when no data', () => {
 const crumb = { category: 'http' };
 expect(scrubBreadcrumb(crumb)).toBe(crumb);
 });
});

const SECRET = 'sk_live_deadbeefcafebabe1234';

// Parity table with backend/test/unit/redactTokens.test.js — this frontend
// copy of the regex must mask every URL-credential shape the backend masks.
// Add new URL-authenticated routes to BOTH tables.
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

describe('maskTokenUrl() (frontend twin of backend redactTokens)', () => {
 it.each(CREDENTIAL_SHAPES)('masks %s', (_label, input, expected) => {
 expect(maskTokenUrl(input)).toBe(expected);
 });

 it('leaves non-credential URLs untouched', () => {
 expect(maskTokenUrl('/api/campaigns/abc123')).toBe('/api/campaigns/abc123');
 expect(maskTokenUrl('/t/summer-promo')).toBe('/t/summer-promo');
 });

 it('masks the screening ?t= token in event.request.url', () => {
 const event = { request: { url: `https://redeem.sg/callback?t=${SECRET}` } };
 expect(scrubEvent(event).request.url).toBe('https://redeem.sg/callback?t=[token]');
 });

 it('masks credential URLs in breadcrumb data and message', () => {
 const out = scrubBreadcrumb({
 data: { url: `/api/reward-claim/${SECRET}` },
 message: `fetch /api/screening-callback/${SECRET} 404`,
 });
 expect(out.data.url).toBe('/api/reward-claim/[token]');
 expect(out.message).toBe('fetch /api/screening-callback/[token] 404');
 });
});
