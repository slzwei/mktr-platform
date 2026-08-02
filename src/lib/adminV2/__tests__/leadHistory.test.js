/**
 * P3-3: the Lead Profile page's pure data layer, tested directly.
 *
 * None of this could be reached before. buildHistory, heroFor and deliveryState
 * were module-private inside a 1,966-line component, so exercising any of them
 * meant mounting the whole page with a full profile payload — which nothing did.
 * They decide what an operator reads about a real person's lead, and they were
 * effectively untested.
 *
 * These are characterization tests: they pin the behaviour that already exists.
 */
import { describe, it, expect } from 'vitest';
import { buildHistory, heroFor, deliveryState, evidenceOf } from '../leadHistory';

describe('deliveryState', () => {
  it('says nothing when there is no receipt at all', () => {
    expect(deliveryState(null)).toBeNull();
  });

  it('reports a send that never left our system as failed, with the reason', () => {
    const s = deliveryState({ ok: false, error: 'no phone on file' });
    expect(s.ok).toBe(false);
    expect(s.text).toBe('failed to send');
    expect(s.hint).toContain('no phone on file');
  });

  it('does not call an accepted message delivered', () => {
    // The whole point of wa-delivery-truth: the provider accepting a message is
    // not evidence it arrived, and the UI must not imply otherwise.
    const s = deliveryState({ ok: true });
    expect(s.ok).toBe(true);
    expect(s.text).toBe('accepted');
    expect(s.hint).toMatch(/not confirmed/i);
  });

  it.each([
    ['sent', 'sent, delivery pending'],
    ['delivered', 'delivered'],
    ['read', 'read'],
  ])('reflects the joined status %s as "%s"', (status, text) => {
    const s = deliveryState({ ok: true, delivery: { status } });
    expect(s).toMatchObject({ ok: true, text });
  });

  it('names Meta’s per-person marketing cap for error 131049', () => {
    // The failure operators actually hit. A generic "not delivered" sends them
    // to retry, which cannot work until the window clears.
    const s = deliveryState({ ok: true, delivery: { status: 'failed', errorCode: '131049' } });
    expect(s.ok).toBe(false);
    expect(s.text).toBe('not delivered (Meta marketing limit)');
    expect(s.hint).toMatch(/Retries fail until the window clears/);
  });

  it('accepts the cap code as a number too', () => {
    const s = deliveryState({ ok: true, delivery: { status: 'failed', errorCode: 131049 } });
    expect(s.text).toBe('not delivered (Meta marketing limit)');
  });

  it('quotes any other Meta failure rather than guessing', () => {
    const s = deliveryState({ ok: true, delivery: { status: 'failed', errorTitle: 'Invalid recipient' } });
    expect(s).toMatchObject({ ok: false, text: 'not delivered' });
    expect(s.hint).toContain('Invalid recipient');
  });
});

