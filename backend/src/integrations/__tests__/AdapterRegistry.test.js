/**
 * @file AdapterRegistry unit tests.
 *
 * Pure in-memory; no DB or network. Confirms registry contract:
 * - register/get/has/list/replace
 * - rejects malformed adapters
 * - rejects duplicate registration unless explicitly replaced
 */

import { adapterRegistry } from '../AdapterRegistry.js';

const dummyAdapter = {
  id: 'test-platform',
  listAgents: async () => [],
  getAgent: async () => ({ externalId: 'x' }),
};

describe('AdapterRegistry', () => {
  beforeEach(() => {
    adapterRegistry._resetForTesting();
  });

  describe('register', () => {
    test('registers a valid adapter', () => {
      adapterRegistry.register(dummyAdapter);
      expect(adapterRegistry.has('test-platform')).toBe(true);
    });

    test('rejects adapter without id', () => {
      expect(() => adapterRegistry.register({})).toThrow(/string `id`/);
    });

    test('rejects adapter without listAgents', () => {
      expect(() =>
        adapterRegistry.register({ id: 't', getAgent: async () => null })
      ).toThrow(/listAgents/);
    });

    test('rejects adapter without getAgent', () => {
      expect(() =>
        adapterRegistry.register({ id: 't', listAgents: async () => [] })
      ).toThrow(/getAgent/);
    });

    test('rejects duplicate registration', () => {
      adapterRegistry.register(dummyAdapter);
      expect(() => adapterRegistry.register(dummyAdapter)).toThrow(/already registered/);
    });
  });

  describe('replace', () => {
    test('overwrites an existing adapter', () => {
      adapterRegistry.register(dummyAdapter);
      const v2 = { ...dummyAdapter, version: 2 };
      adapterRegistry.replace(v2);
      expect(adapterRegistry.get('test-platform')).toBe(v2);
    });
  });

  describe('get', () => {
    test('throws with helpful message for unknown id', () => {
      adapterRegistry.register(dummyAdapter);
      expect(() => adapterRegistry.get('hubspot')).toThrow(/No adapter registered for 'hubspot'.*test-platform/);
    });

    test('returns the registered adapter', () => {
      adapterRegistry.register(dummyAdapter);
      expect(adapterRegistry.get('test-platform')).toBe(dummyAdapter);
    });
  });

  describe('list', () => {
    test('returns all registered adapters', () => {
      const a1 = { ...dummyAdapter, id: 'a' };
      const a2 = { ...dummyAdapter, id: 'b' };
      adapterRegistry.register(a1);
      adapterRegistry.register(a2);
      expect(adapterRegistry.list()).toEqual(expect.arrayContaining([a1, a2]));
      expect(adapterRegistry.list()).toHaveLength(2);
    });

    test('returns empty array when nothing registered', () => {
      expect(adapterRegistry.list()).toEqual([]);
    });
  });
});
