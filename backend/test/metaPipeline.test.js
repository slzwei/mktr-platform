/**
 * Meta Lead Ads pipeline INTEGRATION tests
 * (docs/plans/meta-lead-ads-native-pipe.md §8) — real Postgres, real models,
 * real transactions; only the Graph fetch and the post-commit delivery flush
 * are DI-stubbed. Each test uses its own campaign/form/phone so the shared
 * test DB needs no per-test cleanup.
 *
 * WEBHOOK_ENABLED is flipped on for THIS file only (jest runs each file in
 * its own process) — persistEventDeliveries returns [] with it off, and the
 * whole point here is asserting the transactional outbox rows.
 */
import './setup.js';
process.env.WEBHOOK_ENABLED = 'true';
process.env.META_PAGE_ID = '111222333444555';
process.env.META_PAGE_ACCESS_TOKEN = 'integration-env-token';

import { jest } from '@jest/globals';
import {
  getApp, closeDb, createTestUser, createTestCampaign,
  createTestLeadPackage, createTestLeadPackageAssignment,
} from './helpers.js';
import { Prospect, ProspectActivity, Campaign, WebhookSubscriber,
  WebhookDelivery, MetaLeadgenEvent, MetaFormMapping, ConsentEvent, Consumer,
} from '../src/models/index.js';
import { makeMetaLeadService } from '../src/services/metaLeadService.js';
import { META_LEADGEN_CONSENT_VERSION } from '../src/services/contactConsent.js';

const PAGE_ID = '111222333444555';
let seq = 0;
const nextPhone = () => `+65915${String(++seq).padStart(5, '0')}`;
const nextFormId = () => `9000${String(++seq).padStart(10, '0')}`;
const nextLeadgenId = () => `7000${String(++seq).padStart(10, '0')}`;

let admin;

const graphLead = ({ formId, phone, disclaimerChecked = true, extra = {} }) => ({
  field_data: [
    { name: 'full_name', values: ['Integration Tester'] },
    { name: 'phone_number', values: [phone] },
    { name: 'email', values: [`it-${seq}-${Date.now()}@test.com`] },
    { name: 'best_time_to_call', values: ['weekday evenings'] },
  ],
  form_id: formId,
  ad_id: 'ad-1', adset_id: 'as-1', campaign_id: 'mc-1',
  platform: 'fb', is_organic: false,
  custom_disclaimer_responses: disclaimerChecked === undefined
    ? undefined
    : [{ checkbox_key: 'mktr_pdpa_consent', is_checked: disclaimerChecked }],
  ...extra,
});

function svcWithLead(lead) {
  const flushDeliveries = jest.fn();
  const svc = makeMetaLeadService({
    fetch: jest.fn().mockResolvedValue({ ok: true, json: async () => lead }),
    flushDeliveries,
    sendLeadAssignmentEmail: jest.fn().mockResolvedValue({}),
  });
  return { svc, flushDeliveries };
}

async function enqueueAndDrain(svc, leadgenId, formId) {
  await svc.enqueueLeadgenChanges([{ leadgen_id: leadgenId, page_id: PAGE_ID, form_id: formId, created_time: 1754400000 }]);
  await svc.drainMetaInbox({ batchSize: 5, maxBatches: 2 });
  return MetaLeadgenEvent.findOne({ where: { leadgenId } });
}

async function makeSubscriber(destination) {
  return WebhookSubscriber.create({
    name: `it-sub-${destination}-${Date.now()}-${++seq}`,
    url: 'http://127.0.0.1:9/webhook',
    secret: 'it-secret',
    events: ['lead.created', 'lead.assigned', 'lead.unassigned', 'lead.held', 'lead.deleted'],
    enabled: true,
    metadata: { destination },
  });
}

beforeAll(async () => {
  await getApp(); // boots the schema: baseline restore + migrations (incl. 112-114)
  ({ user: admin } = await createTestUser({ role: 'admin' }));
  // The unmapped held pool bootstrap normally ensures (flag-gated there).
  const existing = await Campaign.findOne({ where: { slug: 'meta-unmapped' } });
  if (!existing) {
    await Campaign.create({
      name: '[Meta] Unmapped', slug: 'meta-unmapped', status: 'active', is_active: true,
      enforceLeadQuota: true, externalEligible: false, createdBy: admin.id, type: 'lead_generation',
    });
  }
});

afterAll(async () => {
  await closeDb();
});

// Each test drains the SHARED inbox — a pending row left by an earlier test
// would be claimed by the next test's drain (with the wrong fetch mock) and
// poison its assertions. Start every test with an empty pending queue.
beforeEach(async () => {
  await MetaLeadgenEvent.destroy({ where: { status: 'pending' } });
});

