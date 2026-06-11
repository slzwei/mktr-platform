import { describe, it, expect } from 'vitest';
import {
  agentSource,
  isLyfeAgent,
  isMktrLeadsAgent,
  isLocalAgent,
  sourceBadge,
  AGENT_SOURCES,
} from '../agentSource';

describe('agentSource', () => {
  it('maps lyfeId → lyfe', () => {
    expect(agentSource({ lyfeId: 'L1' })).toBe(AGENT_SOURCES.LYFE);
    expect(isLyfeAgent({ lyfeId: 'L1' })).toBe(true);
  });

  it('maps mktrLeadsId → mktr_leads', () => {
    expect(agentSource({ mktrLeadsId: 'M1' })).toBe(AGENT_SOURCES.MKTR_LEADS);
    expect(isMktrLeadsAgent({ mktrLeadsId: 'M1' })).toBe(true);
  });

  it('maps no provenance → local (incl. null/undefined agent)', () => {
    expect(agentSource({ id: 'u1' })).toBe(AGENT_SOURCES.LOCAL);
    expect(agentSource(null)).toBe(AGENT_SOURCES.LOCAL);
    expect(isLocalAgent({ id: 'u1', lyfeId: null, mktrLeadsId: null })).toBe(true);
  });

  it('sourceBadge labels each source distinctly', () => {
    expect(sourceBadge({ lyfeId: 'L1' }).label).toBe('Lyfe');
    expect(sourceBadge({ mktrLeadsId: 'M1' }).label).toBe('MKTR Leads');
    expect(sourceBadge({}).label).toBe('Local');
  });
});