describe('heroFor', () => {
  it('falls back to a blank outcome when there is nothing to say', () => {
    expect(heroFor(null, [], null)).toMatchObject({ big: 'No outcome recorded', tone: 'quiet' });
  });

  it('shows an open boost window before the draw closes', () => {
    const h = heroFor({ state: 'provisional_in', boosted: false, closesAt: '2026-10-30T15:59:59Z' }, [], null);
    expect(h.big).toBe('1 chance so far');
    expect(h.tail).toContain('boost window open');
    expect(h.meta).toMatch(/^BOOST BY /);
  });

  it('names how a boost was earned', () => {
    const h = heroFor({ state: 'provisional_in', boosted: true, multiplier: 3, boostVia: 'agent_scan' }, [], null);
    expect(h.big).toBe('On track for ×3');
    expect(h.tail).toContain('consultant scan');
  });

  it('falls back to a generic word for an unknown boost route', () => {
    const h = heroFor({ state: 'provisional_in', boosted: true, multiplier: 2, boostVia: 'something_new' }, [], null);
    expect(h.tail).toContain('boost recorded');
  });

  it('pluralises sealed chances correctly', () => {
    expect(heroFor({ state: 'sealed', chances: 1 }, [], null).big).toBe('1 chance');
    expect(heroFor({ state: 'sealed', chances: 4 }, [], null).big).toBe('4 chances');
  });

  it('marks a claimed prize as a win', () => {
    const h = heroFor({ state: 'sealed', chances: 2, outcome: { status: 'selected_claimed', claimedAt: '2026-08-01T02:00:00Z' } }, [], null);
    expect(h.big).toBe('🏆 Winner');
    expect(h.tone).toBe('ok');
  });

  it('keeps a non-selection quiet, not alarming', () => {
    const h = heroFor({ state: 'sealed', chances: 3, outcome: { status: 'not_selected_final' } }, [], null);
    expect(h).toMatchObject({ big: 'Not selected', tone: 'quiet' });
    expect(h.tail).toContain('3 chances');
  });

  it('reads the reward when there is no draw', () => {
    const h = heroFor(null, [{ state: 'redeemed', rewardTitle: 'Free trial class', redeemedAt: '2026-07-20T00:00:00Z' }], null);
    expect(h).toMatchObject({ big: 'Redeemed ✓', tone: 'ok' });
    expect(h.tail).toContain('Free trial class');
  });

  it('lets the draw win over a reward — a draw pass IS the outcome', () => {
    const h = heroFor({ state: 'void' }, [{ state: 'reserved', rewardTitle: 'Pass' }], null);
    expect(h.big).toBe('Draw void');
  });

  it('distinguishes "not issued yet" from "no reward"', () => {
    // A sweep that has not landed is a pending state, not a refusal — the two
    // send an operator to completely different places.
    expect(heroFor(null, [], 'not_issued_yet').big).toBe('Reward pending');
    expect(heroFor(null, [], 'phone_not_verified').big).toBe('No reward');
  });

  it('shows a raw diagnostic code rather than an empty tail when it has no copy', () => {
    const h = heroFor(null, [], 'some_new_reason');
    expect(h.tail).toContain('some_new_reason');
  });
});

describe('evidenceOf', () => {
  it('reads a stamp as verified', () => {
    expect(evidenceOf({ sourceMetadata: { phoneVerifiedAt: '2026-07-20T00:00:00Z' } })).toBe('verified');
  });

  it('calls a pre-stamp signup unrecorded, not unverified', () => {
    // The server did not persist OTP proof before 2026-07-10, and the public
    // form has never accepted an unverified phone. The proof is missing; the
    // verification probably was not.
    expect(evidenceOf({ createdAt: '2026-06-01T00:00:00Z' })).toBe('unrecorded');
  });

  it('calls a post-stamp signup with no proof unverified', () => {
    expect(evidenceOf({ createdAt: '2026-07-25T00:00:00Z' })).toBe('unverified');
  });
});

