import { describe, it, expect } from 'vitest';
import { buildTimeline, normalizeLeadActivity, normalizeProspectActivity } from '../leadTimeline';

describe('leadTimeline — web normalizers (canonical model, parity with the app)', () => {
  it('maps ProspectActivity kinds (created/assigned/reassigned/returned/held/viewed)', () => {
    expect(normalizeProspectActivity({ id: 'm1', type: 'created', description: 'Signed up', createdAt: 't' }).kind).toBe('lead_created');
    expect(normalizeProspectActivity({ id: 'm2', type: 'assigned', description: 'Assigned to X', createdAt: 't' }).kind).toBe('assigned');
    // real single reassign logs previousAgentId (no flag) — still 'reassigned'
    expect(normalizeProspectActivity({ id: 'm3', type: 'assigned', metadata: { previousAgentId: 'a' }, description: 'x', createdAt: 't' }).kind).toBe('reassigned');
    expect(normalizeProspectActivity({ id: 'm4', type: 'assigned', metadata: { returnedToHeld: true }, description: 'x', createdAt: 't' }).kind).toBe('returned');
    expect(normalizeProspectActivity({ id: 'm5', type: 'updated', description: 'Held — no funded agent', createdAt: 't' }).kind).toBe('held');
    expect(normalizeProspectActivity({ id: 'm6', type: 'viewed', description: '', createdAt: 't' }).kind).toBe('viewed');
    // description is the title; falls back to the kind label when absent
    expect(normalizeProspectActivity({ id: 'm6', type: 'viewed', description: '', createdAt: 't' }).title).toBe('Viewed');
  });

  it('maps lead_activities kinds, keeps note/outcome, drops config rows', () => {
    expect(normalizeLeadActivity({ id: 'a1', type: 'follow_up', created_at: 't' })).toBeNull();
    expect(normalizeLeadActivity({ id: 'k', type: 'key_facts', created_at: 't' })).toBeNull();
    expect(normalizeLeadActivity({ id: 'a2', type: 'call', description: 'Spoke', metadata: { outcome: 'Interested' }, created_at: 't' })).toMatchObject({
      kind: 'call',
      note: 'Spoke',
      outcome: 'Interested',
    });
    expect(normalizeLeadActivity({ id: 'a3', type: 'status', description: 'Marked as Disputed', created_at: 't' }).kind).toBe('disputed');
    expect(normalizeLeadActivity({ id: 'a4', type: 'unassignment', metadata: { returned_to_held: true }, created_at: 't' }).kind).toBe('returned');
    expect(normalizeLeadActivity({ id: 'a5', type: 'some_future_type', created_at: 't' }).kind).toBe('updated');
  });

  it('buildTimeline merges tagged rows by origin, preserving the backend order', () => {
    const details = {
      timeline: [
        { origin: 'mktr', row: { id: 'm1', type: 'updated', description: 'Held — out', metadata: { quarantined: true }, createdAt: 't2' } },
        { origin: 'app', row: { id: 'a1', type: 'call', description: 'Spoke', metadata: {}, created_at: 't1' } },
      ],
    };
    expect(buildTimeline(details).map((e) => [e.kind, e.id])).toEqual([
      ['held', 'm1'],
      ['call', 'a1'],
    ]);
  });

  it('buildTimeline falls back to ProspectActivity-only when no merged timeline is present', () => {
    const details = { activities: [{ id: 'm1', type: 'created', description: 'Signed up', createdAt: 't' }] };
    expect(buildTimeline(details).map((e) => e.kind)).toEqual(['lead_created']);
    expect(buildTimeline(null)).toEqual([]);
  });
});
