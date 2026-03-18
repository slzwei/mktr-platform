import { jest } from '@jest/globals';
import '../setup.js';
import { getTenantId, DEFAULT_TENANT_ID } from '../../src/middleware/tenant.js';

describe('tenant middleware', () => {
  it('exports DEFAULT_TENANT_ID as all-zeros UUID', () => {
    expect(DEFAULT_TENANT_ID).toBe('00000000-0000-0000-0000-000000000000');
  });

  it('extracts tid from JWT payload (req.user.tid)', () => {
    const req = { user: { tid: 'tenant-from-jwt' }, get: jest.fn() };
    expect(getTenantId(req)).toBe('tenant-from-jwt');
  });

  it('falls back to x-tenant-id header when JWT tid is absent', () => {
    const req = { user: {}, get: jest.fn((h) => h === 'x-tenant-id' ? 'tenant-from-header' : undefined) };
    expect(getTenantId(req)).toBe('tenant-from-header');
  });

  it('returns DEFAULT_TENANT_ID when neither JWT nor header provides tid', () => {
    const req = { user: {}, get: jest.fn(() => undefined) };
    expect(getTenantId(req)).toBe(DEFAULT_TENANT_ID);
  });

  it('coerces result to string', () => {
    const req = { user: { tid: 12345 }, get: jest.fn() };
    const result = getTenantId(req);
    expect(typeof result).toBe('string');
    expect(result).toBe('12345');
  });
});
