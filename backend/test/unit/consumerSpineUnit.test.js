import { jest } from '@jest/globals';
import '../setup.js';
import { createHash } from 'crypto';
import {
  phoneVerificationIsCurrent, phoneVerificationEvidence,
  PHONE_VERIFICATION_STAMP_EPOCH, phoneHashOf, E164_RE,
} from '../../src/services/consumerService.js';
import {
  buildLeadCreatedPayload, buildLeadDeletedPayload, buildLeadAssignedPayload,
  buildLeadUnassignedPayload, buildLeadHeldPayload, buildLeadSuppressedPayload,
} from '../../src/services/prospectHelpers.js';
import { makeEntitlementService } from '../../src/services/redeemOps/entitlementService.js';

const sha = (v) => createHash('sha256').update(v).digest('hex');

describe('phoneVerificationIsCurrent (stamp↔phone binding, Codex R1 #6)', () => {
  const phone = '+6591234567';
  test('no stamp → false', () => {
    expect(phoneVerificationIsCurrent({ phone, sourceMetadata: {} })).toBe(false);
    expect(phoneVerificationIsCurrent(null)).toBe(false);
  });
  test('legacy stamp without binding → true', () => {
    expect(phoneVerificationIsCurrent({ phone, sourceMetadata: { phoneVerifiedAt: '2026-01-01T00:00:00Z' } })).toBe(true);
  });
  test('bound stamp matching the current phone → true', () => {
    expect(phoneVerificationIsCurrent({
      phone, sourceMetadata: { phoneVerifiedAt: '2026-01-01T00:00:00Z', phoneVerifiedFor: sha(phone) },
    })).toBe(true);
  });
  test('bound stamp for a DIFFERENT phone (post-edit) → false', () => {
    expect(phoneVerificationIsCurrent({
      phone: '+6598765432',
      sourceMetadata: { phoneVerifiedAt: '2026-01-01T00:00:00Z', phoneVerifiedFor: sha(phone) },
    })).toBe(false);
  });
  test('phoneHashOf matches the stamp recipe', () => {
    expect(phoneHashOf(phone)).toBe(sha(phone));
    expect(E164_RE.test(phone)).toBe(true);
  });
});

describe('phoneVerificationEvidence (missing proof ≠ failed verification)', () => {
  const phone = '+6591234567';
  const BEFORE = new Date(PHONE_VERIFICATION_STAMP_EPOCH.getTime() - 1);
  const AFTER = new Date(PHONE_VERIFICATION_STAMP_EPOCH.getTime() + 1);

  test('a live stamp is verified whichever side of the epoch it sits on', () => {
    const sm = { phoneVerifiedAt: '2026-07-20T00:00:00Z', phoneVerifiedFor: sha(phone) };
    expect(phoneVerificationEvidence({ phone, sourceMetadata: sm, createdAt: AFTER })).toBe('verified');
    expect(phoneVerificationEvidence({ phone, sourceMetadata: sm, createdAt: BEFORE })).toBe('verified');
  });

  test('no stamp BEFORE the epoch → unrecorded, because no stamp could exist yet', () => {
    expect(phoneVerificationEvidence({ phone, sourceMetadata: {}, createdAt: BEFORE })).toBe('unrecorded');
    // The real row this was found on: captured 2026-07-01, consent keys only.
    expect(phoneVerificationEvidence({
      phone: '+6594652996',
      sourceMetadata: { consent_contact: true, consent_terms: true },
      createdAt: new Date('2026-07-01T15:35:19Z'),
    })).toBe('unrecorded');
  });

  test('no stamp AFTER the epoch → unverified; the stamp would have been written', () => {
    expect(phoneVerificationEvidence({ phone, sourceMetadata: {}, createdAt: AFTER })).toBe('unverified');
  });

  test('a BROKEN binding stays unverified even pre-epoch — a staff phone edit is real evidence', () => {
    expect(phoneVerificationEvidence({
      phone: '+6598765432',
      sourceMetadata: { phoneVerifiedAt: '2026-01-01T00:00:00Z', phoneVerifiedFor: sha(phone) },
      createdAt: BEFORE,
    })).toBe('unverified');
  });

  test('an unknown createdAt falls to the strict answer, never the generous one', () => {
    expect(phoneVerificationEvidence({ phone, sourceMetadata: {} })).toBe('unverified');
    expect(phoneVerificationEvidence({ phone, sourceMetadata: {}, createdAt: 'not-a-date' })).toBe('unverified');
    expect(phoneVerificationEvidence(null)).toBe('unverified');
  });
});

