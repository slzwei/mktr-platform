import { describe, it, expect } from 'vitest';
import normalizeProspect, { deriveAd, deriveReferral, sourceDisplay, sourceLine } from '../normalizeProspect';

describe('normalizeProspect', () => {
 it('normalizes a prospect with all fields present', () => {
 const input = {
 id: 'p-1',
 firstName: 'Alice',
 lastName: 'Wong',
 phone: '91234567',
 email: 'alice@example.com',
 company: 'Acme',
 leadStatus: 'contacted',
 leadSource: 'website',
 createdAt: '2025-06-01T00:00:00Z',
 dateOfBirth: '1990-01-15',
 assignedAgentId: 'a-1',
 assignedAgent: { firstName: 'Bob', lastName: 'Tan', email: 'bob@example.com' },
 campaignId: 'c-1',
 campaign: { name: 'Spring Campaign' },
 notes: 'Interested in product X',
 location: { zipCode: '530001' },
 };

 const result = normalizeProspect(input);

 expect(result.id).toBe('p-1');
 expect(result.name).toBe('Alice Wong');
 expect(result.firstName).toBe('Alice');
 expect(result.lastName).toBe('Wong');
 expect(result.phone).toBe('91234567');
 expect(result.email).toBe('alice@example.com');
 expect(result.company).toBe('Acme');
 expect(result.status).toBe('contacted');
 expect(result.leadStatus).toBe('contacted');
 expect(result.source).toBe('form'); // website -> form
 expect(result.created_date).toBe('2025-06-01T00:00:00Z');
 expect(result.createdAt).toBe('2025-06-01T00:00:00Z');
 expect(result.date_of_birth).toBe('1990-01-15');
 expect(result.assigned_agent_id).toBe('a-1');
 expect(result.assigned_agent_name).toBe('Bob Tan');
 expect(result.campaign_id).toBe('c-1');
 expect(result.campaign).toEqual({ name: 'Spring Campaign' });
 expect(result.notes).toBe('Interested in product X');
 expect(result.postal_code).toBe('530001');
 });

 it('handles missing/null fields gracefully', () => {
 const input = { id: 'p-2' };
 const result = normalizeProspect(input);

 expect(result.id).toBe('p-2');
 expect(result.name).toBe('');
 expect(result.phone).toBe('');
 expect(result.email).toBe('');
 expect(result.company).toBe('');
 expect(result.status).toBe('new');
 expect(result.source).toBe('other');
 expect(result.assigned_agent_id).toBe('');
 expect(result.assigned_agent_name).toBe('');
 expect(result.campaign_id).toBe('');
 expect(result.date_of_birth).toBeNull();
 expect(result.postal_code).toBe('');
 });

 it('maps source aliases correctly', () => {
 expect(normalizeProspect({ id: '1', leadSource: 'qr_code' }).source).toBe('qr');
 expect(normalizeProspect({ id: '2', leadSource: 'website' }).source).toBe('form');
 expect(normalizeProspect({ id: '3', leadSource: 'call_bot' }).source).toBe('call bot');
 expect(normalizeProspect({ id: '4', leadSource: 'referral' }).source).toBe('referral');
 });

 it('lowercases leadStatus for consistent status values', () => {
 const result = normalizeProspect({ id: '1', leadStatus: 'NEW' });
 expect(result.status).toBe('new');
 expect(result.leadStatus).toBe('new');
 });

 it('falls back to p.status when leadStatus is absent', () => {
 const result = normalizeProspect({ id: '1', status: 'qualified' });
 expect(result.status).toBe('qualified');
 });

 it('falls back to p.source when leadSource is absent', () => {
 const result = normalizeProspect({ id: '1', source: 'manual' });
 expect(result.source).toBe('manual');
 });

 it('preserves original fields that do not need normalization', () => {
 const input = { id: 'p-5', notes: 'keep me', campaign: { id: 'c-1', name: 'Test' } };
 const result = normalizeProspect(input);
 expect(result.notes).toBe('keep me');
 expect(result.campaign).toEqual({ id: 'c-1', name: 'Test' });
 });

 it('handles empty object input', () => {
 const result = normalizeProspect({});
 expect(result.id).toBeUndefined();
 expect(result.name).toBe('');
 expect(result.status).toBe('new');
 expect(result.source).toBe('other');
 });

 it('handles prospects with nested location object', () => {
 const result = normalizeProspect({ id: '1', location: { zipCode: '123456' } });
 expect(result.postal_code).toBe('123456');
 });

 it('prefers location.zipCode over flat postal_code', () => {
 const result = normalizeProspect({
 id: '1',
 location: { zipCode: 'zip-from-location' },
 postal_code: 'zip-flat',
 });
 expect(result.postal_code).toBe('zip-from-location');
 });

 it('uses flat postal_code when location is absent', () => {
 const result = normalizeProspect({ id: '1', postal_code: '540000' });
 expect(result.postal_code).toBe('540000');
 });

 it('builds name from firstName + lastName', () => {
 expect(normalizeProspect({ firstName: 'Jane', lastName: 'Doe' }).name).toBe('Jane Doe');
 });

 it('falls back to p.name when firstName/lastName are missing', () => {
 expect(normalizeProspect({ name: 'Legacy Name' }).name).toBe('Legacy Name');
 });

 it('uses snake_case alternatives for assignedAgent fields', () => {
 const result = normalizeProspect({
 id: '1',
 assigned_agent_id: 'a-99',
 assigned_agent_name: 'Legacy Agent',
 });
 expect(result.assigned_agent_id).toBe('a-99');
 expect(result.assigned_agent_name).toBe('Legacy Agent');
 });

 it('formats assignedAgent name from nested object', () => {
 const result = normalizeProspect({
 id: '1',
 assignedAgent: { firstName: 'Kim', lastName: null, email: 'kim@test.com' },
 });
 // firstName only — lastName filtered out
 expect(result.assigned_agent_name).toBe('Kim');
 });

 it('falls back to assignedAgent.email when name parts are missing', () => {
 const result = normalizeProspect({
 id: '1',
 assignedAgent: { email: 'agent@test.com' },
 });
 expect(result.assigned_agent_name).toBe('agent@test.com');
 });

 it('passes sourceMetadata through and precomputes ad/referral', () => {
 const result = normalizeProspect({
 id: '1',
 leadSource: 'website',
 sourceMetadata: { utm: { utm_source: 'facebook', utm_campaign: 'jun-leads' } },
 });
 expect(result.sourceMetadata).toEqual({ utm: { utm_source: 'facebook', utm_campaign: 'jun-leads' } });
 expect(result.ad).toMatchObject({ platform: 'meta', tier: 'ad', campaign: 'jun-leads' });
 expect(result.referral).toBeNull();
 });
});

