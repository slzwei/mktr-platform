import { describe, it, expect } from 'vitest';
import { agentInviteSchema } from '../agent';

describe('agentInviteSchema', () => {
  const validData = {
    full_name: 'Jane Doe',
    email: 'jane@example.com',
  };

  it('validates correct agent invite data', () => {
    const result = agentInviteSchema.safeParse(validData);
    expect(result.success).toBe(true);
  });

  it('rejects missing full_name', () => {
    const result = agentInviteSchema.safeParse({ ...validData, full_name: '' });
    expect(result.success).toBe(false);
    expect(result.error.issues[0].path).toEqual(['full_name']);
  });

  it('rejects invalid email', () => {
    const result = agentInviteSchema.safeParse({ ...validData, email: 'not-email' });
    expect(result.success).toBe(false);
    expect(result.error.issues[0].path).toEqual(['email']);
  });

  it('rejects full_name exceeding 100 characters', () => {
    const result = agentInviteSchema.safeParse({ ...validData, full_name: 'A'.repeat(101) });
    expect(result.success).toBe(false);
  });

  it('allows empty phone string', () => {
    const result = agentInviteSchema.safeParse({ ...validData, phone: '' });
    expect(result.success).toBe(true);
  });

  it('allows phone up to 20 characters', () => {
    const result = agentInviteSchema.safeParse({ ...validData, phone: '9123 4567' });
    expect(result.success).toBe(true);
  });

  it('rejects phone exceeding 20 characters', () => {
    const result = agentInviteSchema.safeParse({ ...validData, phone: '1'.repeat(21) });
    expect(result.success).toBe(false);
  });

  it('allows optional dateOfBirth', () => {
    const result = agentInviteSchema.safeParse({ ...validData, dateOfBirth: '1990-01-01' });
    expect(result.success).toBe(true);
  });

  it('allows empty dateOfBirth string', () => {
    const result = agentInviteSchema.safeParse({ ...validData, dateOfBirth: '' });
    expect(result.success).toBe(true);
  });

  it('allows optional owed_leads_count as number', () => {
    const result = agentInviteSchema.safeParse({ ...validData, owed_leads_count: 5 });
    expect(result.success).toBe(true);
  });

  it('coerces string owed_leads_count to number', () => {
    const result = agentInviteSchema.safeParse({ ...validData, owed_leads_count: '10' });
    expect(result.success).toBe(true);
    expect(result.data.owed_leads_count).toBe(10);
  });

  it('rejects negative owed_leads_count', () => {
    const result = agentInviteSchema.safeParse({ ...validData, owed_leads_count: -1 });
    expect(result.success).toBe(false);
  });

  it('allows zero owed_leads_count', () => {
    const result = agentInviteSchema.safeParse({ ...validData, owed_leads_count: 0 });
    expect(result.success).toBe(true);
  });

  it('passes without optional fields', () => {
    const result = agentInviteSchema.safeParse({ full_name: 'Test', email: 'test@test.com' });
    expect(result.success).toBe(true);
  });

  it('rejects missing email', () => {
    const result = agentInviteSchema.safeParse({ full_name: 'Test' });
    expect(result.success).toBe(false);
  });
});
