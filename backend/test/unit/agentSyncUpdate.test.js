import '../setup.js';
import { computeSyncUpdate } from '../../src/services/agentSyncService.js';

/**
 * Pure tests for the per-adapter update semantics:
 *   - Lyfe (legacy): fill-only-when-null, @placeholder.local replacement,
 *     NO isActive key ever (absence-based deactivation handles it).
 *   - mktr-leads (mirrorsIsActive + authoritativeProfile): is_active mirrored
 *     both ways; fullName/email/companyName overwritten from upstream.
 */

const LYFE = { id: 'lyfe', localIdField: 'lyfeId' };
const MKTR_LEADS = {
  id: 'mktr_leads',
  localIdField: 'mktrLeadsId',
  mirrorsIsActive: true,
  authoritativeProfile: true,
};

const baseExisting = {
  id: 'u1',
  lyfeId: null,
  mktrLeadsId: 'M1',
  phone: '6591234567',
  email: 'old@x.com',
  firstName: 'Old',
  lastName: 'Name',
  fullName: 'Old Name',
  companyName: null,
  isActive: true,
  external_role: 'agent',
  pending_deletion_at: null,
};

describe('computeSyncUpdate — legacy (Lyfe) fill-only semantics', () => {
  const existing = { ...baseExisting, lyfeId: 'L1', mktrLeadsId: null };

  it('does NOT overwrite an existing fullName or real email', () => {
    const upd = computeSyncUpdate({
      adapter: LYFE,
      existing,
      ea: { externalId: 'L1', fullName: 'New Name', email: 'new@x.com', externalRole: 'agent', isActive: true },
      normalizedPhone: '6591234567',
    });
    expect(upd.fullName).toBeUndefined();
    expect(upd.email).toBeUndefined();
  });

  it('fills a null fullName and replaces @placeholder.local emails', () => {
    const upd = computeSyncUpdate({
      adapter: LYFE,
      existing: { ...existing, fullName: null, email: 'x@placeholder.local' },
      ea: { externalId: 'L1', fullName: 'New Name', email: 'real@x.com', isActive: true },
      normalizedPhone: '6591234567',
    });
    expect(upd.fullName).toBe('New Name');
    expect(upd.email).toBe('real@x.com');
    // Legacy fill never re-derives first/last (pre-existing behaviour).
    expect(upd.firstName).toBeUndefined();
  });

  it('never emits isActive (absence-based deactivation owns it)', () => {
    const upd = computeSyncUpdate({
      adapter: LYFE,
      existing: { ...existing, isActive: false },
      ea: { externalId: 'L1', fullName: 'Old Name', isActive: true },
      normalizedPhone: '6591234567',
    });
    expect(upd.isActive).toBeUndefined();
  });
});

describe('computeSyncUpdate — mktr-leads mirror + authoritative semantics', () => {
  it('mirrors is_active=false (deactivation) and =true (reactivation)', () => {
    const deact = computeSyncUpdate({
      adapter: MKTR_LEADS,
      existing: baseExisting,
      ea: { externalId: 'M1', fullName: 'Old Name', email: 'old@x.com', isActive: false },
      normalizedPhone: '6591234567',
    });
    expect(deact.isActive).toBe(false);

    const react = computeSyncUpdate({
      adapter: MKTR_LEADS,
      existing: { ...baseExisting, isActive: false },
      ea: { externalId: 'M1', fullName: 'Old Name', email: 'old@x.com', isActive: true },
      normalizedPhone: '6591234567',
    });
    expect(react.isActive).toBe(true);
  });

  it('overwrites fullName (re-deriving first/last) and email when upstream differs', () => {
    const upd = computeSyncUpdate({
      adapter: MKTR_LEADS,
      existing: baseExisting,
      ea: { externalId: 'M1', fullName: 'Ada Mei Tan', email: 'ada@x.com', isActive: true },
      normalizedPhone: '6591234567',
    });
    expect(upd.fullName).toBe('Ada Mei Tan');
    expect(upd.firstName).toBe('Ada');
    expect(upd.lastName).toBe('Mei Tan');
    expect(upd.email).toBe('ada@x.com');
  });

  it('never nulls-out email even when authoritative (upstream null ≠ clear)', () => {
    const upd = computeSyncUpdate({
      adapter: MKTR_LEADS,
      existing: baseExisting,
      ea: { externalId: 'M1', fullName: 'Old Name', email: null, isActive: true },
      normalizedPhone: '6591234567',
    });
    expect(upd.email).toBeUndefined();
  });

  it('mirrors agency → companyName, including clearing it', () => {
    const set = computeSyncUpdate({
      adapter: MKTR_LEADS,
      existing: baseExisting,
      ea: { externalId: 'M1', fullName: 'Old Name', email: 'old@x.com', agency: 'Acme', isActive: true },
      normalizedPhone: '6591234567',
    });
    expect(set.companyName).toBe('Acme');

    const clear = computeSyncUpdate({
      adapter: MKTR_LEADS,
      existing: { ...baseExisting, companyName: 'Acme' },
      ea: { externalId: 'M1', fullName: 'Old Name', email: 'old@x.com', agency: null, isActive: true },
      normalizedPhone: '6591234567',
    });
    expect(clear.companyName).toBeNull();
  });

  it('keeps phone fill-only even when authoritative (matching key)', () => {
    const upd = computeSyncUpdate({
      adapter: MKTR_LEADS,
      existing: baseExisting,
      ea: { externalId: 'M1', fullName: 'Old Name', email: 'old@x.com', phone: '6599999999', isActive: true },
      normalizedPhone: '6599999999',
    });
    expect(upd.phone).toBeUndefined();
  });

  it('clears pending_deletion_at whenever the agent is present upstream (even inactive)', () => {
    const upd = computeSyncUpdate({
      adapter: MKTR_LEADS,
      existing: { ...baseExisting, isActive: false, pending_deletion_at: new Date() },
      ea: { externalId: 'M1', fullName: 'Old Name', email: 'old@x.com', isActive: false },
      normalizedPhone: '6591234567',
    });
    expect(upd.pending_deletion_at).toBeNull();
  });

  it('returns {} when nothing differs (counted as skipped, no write)', () => {
    const upd = computeSyncUpdate({
      adapter: MKTR_LEADS,
      existing: baseExisting,
      ea: {
        externalId: 'M1', fullName: 'Old Name', email: 'old@x.com',
        externalRole: 'agent', agency: null, isActive: true, phone: '6591234567',
      },
      normalizedPhone: '6591234567',
    });
    expect(upd).toEqual({});
  });
});