describe('deriveAd', () => {
 it('meta utm_source → tier "ad" with campaign/adset/ad from utm fields', () => {
 const ad = deriveAd({
 utm: { utm_source: 'facebook', utm_campaign: 'Jun Leads', utm_term: 'adset-1', utm_content: 'ad-1' },
 });
 expect(ad).toEqual({
 platform: 'meta',
 tier: 'ad',
 campaign: 'Jun Leads',
 adset: 'adset-1',
 adName: 'ad-1',
 utmSource: 'facebook',
 });
 });

 it.each(['facebook', 'fb', 'instagram', 'ig', 'meta', 'IG', 'Facebook'])(
 'recognises meta utm_source alias %s',
 (alias) => {
 expect(deriveAd({ utm: { utm_source: alias } }).platform).toBe('meta');
 }
 );

 it('non-meta utm_source keeps its platform (no meta badge)', () => {
 const ad = deriveAd({ utm: { utm_source: 'tiktok', utm_campaign: 'q2' } });
 expect(ad).toMatchObject({ platform: 'tiktok', tier: 'ad', campaign: 'q2' });
 });

 it('fbc-only → tier "click" (Meta click, not paid-ad evidence)', () => {
 expect(deriveAd({ fbc: 'fb.1.1718000000.AbCd' })).toMatchObject({ platform: 'meta', tier: 'click' });
 });

 it('fbclid in eventSourceUrl → tier "click"', () => {
 const ad = deriveAd({ eventSourceUrl: 'https://redeem.sg/LeadCapture?campaign_id=c1&fbclid=XYZ' });
 expect(ad).toMatchObject({ platform: 'meta', tier: 'click' });
 });

 it('fbp alone is NOT ad evidence (minted for every tracked visitor)', () => {
 expect(deriveAd({ fbp: 'fb.1.1718000000.12345' })).toBeNull();
 });

 it.each(['tiktok', 'tt', 'tiktokads', 'tiktok_ads', 'tiktok-ads', 'TikTok'])(
 'recognises tiktok utm_source alias %s',
 (alias) => {
 expect(deriveAd({ utm: { utm_source: alias } }).platform).toBe('tiktok');
 }
 );

 it('ttclid-only → tier "click" (TikTok click, not paid-ad evidence)', () => {
 expect(deriveAd({ ttclid: 'EAAtt.123' })).toMatchObject({ platform: 'tiktok', tier: 'click' });
 });

 it('ttclid in eventSourceUrl → tier "click"', () => {
 const ad = deriveAd({ eventSourceUrl: 'https://redeem.sg/LeadCapture?campaign_id=c1&ttclid=XYZ' });
 expect(ad).toMatchObject({ platform: 'tiktok', tier: 'click' });
 });

 it('_ttp alone is NOT ad evidence (minted for every tracked visitor)', () => {
 expect(deriveAd({ ttp: 'tt.1.1718000000.12345' })).toBeNull();
 });

 it('meta click id wins when both fbc and ttclid are present', () => {
 expect(deriveAd({ fbc: 'fb.1.1.X', ttclid: 'EAAtt.123' }).platform).toBe('meta');
 });

 it('returns null for empty/absent metadata', () => {
 expect(deriveAd(null)).toBeNull();
 expect(deriveAd({})).toBeNull();
 expect(deriveAd({ eventSourceUrl: 'https://redeem.sg/LeadCapture?campaign_id=c1' })).toBeNull();
 });
});

