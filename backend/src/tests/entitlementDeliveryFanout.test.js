import { makeEntitlementService, flushDeliveries } from '../services/redeemOps/entitlementService.js';

// Trial-reward PR E — the per-channel delivery fan-out contract, DB-free:
// queueDelivery is exercised directly (exported for exactly this) with fake
// senders + a fake RedemptionEvent, and flushDeliveries() is the barrier.
// The three promises of the contract:
//   1. email and WhatsApp are INDEPENDENT (one failing never blocks the other),
//   2. the boolean return stays PR A's `emailQueued` (WhatsApp never affects it),
//   3. receipts are truthful per channel; `skipped` writes none.

const entitlement = { id: 'ent-1' };
const emailable = { email: 'sarah@example.com', phone: '+6591234567', sourceMetadata: { consent_contact: true } };
const retellLead = { email: null, phone: '+6591234567', sourceMetadata: { consent_contact: true } };
const silentLogger = { error: () => {}, warn: () => {}, info: () => {} };

function makeSvc({ events, email = null, wa = null, emailReservation = null, waReservation = null }) {
  return makeEntitlementService({
    RedemptionEvent: { create: async (row) => { events.push(row); return row; } },
    notifyUnlock: email,
    notifyReservation: emailReservation,
    notifyUnlockWa: wa,
    notifyReservationWa: waReservation,
    logger: silentLogger,
  });
}

const receiptsBy = (events, channel) => events.filter((e) => e.metadata?.channel === channel);

describe('queueDelivery — per-channel fan-out (PR E)', () => {
  it('email sender throwing never blocks the WhatsApp leg (and vice-versa receipts are truthful)', async () => {
    const events = [];
    const svc = makeSvc({
      events,
      email: async () => { throw new Error('smtp down'); },
      wa: async () => ({ sent: true, to: '••••4567' }),
    });
    const queued = svc.queueDelivery({ entitlement, prospect: emailable, kind: 'voucher', voucherToken: 'v' });
    expect(queued).toBe(true); // a fresh EMAIL attempt was scheduled (it later failed)
    await flushDeliveries();

    const em = receiptsBy(events, 'email');
    const wa = receiptsBy(events, 'whatsapp');
    expect(em.length).toBe(1);
    expect(em[0].type).toBe('notify_failed');
    expect(em[0].metadata.error).toContain('smtp down');
    expect(wa.length).toBe(1);
    expect(wa[0].type).toBe('notified');
    expect(wa[0].metadata).toMatchObject({ kind: 'voucher', channel: 'whatsapp', to: '••••4567' });
  });

  it('WhatsApp sender rejecting never blocks the email leg', async () => {
    const events = [];
    const svc = makeSvc({
      events,
      email: async () => ({ sent: true, to: 's***@example.com' }),
      wa: async () => { throw new Error('graph 500'); },
    });
    expect(svc.queueDelivery({ entitlement, prospect: emailable, kind: 'voucher', voucherToken: 'v' })).toBe(true);
    await flushDeliveries();

    expect(receiptsBy(events, 'email')[0].type).toBe('notified');
    const wa = receiptsBy(events, 'whatsapp')[0];
    expect(wa.type).toBe('notify_failed');
    expect(wa.metadata.error).toContain('graph 500');
  });

  it('no-email lead (Retell): returns false, email never called, WhatsApp STILL fires', async () => {
    const events = [];
    let emailCalls = 0;
    const svc = makeSvc({
      events,
      email: async () => { emailCalls += 1; return { sent: true, to: 'x' }; },
      wa: async () => ({ sent: true, to: '••••4567' }),
    });
    const queued = svc.queueDelivery({ entitlement, prospect: retellLead, kind: 'voucher', voucherToken: 'v' });
    expect(queued).toBe(false); // emailQueued contract: no fresh email attempt
    await flushDeliveries();

    expect(emailCalls).toBe(0);
    expect(receiptsBy(events, 'email').length).toBe(0);
    expect(receiptsBy(events, 'whatsapp').length).toBe(1);
    expect(receiptsBy(events, 'whatsapp')[0].type).toBe('notified');
  });

  it('flag-off parity: a `skipped` WhatsApp result writes no receipt — behavior is PR A byte-identical', async () => {
    const events = [];
    const svc = makeSvc({
      events,
      email: async () => ({ sent: true, to: 's***@example.com' }),
      wa: async () => ({ sent: false, skipped: 'disabled' }),
    });
    expect(svc.queueDelivery({ entitlement, prospect: emailable, kind: 'voucher', voucherToken: 'v' })).toBe(true);
    await flushDeliveries();

    expect(receiptsBy(events, 'whatsapp').length).toBe(0);
    expect(receiptsBy(events, 'email').length).toBe(1);
  });

  it('bare instance (no WhatsApp deps wired): exactly the pre-PR-E email behavior', async () => {
    const events = [];
    const svc = makeSvc({
      events,
      email: async () => ({ sent: true, to: 's***@example.com' }),
    });
    expect(svc.queueDelivery({ entitlement, prospect: emailable, kind: 'voucher', voucherToken: 'v' })).toBe(true);
    await flushDeliveries();

    expect(events.length).toBe(1);
    expect(events[0].metadata.channel).toBe('email');
  });

  it('reservation kind routes to the reservation senders with kind-tagged receipts', async () => {
    const events = [];
    const seen = [];
    const svc = makeSvc({
      events,
      emailReservation: async (args) => { seen.push(['email', args.presentationToken]); return { sent: true, to: 'x' }; },
      waReservation: async (args) => { seen.push(['wa', args.presentationToken]); return { sent: true, to: 'y' }; },
    });
    expect(svc.queueDelivery({ entitlement, prospect: emailable, kind: 'pass', presentationToken: 'ptok' })).toBe(true);
    await flushDeliveries();

    expect(seen).toEqual(expect.arrayContaining([['email', 'ptok'], ['wa', 'ptok']]));
    expect(events.every((e) => e.metadata.kind === 'pass')).toBe(true);
    expect(events.map((e) => e.metadata.channel).sort()).toEqual(['email', 'whatsapp']);
  });
});