describe('Meta Lead Ads pipeline (integration)', () => {
  test('webhook enqueue is idempotent on leadgenId', async () => {
    const { svc } = svcWithLead({});
    const leadgenId = nextLeadgenId();
    const first = await svc.enqueueLeadgenChanges([{ leadgen_id: leadgenId, page_id: PAGE_ID, form_id: 'f', created_time: 1 }]);
    const second = await svc.enqueueLeadgenChanges([{ leadgen_id: leadgenId, page_id: PAGE_ID, form_id: 'f', created_time: 1 }]);
    expect(first).toBe(1);
    expect(second).toBe(0);
    expect(await MetaLeadgenEvent.count({ where: { leadgenId } })).toBe(1);
  });

  test('mapped form + funded mktr-leads agent: prospect, consent ledger, outbox delivery, completed inbox', async () => {
    const sub = await makeSubscriber('mktr_leads');
    const campaign = await createTestCampaign(admin.id, { name: `Meta IT ${Date.now()}` });
    const { user: agent } = await createTestUser({ role: 'agent', mktrLeadsId: '550e8400-e29b-41d4-a716-446655440001' });
    const pkg = await createTestLeadPackage(campaign.id, admin.id);
    await createTestLeadPackageAssignment(agent.id, pkg.id, { leadsRemaining: 5, status: 'active' });
    const formId = nextFormId();
    await MetaFormMapping.create({ formId, formName: 'IT Form', campaignId: campaign.id, isActive: true });

    const phone = nextPhone();
    const { svc, flushDeliveries } = svcWithLead(graphLead({ formId, phone }));
    const leadgenId = nextLeadgenId();
    const inboxRow = await enqueueAndDrain(svc, leadgenId, formId);

    expect(inboxRow.status).toBe('completed');
    const prospect = await Prospect.findByPk(inboxRow.prospectId);
    expect(prospect).toMatchObject({
      leadSource: 'social_media',
      phone,
      campaignId: campaign.id,
      assignedAgentId: agent.id,
      quarantinedAt: null,
    });
    expect(prospect.sourceMetadata).toMatchObject({
      metaLeadgenId: leadgenId,
      metaPageId: PAGE_ID,
      metaFormId: formId,
      metaPlatform: 'fb',
      utm: { utm_source: 'fb', utm_medium: 'lead_ads', utm_campaign: 'IT Form' },
      consent_contact: true,
      consent_copy_version: META_LEADGEN_CONSENT_VERSION,
    });
    expect(prospect.notes).toContain('best_time_to_call: weekday evenings');

    // Consumer spine + consent ledger (source meta_lead_ad, verified false).
    const consumer = await Consumer.findByPk(prospect.consumerId);
    expect(consumer).toBeTruthy();
    const events = await ConsentEvent.findAll({ where: { prospectId: prospect.id, kind: 'contact' } });
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0]).toMatchObject({
      granted: true, source: 'meta_lead_ad', verified: false, version: META_LEADGEN_CONSENT_VERSION,
    });

    // Transactional outbox: the delivery row exists for the mktr_leads
    // subscriber, and the flush hook fired post-commit.
    const deliveries = await WebhookDelivery.findAll({ where: { subscriberId: sub.id, eventType: 'lead.created' } });
    expect(deliveries).toHaveLength(1);
    expect(flushDeliveries).toHaveBeenCalledTimes(1);

    const activity = await ProspectActivity.findOne({ where: { prospectId: prospect.id, type: 'created' } });
    expect(activity.metadata).toMatchObject({ source: 'meta_webhook', leadgenId });
  });

  test('lyfe-provenance agent routes the delivery to the lyfe destination', async () => {
    const sub = await makeSubscriber('lyfe');
    const campaign = await createTestCampaign(admin.id, { name: `Meta IT lyfe ${Date.now()}` });
    const { user: agent } = await createTestUser({ role: 'agent', lyfeId: '550e8400-e29b-41d4-a716-446655440002' });
    const pkg = await createTestLeadPackage(campaign.id, admin.id);
    await createTestLeadPackageAssignment(agent.id, pkg.id, { leadsRemaining: 5, status: 'active' });
    const formId = nextFormId();
    await MetaFormMapping.create({ formId, formName: 'IT Lyfe Form', campaignId: campaign.id, isActive: true });

    const { svc } = svcWithLead(graphLead({ formId, phone: nextPhone() }));
    const inboxRow = await enqueueAndDrain(svc, nextLeadgenId(), formId);

    expect(inboxRow.status).toBe('completed');
    const deliveries = await WebhookDelivery.findAll({ where: { subscriberId: sub.id, eventType: 'lead.created' } });
    expect(deliveries).toHaveLength(1);
  });

  test('unmapped form quarantines into the [Meta] Unmapped held pool — never the System Agent', async () => {
    const formId = nextFormId(); // deliberately NOT mapped
    const { svc } = svcWithLead(graphLead({ formId, phone: nextPhone() }));
    const inboxRow = await enqueueAndDrain(svc, nextLeadgenId(), formId);

    expect(inboxRow.status).toBe('completed');
    const prospect = await Prospect.findByPk(inboxRow.prospectId);
    const pool = await Campaign.findOne({ where: { slug: 'meta-unmapped' } });
    expect(prospect.campaignId).toBe(pool.id);
    expect(prospect.assignedAgentId).toBeNull();
    expect(prospect.quarantineReason).toBe('no_funded_agent');
    expect(prospect.quarantinedAt).not.toBeNull();
  });

  test('duplicate phone in the same campaign becomes an activity on the winner, not a second prospect', async () => {
    const campaign = await createTestCampaign(admin.id, { name: `Meta IT dup ${Date.now()}` });
    const { user: agent } = await createTestUser({ role: 'agent', mktrLeadsId: '550e8400-e29b-41d4-a716-446655440003' });
    const pkg = await createTestLeadPackage(campaign.id, admin.id);
    await createTestLeadPackageAssignment(agent.id, pkg.id, { leadsRemaining: 5, status: 'active' });
    await makeSubscriber('mktr_leads');
    const formId = nextFormId();
    await MetaFormMapping.create({ formId, formName: 'IT Dup Form', campaignId: campaign.id, isActive: true });

    const phone = nextPhone();
    const { svc: svc1 } = svcWithLead(graphLead({ formId, phone }));
    const firstRow = await enqueueAndDrain(svc1, nextLeadgenId(), formId);
    expect(firstRow.status).toBe('completed');

    const { svc: svc2 } = svcWithLead(graphLead({ formId, phone }));
    const secondRow = await enqueueAndDrain(svc2, nextLeadgenId(), formId);

    expect(secondRow.status).toBe('duplicate');
    expect(secondRow.prospectId).toBe(firstRow.prospectId);
    expect(await Prospect.count({ where: { campaignId: campaign.id, phone } })).toBe(1);
    const note = await ProspectActivity.findOne({ where: { prospectId: firstRow.prospectId, type: 'updated' } });
    expect(note.description).toContain('Duplicate Meta form submission');
  });

  test('frozen lead.created payload contract for the mktr-leads receiver', async () => {
    // The receiver (mktr-leads receive-mktr-lead EF) reads leadSource +
    // sourceMetadata.utm.utm_source to label/badge the lead — this pins the
    // wire shape so backend drift is caught HERE, not on a phone.
    const sub = await makeSubscriber('mktr_leads');
    const campaign = await createTestCampaign(admin.id, { name: `Meta IT contract ${Date.now()}` });
    const { user: agent } = await createTestUser({ role: 'agent', mktrLeadsId: '550e8400-e29b-41d4-a716-446655440004' });
    const pkg = await createTestLeadPackage(campaign.id, admin.id);
    await createTestLeadPackageAssignment(agent.id, pkg.id, { leadsRemaining: 5, status: 'active' });
    const formId = nextFormId();
    await MetaFormMapping.create({ formId, formName: 'Contract Form', campaignId: campaign.id, isActive: true });

    const { svc } = svcWithLead(graphLead({ formId, phone: nextPhone(), extra: { platform: 'ig' } }));
    await enqueueAndDrain(svc, nextLeadgenId(), formId);

    const delivery = await WebhookDelivery.findOne({ where: { subscriberId: sub.id, eventType: 'lead.created' } });
    const payload = delivery.payload;
    expect(payload.event).toBe('lead.created');
    expect(payload.data.lead).toMatchObject({ leadSource: 'social_media' });
    expect(payload.data.lead.sourceMetadata.utm.utm_source).toBe('ig');
    expect(payload.data.lead.sourceMetadata.metaLeadgenId).toBeTruthy();
    expect(payload.data.routing).toMatchObject({ mode: 'meta_lead_ad' });
    expect(payload.data.routing.agentExternalId).toBe(agent.mktrLeadsId);
    expect(payload.data.campaign).toMatchObject({ externalId: campaign.id, name: campaign.name });
  });
});
