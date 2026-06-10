import '../setup.js';
import { provenanceConflictField } from '../../src/services/agentSyncService.js';

/**
 * One-source-per-user guard (the Codex-flagged safety). When syncing one source
 * (say mktr-leads, localIdField='mktrLeadsId'), the "other" provenance fields
 * are ['lyfeId']. A phone/email match onto a row that already has lyfeId set is
 * a conflict — attaching mktrLeadsId would create an ambiguous dual-source row.
 */
describe('provenanceConflictField', () => {
  const OTHER = ['lyfeId']; // syncing mktr_leads → the other source is lyfe

  it('flags a phone/email match onto a row owned by another source', () => {
    const existing = { id: 'u1', lyfeId: 'L1', mktrLeadsId: null };
    expect(provenanceConflictField(existing, false, OTHER)).toBe('lyfeId');
  });

  it('does NOT flag an externalId (same-source) match — that is safe to merge', () => {
    const existing = { id: 'u1', lyfeId: 'L1', mktrLeadsId: null };
    expect(provenanceConflictField(existing, true, OTHER)).toBeNull();
  });

  it('does NOT flag a clean (sourceless) phone/email match — safe to attach', () => {
    const existing = { id: 'u1', lyfeId: null, mktrLeadsId: null };
    expect(provenanceConflictField(existing, false, OTHER)).toBeNull();
  });

  it('does NOT flag a row that already belongs to THIS source', () => {
    // Syncing mktr_leads, matched a row that already has mktrLeadsId but no
    // lyfeId — not a cross-source conflict (the other-fields list excludes ours).
    const existing = { id: 'u1', lyfeId: null, mktrLeadsId: 'M1' };
    expect(provenanceConflictField(existing, false, OTHER)).toBeNull();
  });

  it('returns null when there is no match at all', () => {
    expect(provenanceConflictField(null, false, OTHER)).toBeNull();
  });

  it('is symmetric — syncing lyfe flags an mktrLeadsId-owned row', () => {
    const existing = { id: 'u1', lyfeId: null, mktrLeadsId: 'M1' };
    expect(provenanceConflictField(existing, false, ['mktrLeadsId'])).toBe('mktrLeadsId');
  });
});