describe('buildHistory', () => {
  const at = (s) => `2026-07-${s}T00:00:00Z`;

  it('returns newest first', () => {
    const events = buildHistory(
      { activities: [{ createdAt: at('01'), description: 'first' }, { createdAt: at('05'), description: 'later' }] },
      null
    );
    expect(events.map((e) => e.title)).toEqual(['later', 'first']);
  });

  it('drops rows with no usable timestamp instead of inventing one', () => {
    const events = buildHistory({ activities: [{ createdAt: null, description: 'undated' }, { createdAt: at('02'), description: 'dated' }] }, null);
    expect(events.map((e) => e.title)).toEqual(['dated']);
  });

  it('suppresses raw assignment activities once the journey has named ones', () => {
    // Otherwise the same assignment appears twice: once as "Assigned to agent
    // <uuid>" and once with the resolved name.
    const p = {
      activities: [
        { createdAt: at('03'), description: 'Assigned to agent 8f2c…', type: 'assigned' },
        { createdAt: at('03'), description: 'Lead created', type: 'created' },
      ],
    };
    const journey = { signups: [{ createdAt: at('03'), firstName: 'Jo', assignments: [{ at: at('03'), agentName: 'Alice Tan' }] }] };

    const titles = buildHistory(p, journey).map((e) => e.title);
    expect(titles).toContain('Assigned to Alice Tan');
    expect(titles.some((t) => t.includes('8f2c'))).toBe(false);
    expect(titles).toContain('Lead created');
  });

  it('keeps raw assignment rows when the journey has none to replace them', () => {
    const p = { activities: [{ createdAt: at('03'), description: 'Assigned to agent 8f2c…', type: 'assigned' }] };
    expect(buildHistory(p, { signups: [{ createdAt: at('03'), assignments: [] }] }).map((e) => e.title))
      .toContain('Assigned to agent 8f2c…');
  });

  it('separates a returned-to-held from an unassignment', () => {
    const journey = { signups: [{ createdAt: at('01'), assignments: [
      { at: at('02'), kind: 'returned_to_held', agentName: 'Alice Tan' },
      { at: at('03'), kind: 'unassigned', agentName: 'Bob Lim' },
    ] }] };
    const titles = buildHistory({}, journey).map((e) => e.title);
    expect(titles).toContain('Returned to held');
    expect(titles).toContain('Unassigned from Bob Lim');
  });

  it('names an external buyer without pretending to know who', () => {
    const journey = { signups: [{ createdAt: at('01'), assignments: [{ at: at('02'), external: true }] }] };
    const row = buildHistory({}, journey).find((e) => e.family === 'assignment');
    expect(row.title).toBe('Assigned to an MKTR Leads buyer');
  });

  it('timelines a lapse at the lapse, never at the draw', () => {
    const journey = { signups: [{ createdAt: at('01'), draw: { outcome: {
      status: 'selected_unclaimed', drawnAt: at('10'), outcomeAt: at('20'), attemptNo: 1,
    } } }] };
    const events = buildHistory({}, journey);

    const drawn = events.find((e) => e.title === 'Selected in the draw');
    const lapsed = events.find((e) => e.title === 'Selection lapsed');
    expect(drawn.at).toBe(Date.parse(at('10')));
    expect(lapsed.at).toBe(Date.parse(at('20')));
    expect(lapsed.detail).toContain('not claimed in time');
    expect(lapsed.tone).toBe('bad');
  });

  it('skips a draw row whose timestamp is missing rather than guessing', () => {
    const journey = { signups: [{ createdAt: at('01'), draw: { outcome: { status: 'selected_pending', attemptNo: 1 } } }] };
    expect(buildHistory({}, journey).some((e) => e.title === 'Selected in the draw')).toBe(false);
  });

  it('collapses repeat reward-link opens into one row carrying the count', () => {
    const journey = { entitlements: [{ createdAt: at('01'), claimViews: { firstAt: at('02'), count: 7 } }] };
    const rows = buildHistory({}, journey).filter((e) => e.family === 'arrival');
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toContain('×7 views');
  });

  it('omits the count for a single open', () => {
    const journey = { entitlements: [{ createdAt: at('01'), claimViews: { firstAt: at('02'), count: 1 } }] };
    expect(buildHistory({}, journey).find((e) => e.family === 'arrival').title).toBe('Opened their reward link');
  });

  it('reads entitlements off the signup when the lead has no linked person', () => {
    // Consumer-less (B4) leads must still show their reward lifecycle.
    const p = { signupProfile: { entitlements: [{ createdAt: at('01'), rewardTitle: 'Trial class' }] } };
    expect(buildHistory(p, null).some((e) => e.title === 'Reward reserved')).toBe(true);
  });

  it('attaches the true delivery state to a delivery row', () => {
    const journey = { entitlements: [{ createdAt: at('01'), delivery: {
      whatsapp: { at: at('02'), kind: 'pass', ok: true, delivery: { status: 'failed', errorCode: '131049' } },
    } }] };
    const row = buildHistory({}, journey).find((e) => e.family === 'delivery');
    expect(row.state.ok).toBe(false);
    expect(row.state.text).toBe('not delivered (Meta marketing limit)');
  });

  it('marks a consent withdrawal as bad and names the route', () => {
    const journey = { consentTimeline: [{ at: at('02'), granted: false, via: 'wa_stop' }] };
    const row = buildHistory({}, journey)[0];
    expect(row).toMatchObject({ title: 'Marketing consent withdrawn', tone: 'bad', family: 'consent' });
    expect(row.detail).toContain('WhatsApp STOP');
  });

  it('records a PDPA erasure', () => {
    const journey = { consumer: { erasedAt: at('09') } };
    expect(buildHistory({}, journey)[0]).toMatchObject({ title: 'Erased under PDPA', tone: 'bad' });
  });

  it('keeps a qualified screening call loud and the rest quiet', () => {
    const p = { screeningMetadata: { attempts: {
      1: { startedAt: at('02'), outcome: 'no_answer' },
      2: { startedAt: at('03'), outcome: 'qualified' },
    } } };
    const rows = buildHistory(p, null).filter((e) => e.family === 'screening');
    expect(rows.find((r) => r.title.includes('qualified')).quiet).toBe(false);
    expect(rows.find((r) => r.title.includes('no answer')).quiet).toBe(true);
  });

  it('survives an empty payload', () => {
    expect(buildHistory({}, null)).toEqual([]);
  });
});
