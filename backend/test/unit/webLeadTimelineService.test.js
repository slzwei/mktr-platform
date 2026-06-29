/**
 * Unit tests for the web unified-timeline merge (Phase 2). mergeProspectTimeline is pure —
 * it dedups the cross-mirror rows (both directions) ONLY when the Supabase half answered, and
 * sorts newest-first with a deterministic id tie-break.
 */
import { mergeProspectTimeline } from '../../src/services/webLeadTimelineService.js';

const mktr = [
  { id: 'm1', type: 'created', description: 'Signed up', metadata: {}, createdAt: '2026-06-28T08:00:00Z' },
  // app→MKTR outcome mirror (tagged source='mktr-leads') — a dup of the app's own status/won row.
  { id: 'm2', type: 'updated', description: 'Marked won', metadata: { source: 'mktr-leads' }, createdAt: '2026-06-28T11:00:00Z' },
];
const app = [
  { id: 'a1', type: 'call', description: 'Spoke', metadata: { outcome: 'Interested' }, created_at: '2026-06-28T09:00:00Z' },
  // MKTR→app mirror (tagged source='mktr') — a dup of MKTR's own created/assigned row.
  { id: 'a2', type: 'created', description: 'Lead received from MKTR', metadata: { source: 'mktr' }, created_at: '2026-06-28T08:00:01Z' },
];

describe('mergeProspectTimeline', () => {
  it('dedups BOTH cross-mirror directions and sorts newest-first when both stores answered', () => {
    const merged = mergeProspectTimeline(mktr, app, { ok: true });
    // m2 (source=mktr-leads) + a2 (source=mktr) dropped → engagement call + MKTR created remain.
    expect(merged.map((x) => [x.origin, x.row.id])).toEqual([
      ['app', 'a1'], // 09:00
      ['mktr', 'm1'], // 08:00
    ]);
  });

  it('keeps ALL ProspectActivity (incl. outcome mirrors) when the Supabase half missed (degrade)', () => {
    const merged = mergeProspectTimeline(mktr, [], { ok: false });
    expect(merged.map((x) => x.row.id)).toEqual(['m2', 'm1']); // both kept, newest-first
  });

  it('breaks same-instant cross-DB ties deterministically by id', () => {
    const a = [{ id: 'aa', type: 'note', metadata: {}, created_at: '2026-06-28T10:00:00Z' }];
    const m = [{ id: 'zz', type: 'viewed', metadata: {}, createdAt: '2026-06-28T10:00:00Z' }];
    expect(mergeProspectTimeline(m, a, { ok: true }).map((x) => x.row.id)).toEqual(['zz', 'aa']);
  });

  it('tolerates empty / nullish inputs', () => {
    expect(mergeProspectTimeline(null, null, {})).toEqual([]);
    expect(mergeProspectTimeline([], [], { ok: true })).toEqual([]);
  });
});