describe('queueDelivery — channel selection (ops Resend: Email / WhatsApp / Both)', () => {
  const bothSenders = (events) => makeSvc({
    events,
    email: async () => ({ sent: true, to: 's***@example.com' }),
    wa: async () => ({ sent: true, to: '••••4567' }),
  });

  it('defaults to BOTH when channels is omitted (capture/unlock/sweep unchanged)', async () => {
    const events = [];
    bothSenders(events).queueDelivery({ entitlement, prospect: emailable, kind: 'voucher', voucherToken: 'v' });
    await flushDeliveries();
    expect(events.map((e) => e.metadata.channel).sort()).toEqual(['email', 'whatsapp']);
  });

  it("channels ['email'] fires ONLY email — no WhatsApp leg", async () => {
    const events = [];
    const queued = bothSenders(events)
      .queueDelivery({ entitlement, prospect: emailable, kind: 'voucher', voucherToken: 'v', channels: ['email'] });
    expect(queued).toBe(true);
    await flushDeliveries();
    expect(events.map((e) => e.metadata.channel)).toEqual(['email']);
  });

  it("channels ['whatsapp'] fires ONLY WhatsApp — no email leg, emailQueued false", async () => {
    const events = [];
    const queued = bothSenders(events)
      .queueDelivery({ entitlement, prospect: emailable, kind: 'voucher', voucherToken: 'v', channels: ['whatsapp'] });
    expect(queued).toBe(false); // no fresh EMAIL attempt
    await flushDeliveries();
    expect(events.map((e) => e.metadata.channel)).toEqual(['whatsapp']);
  });

  it("channels ['whatsapp','email'] fires both (the 'Both' resend)", async () => {
    const events = [];
    bothSenders(events)
      .queueDelivery({ entitlement, prospect: emailable, kind: 'voucher', voucherToken: 'v', channels: ['whatsapp', 'email'] });
    await flushDeliveries();
    expect(events.map((e) => e.metadata.channel).sort()).toEqual(['email', 'whatsapp']);
  });
});