describe('webhook payload contract — consumerId NEVER leaves the system (plan §2.3)', () => {
  const prospect = {
    id: 'p-1', consumerId: '11111111-1111-4111-8111-111111111111',
    firstName: 'A', lastName: 'B', phone: '+6591234567', email: 'a@b.c',
    company: null, jobTitle: null, industry: null, leadSource: 'website',
    interests: null, budget: null, preferences: null, demographics: null,
    location: null, tags: null, notes: null,
    sourceMetadata: { utm: { utm_source: 'fb' } }, dncStatus: null,
    createdAt: new Date('2026-01-01'),
  };
  test('lead.created carries no consumerId', () => {
    const payload = buildLeadCreatedPayload(prospect, 'round_robin', { phone: '+65', email: 'x', name: 'X', id: 'agent-ext' }, 'agent-1', { id: 'c1', name: 'C' }, null, null);
    expect(JSON.stringify(payload)).not.toContain('consumerId');
    expect(payload.data.lead.externalId).toBe('p-1');
  });
  test('lead.deleted carries no consumerId', () => {
    const payload = buildLeadDeletedPayload(prospect);
    expect(JSON.stringify(payload)).not.toContain('consumerId');
  });
  test('lead.assigned carries no consumerId', () => {
    const payload = buildLeadAssignedPayload(prospect, { id: 'a1', phone: '+65', email: 'x@y.z', firstName: 'Ag', lastName: 'Ent' }, { campaign: null }, {});
    expect(JSON.stringify(payload)).not.toContain('consumerId');
  });
  // Codex propagate-round #3: the guard was created/assigned/deleted only.
  test('lead.unassigned carries no consumerId', () => {
    const payload = buildLeadUnassignedPayload(prospect, 'prev-agent-lyfe-id', {});
    expect(JSON.stringify(payload)).not.toContain('consumerId');
  });
  test('lead.held carries no consumerId', () => {
    const payload = buildLeadHeldPayload(prospect, { id: 'c1', name: 'C' }, 'no_funded_agent');
    expect(JSON.stringify(payload)).not.toContain('consumerId');
  });
  test('lead.suppressed carries no consumerId AND no direct identifiers', () => {
    const payload = buildLeadSuppressedPayload(prospect.id, {
      scope: 'all', reason: 'erasure', occurredAt: new Date('2026-01-01'),
    });
    const raw = JSON.stringify(payload);
    expect(raw).not.toContain('consumerId');
    expect(raw).not.toContain(prospect.phone);
    expect(raw).not.toContain(prospect.email);
  });
});

describe('entitlement issuance — consumer link + bound-stamp gate', () => {
  function buildService({ prospectOverrides = {}, consumerLookup = null } = {}) {
    const phone = '+6591234567';
    const prospect = {
      id: 'p-1', campaignId: 'c-1', phone, consumerId: 'consumer-1', quarantinedAt: null,
      sourceMetadata: { phoneVerifiedAt: '2026-01-01T00:00:00Z', phoneVerifiedFor: sha(phone) },
      ...prospectOverrides,
    };
    const activation = {
      id: 'act-1', campaignId: 'c-1', status: 'active', unlockPolicy: 'agent_unlock',
      endDate: null, rewardOffer: { id: 'offer-1', status: 'active', claimExpiryDays: 30, redemptionExpiryDays: 90 },
    };
    const create = jest.fn(async (v) => ({ id: 'ent-1', ...v }));
    const svc = makeEntitlementService({
      Activation: { findOne: jest.fn(async () => activation) },
      RewardEntitlement: { findOne: jest.fn(async () => null), create },
      RedemptionEvent: { create: jest.fn(async () => ({})) },
      ActivationIssuanceSkip: { create: jest.fn(async () => ({})) },
      Consumer: { findOne: jest.fn(async () => consumerLookup) },
      inventory: { recordIssued: jest.fn(async () => ({})) },
      audit: {},
      sequelize: {
        transaction: async (cb) => cb({ __tx: true }),
        query: jest.fn(async () => [[{ id: 'act-1' }]]),
      },
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    });
    return { svc, create, prospect };
  }

  test('links consumerId from the prospect at create', async () => {
    const { svc, create, prospect } = buildService();
    const res = await svc.issueForProspect(prospect, { via: 'hook' });
    expect(res.entitlement).toBeTruthy();
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].consumerId).toBe('consumer-1');
    expect(create.mock.calls[0][0].phoneKey).toBe('6591234567');
  });

  test('falls back to a phoneKey consumer lookup for pre-spine prospects', async () => {
    const { svc, create, prospect } = buildService({
      prospectOverrides: { consumerId: null },
      consumerLookup: { id: 'consumer-legacy' },
    });
    await svc.issueForProspect(prospect, { via: 'hook' });
    expect(create.mock.calls[0][0].consumerId).toBe('consumer-legacy');
  });

  test('bound stamp for a different phone → phone_not_verified, nothing created', async () => {
    const { svc, create, prospect } = buildService({
      prospectOverrides: {
        sourceMetadata: { phoneVerifiedAt: '2026-01-01T00:00:00Z', phoneVerifiedFor: sha('+6500000000') },
      },
    });
    const res = await svc.issueForProspect(prospect, { via: 'hook' });
    expect(res.entitlement).toBeNull();
    expect(res.reason).toBe('phone_not_verified');
    expect(create).not.toHaveBeenCalled();
  });
});