describe('deriveReferral', () => {
 it('passes the backend referral stash through', () => {
 const referral = deriveReferral({
 referral: { ref: 'uuid-1', referrerProspectId: 'uuid-1', referrerName: 'Jane Doe', sameCampaign: true },
 });
 expect(referral).toEqual({
 ref: 'uuid-1',
 referrerProspectId: 'uuid-1',
 referrerName: 'Jane Doe',
 sameCampaign: true,
 });
 });

 it('returns null when absent or malformed', () => {
 expect(deriveReferral(null)).toBeNull();
 expect(deriveReferral({})).toBeNull();
 expect(deriveReferral({ referral: 'not-an-object' })).toBeNull();
 });
});

describe('sourceDisplay', () => {
 it('META AD with campaign detail + tooltip from a normalized prospect', () => {
 const p = normalizeProspect({
 id: '1',
 leadSource: 'website',
 sourceMetadata: { utm: { utm_source: 'facebook', utm_campaign: 'Jun Leads', utm_term: 'adset-1' } },
 });
 const d = sourceDisplay(p);
 expect(d.label).toBe('META AD');
 expect(d.detail).toBe('Jun Leads');
 expect(d.tooltip).toBe('Campaign: Jun Leads · Ad set: adset-1');
 expect(d.attribution).toBe('Meta ad: Jun Leads');
 });

 it('META CLICK for fbc-only rows (legacy Meta leads)', () => {
 const d = sourceDisplay(normalizeProspect({ id: '1', leadSource: 'website', sourceMetadata: { fbc: 'fb.1.1.X' } }));
 expect(d.label).toBe('META CLICK');
 expect(d.detail).toBe('');
 expect(d.attribution).toBe('Meta click');
 });

 it('referral with resolved name', () => {
 const d = sourceDisplay(
 normalizeProspect({
 id: '1',
 leadSource: 'referral',
 sourceMetadata: { referral: { ref: 'u-1', referrerProspectId: 'u-1', referrerName: 'Jane Doe', sameCampaign: true } },
 })
 );
 expect(d.label).toBe('REFERRAL');
 expect(d.detail).toBe('Jane Doe');
 expect(d.tooltip).toBe('Referred by Jane Doe');
 expect(d.attribution).toBe('Referred by Jane Doe');
 });

 it('legacy anonymous referral explains itself', () => {
 const d = sourceDisplay(normalizeProspect({ id: '1', leadSource: 'referral' }));
 expect(d.label).toBe('REFERRAL');
 expect(d.tooltip).toBe('Referrer unknown (shared before referral tracking)');
 expect(d.attribution).toBe('');
 });

 it('referral wins over a stale same-tab ad capture', () => {
 const d = sourceDisplay(
 normalizeProspect({
 id: '1',
 leadSource: 'referral',
 sourceMetadata: {
 utm: { utm_source: 'facebook', utm_campaign: 'Jun Leads' },
 referral: { ref: 'u-1', referrerName: 'Jane Doe', sameCampaign: true },
 },
 })
 );
 expect(d.label).toBe('REFERRAL');
 });

 it('plain sources fall through unchanged', () => {
 expect(sourceDisplay(normalizeProspect({ id: '1', leadSource: 'website' })).label).toBe('FORM');
 expect(sourceDisplay(normalizeProspect({ id: '1', leadSource: 'qr_code' })).label).toBe('QR');
 expect(sourceDisplay(normalizeProspect({ id: '1', leadSource: 'social_media' })).label).toBe('SOCIAL MEDIA');
 });

 it('works on a RAW backend record too (detail view before normalize)', () => {
 const d = sourceDisplay({
 leadSource: 'website',
 sourceMetadata: { utm: { utm_source: 'instagram', utm_campaign: 'IG Push' } },
 });
 expect(d.label).toBe('META AD');
 expect(d.detail).toBe('IG Push');
 });

 it('TIKTOK AD with campaign detail from utm_source=tiktok', () => {
 const d = sourceDisplay(
 normalizeProspect({
 id: '1',
 leadSource: 'website',
 sourceMetadata: { utm: { utm_source: 'tiktok', utm_campaign: 'Q2 Quiz', utm_term: 'adgroup-1' } },
 })
 );
 expect(d.label).toBe('TIKTOK AD');
 expect(d.detail).toBe('Q2 Quiz');
 expect(d.tooltip).toBe('Campaign: Q2 Quiz · Ad set: adgroup-1');
 expect(d.attribution).toBe('TikTok ad: Q2 Quiz');
 });

 it('TIKTOK CLICK for ttclid-only rows (no UTMs on the ad URL)', () => {
 const d = sourceDisplay(
 normalizeProspect({ id: '1', leadSource: 'website', sourceMetadata: { ttclid: 'EAAtt.123' } })
 );
 expect(d.label).toBe('TIKTOK CLICK');
 expect(d.detail).toBe('');
 expect(d.attribution).toBe('TikTok click');
 });

 it('unknown ad platform surfaces the raw source as an AD badge', () => {
 const d = sourceDisplay(
 normalizeProspect({ id: '1', leadSource: 'website', sourceMetadata: { utm: { utm_source: 'google' } } })
 );
 expect(d.label).toBe('GOOGLE AD');
 expect(d.attribution).toBe('GOOGLE ad');
 });
});

describe('sourceLine', () => {
 it('joins label and detail', () => {
 const p = normalizeProspect({
 id: '1',
 leadSource: 'website',
 sourceMetadata: { utm: { utm_source: 'facebook', utm_campaign: 'Jun Leads' } },
 });
 expect(sourceLine(p)).toBe('META AD · Jun Leads');
 });

 it('label only when no detail', () => {
 expect(sourceLine(normalizeProspect({ id: '1', leadSource: 'website' }))).toBe('FORM');
 });
});
