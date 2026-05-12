import { describe, it, expect } from '@jest/globals';
import { schemas } from '../src/middleware/validation.js';

const valid = (schema, body) => {
  const { error, value } = schema.validate(body, { abortEarly: false });
  return { ok: !error, error, value };
};

describe('schemas.campaignCreate', () => {
  it('accepts the integration-test body shape', () => {
    const { ok, error } = valid(schemas.campaignCreate, {
      name: 'Integration Test Campaign',
      type: 'lead_generation',
      is_active: true,
      min_age: 21,
      max_age: 55,
    });
    expect(error).toBeUndefined();
    expect(ok).toBe(true);
  });

  it('accepts minimum body (name only) — type defaults applied at service layer', () => {
    const { ok } = valid(schemas.campaignCreate, { name: 'A' });
    expect(ok).toBe(true);
  });

  it('rejects body with no name', () => {
    const { ok, error } = valid(schemas.campaignCreate, { type: 'lead_generation' });
    expect(ok).toBe(false);
    expect(error.details[0].path).toEqual(['name']);
  });

  it('rejects bad type enum value', () => {
    const { ok, error } = valid(schemas.campaignCreate, { name: 'X', type: 'bogus_type' });
    expect(ok).toBe(false);
    expect(error.details[0].path).toEqual(['type']);
  });

  it('rejects unknown camelCase fields (catches stale clients sending old shape)', () => {
    const { ok, error } = valid(schemas.campaignCreate, { name: 'X', startDate: '2026-01-01' });
    expect(ok).toBe(false);
    expect(error.details[0].path).toEqual(['startDate']);
  });

  it('accepts assigned_agents as UUID array', () => {
    const { ok } = valid(schemas.campaignCreate, {
      name: 'X',
      assigned_agents: ['00000000-0000-0000-0000-000000000001'],
    });
    expect(ok).toBe(true);
  });

  it('rejects assigned_agents containing non-UUID strings', () => {
    const { ok } = valid(schemas.campaignCreate, {
      name: 'X',
      assigned_agents: ['not-a-uuid'],
    });
    expect(ok).toBe(false);
  });
});

describe('schemas.campaignUpdate', () => {
  it('accepts a partial update (single field)', () => {
    const { ok } = valid(schemas.campaignUpdate, { name: 'Updated' });
    expect(ok).toBe(true);
  });

  it('accepts is_active toggle', () => {
    const { ok } = valid(schemas.campaignUpdate, { is_active: false });
    expect(ok).toBe(true);
  });

  it('accepts min_age + max_age update', () => {
    const { ok } = valid(schemas.campaignUpdate, { min_age: 30, max_age: 50 });
    expect(ok).toBe(true);
  });

  it('rejects empty update body (.min(1))', () => {
    const { ok } = valid(schemas.campaignUpdate, {});
    expect(ok).toBe(false);
  });

  it('rejects unknown fields', () => {
    const { ok, error } = valid(schemas.campaignUpdate, { name: 'X', status: 'archived' });
    expect(ok).toBe(false);
    expect(error.details[0].path).toEqual(['status']);
  });
});

describe('schemas.qrTagCreate', () => {
  it('accepts the promotional QR form body shape', () => {
    const { ok, error } = valid(schemas.qrTagCreate, {
      label: 'Booth-A QR',
      tags: ['booth', 'campaign-1'],
      type: 'promo',
      campaignId: '00000000-0000-0000-0000-000000000001',
      agentAssignmentMode: 'direct',
      assignedAgentPhone: '+6591234567',
      assignedAgentEmail: 'agent@example.com',
      assignedAgentName: 'Jane Tan',
    });
    expect(error).toBeUndefined();
    expect(ok).toBe(true);
  });

  it('accepts the car QR shape (label + carId only)', () => {
    const { ok } = valid(schemas.qrTagCreate, {
      type: 'car',
      carId: '00000000-0000-0000-0000-000000000001',
      label: 'SGX1234A',
    });
    expect(ok).toBe(true);
  });

  it('accepts an empty body (controller is fully optional + auto-generates slug)', () => {
    const { ok } = valid(schemas.qrTagCreate, {});
    expect(ok).toBe(true);
  });

  it('rejects bad agentAssignmentMode', () => {
    const { ok, error } = valid(schemas.qrTagCreate, { agentAssignmentMode: 'magic' });
    expect(ok).toBe(false);
    expect(error.details[0].path).toEqual(['agentAssignmentMode']);
  });

  it('rejects malformed assignedAgentPhone', () => {
    const { ok, error } = valid(schemas.qrTagCreate, { assignedAgentPhone: '12345' });
    expect(ok).toBe(false);
    expect(error.details[0].path).toEqual(['assignedAgentPhone']);
  });

  it('allows null/empty assignedAgent* fields (form clears them in round_robin mode)', () => {
    const { ok } = valid(schemas.qrTagCreate, {
      agentAssignmentMode: 'round_robin',
      assignedAgentPhone: null,
      assignedAgentEmail: null,
      assignedAgentName: null,
    });
    expect(ok).toBe(true);
  });
});

