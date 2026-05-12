#!/usr/bin/env node
/**
 * Meta CAPI smoke test.
 *
 * Sends a minimal `Lead` event to the Meta /events endpoint using the
 * configured Pixel ID, access token, and test event code. Verifies
 * end-to-end reachability and credential validity before any production
 * wiring goes live.
 *
 * Usage:
 *   node backend/scripts/meta-capi-smoke.js
 *
 * Requires env:
 *   META_PIXEL_ID
 *   META_CAPI_ACCESS_TOKEN
 *   META_TEST_EVENT_CODE   (events appear in Pixel → Test Events tab)
 *
 * Exit codes:
 *   0  success (events_received === 1)
 *   1  config missing
 *   2  HTTP error / network failure
 *   3  Meta returned events_received !== 1
 */
import dotenv from 'dotenv';
dotenv.config();

const GRAPH_VERSION = 'v21.0';

const PIXEL_ID = process.env.META_PIXEL_ID;
const ACCESS_TOKEN = process.env.META_CAPI_ACCESS_TOKEN;
const TEST_EVENT_CODE = process.env.META_TEST_EVENT_CODE;

if (!PIXEL_ID || !ACCESS_TOKEN || !TEST_EVENT_CODE) {
  console.error('[smoke] Missing env. Required: META_PIXEL_ID, META_CAPI_ACCESS_TOKEN, META_TEST_EVENT_CODE');
  console.error('[smoke] Got:', {
    META_PIXEL_ID: PIXEL_ID ? 'set' : 'MISSING',
    META_CAPI_ACCESS_TOKEN: ACCESS_TOKEN ? 'set' : 'MISSING',
    META_TEST_EVENT_CODE: TEST_EVENT_CODE ? 'set' : 'MISSING',
  });
  process.exit(1);
}

const payload = {
  data: [
    {
      event_name: 'Lead',
      event_time: Math.floor(Date.now() / 1000),
      event_id: `smoke-${Date.now()}`,
      action_source: 'website',
      event_source_url: 'https://example.com/smoke',
      user_data: {
        client_ip_address: '127.0.0.1',
        client_user_agent: 'mktr-capi-smoke/1.0',
      },
      custom_data: {
        lead_source: 'smoke_test',
      },
    },
  ],
  test_event_code: TEST_EVENT_CODE,
};

const url = `https://graph.facebook.com/${GRAPH_VERSION}/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`;

console.log('[smoke] POST https://graph.facebook.com/' + GRAPH_VERSION + '/' + PIXEL_ID + '/events?access_token=[REDACTED]');
console.log('[smoke] test_event_code:', TEST_EVENT_CODE);

try {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    console.error('[smoke] HTTP', res.status, body);
    process.exit(2);
  }

  console.log('[smoke] response:', JSON.stringify(body, null, 2));

  if (body.events_received !== 1) {
    console.error('[smoke] FAIL: expected events_received=1, got', body.events_received);
    process.exit(3);
  }

  console.log('[smoke] OK — check Meta Events Manager → Pixel → Test Events tab to confirm.');
  process.exit(0);
} catch (err) {
  console.error('[smoke] network error:', err.message);
  process.exit(2);
}
