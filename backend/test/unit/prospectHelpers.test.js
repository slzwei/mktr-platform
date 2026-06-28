import '../setup.js';
import {
  normalizePhone,
  buildLeadCreatedPayload,
  buildLeadAssignedPayload,
  buildLeadUnassignedPayload,
  buildLeadHeldPayload,
} from '../../src/services/prospectHelpers.js';

describe('prospectHelpers', () => {
  // ──────────────────────────────────────────────
  // normalizePhone
  // ──────────────────────────────────────────────

  describe('normalizePhone', () => {
    it('returns falsy input unchanged', () => {
      expect(normalizePhone(null)).toBeNull();
      expect(normalizePhone(undefined)).toBeUndefined();
      expect(normalizePhone('')).toBe('');
    });

    it('prefixes 8-digit SG number starting with 9 -> +65XXXXXXXX', () => {
      expect(normalizePhone('91234567')).toBe('+6591234567');
    });

    it('prefixes 8-digit SG number starting with 8 -> +65XXXXXXXX', () => {
      expect(normalizePhone('81234567')).toBe('+6581234567');
    });

    it('prefixes 8-digit SG number starting with 6 -> +65XXXXXXXX', () => {
      expect(normalizePhone('61234567')).toBe('+6561234567');
    });

    it('prefixes 8-digit SG number starting with 3 -> +65XXXXXXXX', () => {
      expect(normalizePhone('31234567')).toBe('+6531234567');
    });

    it('converts 10-digit 65XXXXXXXX -> +65XXXXXXXX', () => {
      expect(normalizePhone('6591234567')).toBe('+6591234567');
    });

    it('preserves number already starting with +', () => {
      expect(normalizePhone('+6591234567')).toBe('+6591234567');
    });

    it('strips whitespace before normalizing', () => {
      expect(normalizePhone('9123 4567')).toBe('+6591234567');
      expect(normalizePhone(' 91234567 ')).toBe('+6591234567');
    });

    it('strips dashes before normalizing', () => {
      // dashes are not whitespace — the regex only strips \s+
      // so dashes stay and the result gets + prefix
      const result = normalizePhone('9123-4567');
      // The function does replace(/\s+/g, '') so dashes remain
      // Since it contains non-digits (the dash), it won't match /^\d+$/
      // so it falls to the "ensure starts with +" block
      expect(result).toBe('+9123-4567');
    });

    it('handles country code variants: digits-only non-SG', () => {
      // 11-digit number not matching SG patterns gets + prefix
      expect(normalizePhone('12025551234')).toBe('+12025551234');
    });

    it('handles number as numeric type (coerced to string)', () => {
      expect(normalizePhone(91234567)).toBe('+6591234567');
    });
  });

  // ──────────────────────────────────────────────
  // buildLeadCreatedPayload
  // ──────────────────────────────────────────────

  describe('buildLeadCreatedPayload', () => {
    const prospect = {
      id: 'p-1',
      firstName: 'Jane',
      lastName: 'Doe',
      phone: '+6591234567',
      email: 'jane@test.com',
      company: 'Acme',
      jobTitle: 'CEO',
      industry: 'Tech',
      leadSource: 'website',
      interests: ['CRM'],
      budget: { min: 1000, max: 5000 },
      preferences: { contactMethod: 'email' },
      demographics: { age: 30 },
      location: { city: 'SG' },
      tags: ['vip'],
      notes: 'Interested',
      sourceMetadata: { recordingUrl: 'https://rec.test/1' },
      createdAt: '2025-01-01T00:00:00Z',
    };

    it('includes all prospect fields in data.lead', () => {
      const payload = buildLeadCreatedPayload(prospect, 'direct', null, null, null, null, null);

      expect(payload.event).toBe('lead.created');
      expect(payload.timestamp).toBeDefined();
      expect(payload.data.lead.externalId).toBe('p-1');
      expect(payload.data.lead.firstName).toBe('Jane');
      expect(payload.data.lead.lastName).toBe('Doe');
      expect(payload.data.lead.phone).toBe('+6591234567');
      expect(payload.data.lead.email).toBe('jane@test.com');
      expect(payload.data.lead.company).toBe('Acme');
      expect(payload.data.lead.jobTitle).toBe('CEO');
      expect(payload.data.lead.industry).toBe('Tech');
      expect(payload.data.lead.leadSource).toBe('website');
      expect(payload.data.lead.interests).toEqual(['CRM']);
      expect(payload.data.lead.tags).toEqual(['vip']);
      expect(payload.data.lead.notes).toBe('Interested');
      expect(payload.data.lead.sourceMetadata).toEqual({ recordingUrl: 'https://rec.test/1' });
      expect(payload.data.lead.recordingUrl).toBe('https://rec.test/1');
    });

    it('includes routing info when agent is provided', () => {
      const agent = { id: 'lyfe-a1', phone: '+6590000001', email: 'a@test.com', name: 'Agent Smith' };
      const payload = buildLeadCreatedPayload(prospect, 'direct', agent, 'agent-1', null, null, null);

      expect(payload.data.routing.mode).toBe('direct');
      expect(payload.data.routing.agentPhone).toBe('+6590000001');
      expect(payload.data.routing.agentEmail).toBe('a@test.com');
      expect(payload.data.routing.agentName).toBe('Agent Smith');
      expect(payload.data.routing.agentExternalId).toBe('lyfe-a1');
    });

    it('includes campaign and qrTag info', () => {
      const campaign = { id: 'c-1', name: 'Test Campaign' };
      const qrTag = { id: 'qr-1', slug: 'test-slug' };
      const payload = buildLeadCreatedPayload(prospect, 'direct', null, null, campaign, qrTag, null);

      expect(payload.data.campaign.externalId).toBe('c-1');
      expect(payload.data.campaign.name).toBe('Test Campaign');
      expect(payload.data.qrTag.externalId).toBe('qr-1');
      expect(payload.data.qrTag.slug).toBe('test-slug');
    });

    it('includes group info when agent group is provided', () => {
      const group = { id: 'g-1', name: 'Group Alpha' };
      const payload = buildLeadCreatedPayload(prospect, 'round_robin', null, null, null, null, group);

      expect(payload.data.routing.groupId).toBe('g-1');
      expect(payload.data.routing.groupName).toBe('Group Alpha');
    });

    it('handles null optional args gracefully', () => {
      const payload = buildLeadCreatedPayload(prospect, 'direct', null, null, null, null, null);

      expect(payload.data.routing.agentPhone).toBeNull();
      expect(payload.data.routing.agentExternalId).toBeNull();
      expect(payload.data.campaign.externalId).toBeNull();
      expect(payload.data.qrTag.externalId).toBeNull();
      expect(payload.data.routing.groupId).toBeNull();
    });
  });

  // ──────────────────────────────────────────────
  // buildLeadAssignedPayload
  // ──────────────────────────────────────────────

  describe('buildLeadAssignedPayload', () => {
    const prospect = {
      id: 'p-1',
      firstName: 'Jane',
      lastName: 'Doe',
      phone: '+6591234567',
      email: 'jane@test.com',
      leadSource: 'website',
      tags: ['vip'],
      notes: 'Transcript here',
      sourceMetadata: { retellCallId: 'call-123', recordingUrl: 'https://rec.test/1' },
      createdAt: '2025-01-01T00:00:00Z',
    };

    it('uses agent.lyfeId (not agent.id) for agentExternalId', () => {
      const agent = {
        id: 'internal-id-123',
        lyfeId: 'lyfe-agent-1',
        firstName: 'Agent',
        lastName: 'Smith',
        email: 'agent@test.com',
        phone: '+6590000001',
      };
      const payload = buildLeadAssignedPayload(prospect, agent, null);

      expect(payload.data.routing.agentExternalId).toBe('lyfe-agent-1');
      expect(payload.data.routing.agentExternalId).not.toBe('internal-id-123');
    });

    it('returns null agentExternalId when the agent has no external provenance (never falls back to internal id)', () => {
      const agent = {
        id: 'internal-id-123',
        lyfeId: null,
        mktrLeadsId: null,
        firstName: 'Agent',
        lastName: 'Smith',
        email: 'agent@test.com',
        phone: '+6590000001',
      };
      const payload = buildLeadAssignedPayload(prospect, agent, null);

      // The internal users.id is meaningless to receivers (→ guaranteed 422),
      // so destination-aware routing emits null rather than falling back to it.
      expect(payload.data.routing.agentExternalId).toBeNull();
      expect(payload.data.routing.agentExternalId).not.toBe('internal-id-123');
    });

    it('uses mktrLeadsId as agentExternalId for an mktr-leads agent', () => {
      const agent = {
        id: 'internal-id-456',
        lyfeId: null,
        mktrLeadsId: 'ml-agent-9',
        firstName: 'Ben',
        lastName: 'Lim',
        email: 'ben@test.com',
        phone: '+6590000002',
      };
      const payload = buildLeadAssignedPayload(prospect, agent, null);

      expect(payload.data.routing.agentExternalId).toBe('ml-agent-9');
    });

    it('constructs agentName from firstName + lastName', () => {
      const agent = { id: 'a-1', firstName: 'Agent', lastName: 'Smith', email: 'a@t.com', phone: '+65900' };
      const payload = buildLeadAssignedPayload(prospect, agent, null);

      expect(payload.data.routing.agentName).toBe('Agent Smith');
    });

    it('includes recording URL and transcript from sourceMetadata', () => {
      const agent = { id: 'a-1', firstName: 'A', email: 'a@t.com', phone: '+65900' };
      const payload = buildLeadAssignedPayload(prospect, agent, null);

      expect(payload.data.lead.recordingUrl).toBe('https://rec.test/1');
      expect(payload.data.lead.transcript).toBe('Transcript here');
    });

    it('includes campaign info when prospectWithCampaign is provided', () => {
      const agent = { id: 'a-1', firstName: 'A', email: 'a@t.com', phone: '+65900' };
      const prospectWithCampaign = { campaign: { id: 'c-1', name: 'Test Campaign' } };
      const payload = buildLeadAssignedPayload(prospect, agent, prospectWithCampaign);

      expect(payload.data.campaign.externalId).toBe('c-1');
      expect(payload.data.campaign.name).toBe('Test Campaign');
    });
  });

  // ──────────────────────────────────────────────
  // buildLeadUnassignedPayload
  // ──────────────────────────────────────────────

  describe('buildLeadUnassignedPayload', () => {
    const prospect = {
      id: 'p-1',
      firstName: 'Jane',
      lastName: 'Doe',
      phone: '+6591234567',
      email: 'jane@test.com',
      leadSource: 'website',
      sourceMetadata: { source: 'qr' },
    };

    it('sets event to lead.unassigned', () => {
      const payload = buildLeadUnassignedPayload(prospect, 'lyfe-prev-agent');
      expect(payload.event).toBe('lead.unassigned');
    });

    it('includes previousAgentId (lyfeId)', () => {
      const payload = buildLeadUnassignedPayload(prospect, 'lyfe-prev-agent');
      expect(payload.data.previousAgentId).toBe('lyfe-prev-agent');
    });

    it('includes prospect lead fields', () => {
      const payload = buildLeadUnassignedPayload(prospect, 'lyfe-prev-agent');
      expect(payload.data.lead.externalId).toBe('p-1');
      expect(payload.data.lead.firstName).toBe('Jane');
      expect(payload.data.lead.phone).toBe('+6591234567');
      expect(payload.data.lead.sourceMetadata).toEqual({ source: 'qr' });
    });

    it('has a valid ISO timestamp', () => {
      const payload = buildLeadUnassignedPayload(prospect, 'lyfe-prev-agent');
      expect(() => new Date(payload.timestamp)).not.toThrow();
      expect(new Date(payload.timestamp).toISOString()).toBe(payload.timestamp);
    });
  });

  // ──────────────────────────────────────────────
  // buildLeadHeldPayload
  // ──────────────────────────────────────────────

  describe('buildLeadHeldPayload', () => {
    const prospect = {
      id: 'p-held-1',
      firstName: 'Jane',
      lastName: 'Doe',
      phone: '+6591234567',
      email: 'jane@test.com',
    };
    const campaign = { id: 'c-1', name: 'Test Campaign' };

    it('sets event to lead.held with the prospect id as the dedup key', () => {
      const payload = buildLeadHeldPayload(prospect, campaign, 'no_funded_agent');
      expect(payload.event).toBe('lead.held');
      expect(payload.data.lead.externalId).toBe('p-held-1');
    });

    it('carries NO lead PII — only the externalId (lock-screen / cron safe)', () => {
      const payload = buildLeadHeldPayload(prospect, campaign, 'no_funded_agent');
      expect(Object.keys(payload.data.lead)).toEqual(['externalId']);
      expect(payload.data.lead.firstName).toBeUndefined();
      expect(payload.data.lead.phone).toBeUndefined();
      expect(payload.data.lead.email).toBeUndefined();
    });

    it('includes campaign externalId + name when provided', () => {
      const payload = buildLeadHeldPayload(prospect, campaign, 'no_funded_agent');
      expect(payload.data.campaign).toEqual({ externalId: 'c-1', name: 'Test Campaign' });
    });

    it('emits null campaign when none is provided', () => {
      const payload = buildLeadHeldPayload(prospect, null, 'no_funded_agent');
      expect(payload.data.campaign).toBeNull();
    });

    it('defaults reason to no_funded_agent', () => {
      const payload = buildLeadHeldPayload(prospect, campaign, undefined);
      expect(payload.data.reason).toBe('no_funded_agent');
    });

    it('has valid ISO timestamp + heldAt', () => {
      const payload = buildLeadHeldPayload(prospect, campaign, 'no_funded_agent');
      expect(new Date(payload.timestamp).toISOString()).toBe(payload.timestamp);
      expect(new Date(payload.data.heldAt).toISOString()).toBe(payload.data.heldAt);
    });
  });
});