describe('schemas.leadPackageCreate', () => {
  const validBody = {
    name: 'Gold Package',
    price: 199.99,
    leadCount: 50,
    campaignId: '00000000-0000-0000-0000-000000000001',
    type: 'basic',
  };

  it('accepts the integration-test body', () => {
    const { ok, error } = valid(schemas.leadPackageCreate, validBody);
    expect(error).toBeUndefined();
    expect(ok).toBe(true);
  });

  it('accepts body without optional type (controller defaults to basic)', () => {
    const { ok } = valid(schemas.leadPackageCreate, { ...validBody, type: undefined });
    expect(ok).toBe(true);
  });

  it('accepts description (form sends it; controller drops it)', () => {
    const { ok } = valid(schemas.leadPackageCreate, { ...validBody, description: 'extras' });
    expect(ok).toBe(true);
  });

  it('rejects missing name', () => {
    const { name, ...rest } = validBody;
    void name;
    const { ok, error } = valid(schemas.leadPackageCreate, rest);
    expect(ok).toBe(false);
    expect(error.details[0].path).toEqual(['name']);
  });

  it('rejects missing price', () => {
    const { price, ...rest } = validBody;
    void price;
    const { ok, error } = valid(schemas.leadPackageCreate, rest);
    expect(ok).toBe(false);
    expect(error.details[0].path).toEqual(['price']);
  });

  it('rejects missing leadCount', () => {
    const { leadCount, ...rest } = validBody;
    void leadCount;
    const { ok, error } = valid(schemas.leadPackageCreate, rest);
    expect(ok).toBe(false);
    expect(error.details[0].path).toEqual(['leadCount']);
  });

  it('rejects missing campaignId', () => {
    const { campaignId, ...rest } = validBody;
    void campaignId;
    const { ok, error } = valid(schemas.leadPackageCreate, rest);
    expect(ok).toBe(false);
    expect(error.details[0].path).toEqual(['campaignId']);
  });

  it('rejects negative price', () => {
    const { ok, error } = valid(schemas.leadPackageCreate, { ...validBody, price: -1 });
    expect(ok).toBe(false);
    expect(error.details[0].path).toEqual(['price']);
  });

  it('rejects zero leadCount', () => {
    const { ok, error } = valid(schemas.leadPackageCreate, { ...validBody, leadCount: 0 });
    expect(ok).toBe(false);
    expect(error.details[0].path).toEqual(['leadCount']);
  });

  it('rejects bad type enum', () => {
    const { ok, error } = valid(schemas.leadPackageCreate, { ...validBody, type: 'platinum' });
    expect(ok).toBe(false);
    expect(error.details[0].path).toEqual(['type']);
  });

  it('rejects unknown fields (e.g., qualityScore from old schema)', () => {
    const { ok, error } = valid(schemas.leadPackageCreate, { ...validBody, qualityScore: 8 });
    expect(ok).toBe(false);
    expect(error.details[0].path).toEqual(['qualityScore']);
  });
});

describe('schemas (regression — no driverCreate)', () => {
  it('does not export driverCreate (deleted as dead 2026-05-13)', () => {
    expect(schemas.driverCreate).toBeUndefined();
  });
});
