import { describe, it, expect } from 'vitest';
import normalizeProspect from '../normalizeProspect';

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
});
