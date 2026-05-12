import { describe, it, expect } from '@jest/globals';
import { ALLOWED_SORT_FIELDS, normalizeAgentSort } from '../src/services/agentService.js';

describe('normalizeAgentSort()', () => {
  it('passes through any whitelisted sortBy', () => {
    for (const field of ALLOWED_SORT_FIELDS) {
      expect(normalizeAgentSort(field, 'DESC').sortBy).toBe(field);
    }
  });

  it('falls back to createdAt for unknown sortBy', () => {
    expect(normalizeAgentSort('badColumn', 'DESC').sortBy).toBe('createdAt');
  });

  it('falls back to createdAt for empty string sortBy', () => {
    expect(normalizeAgentSort('', 'DESC').sortBy).toBe('createdAt');
  });

  it('falls back to createdAt for undefined / null sortBy', () => {
    expect(normalizeAgentSort(undefined, 'DESC').sortBy).toBe('createdAt');
    expect(normalizeAgentSort(null, 'DESC').sortBy).toBe('createdAt');
  });

  it('coerces sortBy to string before checking — non-string types fall back', () => {
    // A maliciously-shaped object should not match any allowed field name.
    expect(normalizeAgentSort({ toString: () => 'createdAt' }, 'DESC').sortBy).toBe('createdAt');
    expect(normalizeAgentSort(['createdAt'], 'DESC').sortBy).toBe('createdAt');
    expect(normalizeAgentSort(123, 'DESC').sortBy).toBe('createdAt');
  });

  it('rejects ORDER BY injection attempts via sortBy', () => {
    const attempts = [
      "createdAt; DROP TABLE users; --",
      "createdAt) UNION SELECT password FROM users--",
      'createdAt"',
      'createdAt --',
    ];
    for (const attempt of attempts) {
      expect(normalizeAgentSort(attempt, 'DESC').sortBy).toBe('createdAt');
    }
  });

  it('accepts ASC + DESC (case-insensitive) and falls back to DESC otherwise', () => {
    expect(normalizeAgentSort('createdAt', 'ASC').order).toBe('ASC');
    expect(normalizeAgentSort('createdAt', 'asc').order).toBe('ASC');
    expect(normalizeAgentSort('createdAt', 'DESC').order).toBe('DESC');
    expect(normalizeAgentSort('createdAt', 'desc').order).toBe('DESC');

    // Unknown / malicious order values fall back to DESC
    expect(normalizeAgentSort('createdAt', 'random').order).toBe('DESC');
    expect(normalizeAgentSort('createdAt', undefined).order).toBe('DESC');
    expect(normalizeAgentSort('createdAt', '').order).toBe('DESC');
    expect(normalizeAgentSort('createdAt', "ASC; DROP TABLE users").order).toBe('DESC');
  });

  it('ALLOWED_SORT_FIELDS is frozen (cannot be mutated by callers)', () => {
    expect(Object.isFrozen(ALLOWED_SORT_FIELDS)).toBe(true);
    expect(() => {
      // strict mode (ESM) — push on a frozen array throws
      ALLOWED_SORT_FIELDS.push('password');
    }).toThrow();
    expect(ALLOWED_SORT_FIELDS).not.toContain('password');
  });
});
