#!/usr/bin/env node
/**
 * Submit the cohort-push MARKETING template pack to the Redeem WABA
 * (tracker item "watemplates"; pack doc: docs/plans/wa-marketing-template-pack.md).
 *
 * The Cloud API creds live ONLY on Render (mktr-backend-jo6r → Environment tab),
 * so run this with the token pasted inline — it is never printed:
 *
 *   WHATSAPP_TOKEN=…  node backend/scripts/submit-wa-marketing-templates.mjs
 *
 * Modes:
 *   (default)  idempotent submit — reads existing templates first, POSTs only
 *              the missing ones, then prints a status table
 *   --status   read-only status poll (use while waiting on Meta review)
 *   --dry      print the exact JSON payloads, no network, no token needed
 *
 * Optional env:
 *   WHATSAPP_WABA_ID          skip WABA auto-resolve (needed only if the token
 *                             spans several WABAs and WHATSAPP_PHONE_NUMBER_ID
 *                             isn't set to disambiguate)
 *   WHATSAPP_PHONE_NUMBER_ID  used to pick the right WABA when several match
 *   META_GRAPH_API_VERSION    default v21.0 (matches whatsappService.js)
 */

import { pathToFileURL } from 'node:url';

const VERSION = process.env.META_GRAPH_API_VERSION || 'v21.0';
const BASE = `https://graph.facebook.com/${VERSION}`;

// Language must stay 'en' — whatsappService sends language.code from
// WHATSAPP_TEMPLATE_LANG which defaults to 'en'; a template approved only as
// en_US would make every send 404 with error 132001 (template not found).
const LANGUAGE = 'en';

const FOOTER = 'MKTR Pte. Ltd. · Reply STOP to unsubscribe';
const STOP_BUTTON = { type: 'QUICK_REPLY', text: 'Stop promotions' };

// Dynamic-suffix URL button: {{1}} carries path + query, so one shape serves
// campaign pages, draws, and the marketplace, including utm tags for
// pushmeasure. Example values must be the fully expanded URL.
const cta = (text, exampleSuffix) => ({
  type: 'URL',
  text,
  url: 'https://redeem.sg/{{1}}',
  example: [`https://redeem.sg/${exampleSuffix}`],
});

export const TEMPLATES = [
  {
    name: 'marketing_new_campaign',
    language: LANGUAGE,
    category: 'MARKETING',
    allow_category_change: true,
    components: [
      {
        type: 'HEADER',
        format: 'TEXT',
        text: 'New reward: {{1}}',
        example: { header_text: ['FairPrice $20 Voucher'] },
      },
      {
        type: 'BODY',
        text:
          "Hi {{1}}, a new reward just went live on Redeem — {{2}}, from {{3}}. Quantities are limited and it's first come, first served.\n\nTap below to view the reward and claim yours in about a minute.",
        example: {
          body_text: [['Shawn', 'a $20 FairPrice voucher for new sign-ups', 'FairPrice']],
        },
      },
      { type: 'FOOTER', text: FOOTER },
      {
        type: 'BUTTONS',
        buttons: [
          cta('View reward', 'LeadCapture?campaign_id=1a2b3c4d&utm_source=wa_push'),
          STOP_BUTTON,
        ],
      },
    ],
  },
  {
    name: 'marketing_new_draw',
    language: LANGUAGE,
    category: 'MARKETING',
    allow_category_change: true,
    components: [
      {
        type: 'HEADER',
        format: 'TEXT',
        text: 'Lucky draw: {{1}}',
        example: { header_text: ['Tokyo Getaway'] },
      },
      {
        type: 'BODY',
        text:
          'Hi {{1}}, the {{2}} is open for entries — stand a chance to win {{3}}. Entries close {{4}}, and entering takes about a minute.\n\nGood luck 🍀',
        example: {
          body_text: [['Shawn', 'Tokyo Getaway Lucky Draw', 'a 4D3N trip for two to Tokyo', '30 Oct 2026']],
        },
      },
      { type: 'FOOTER', text: FOOTER },
      {
        type: 'BUTTONS',
        buttons: [
          cta('Enter the draw', 'LeadCapture?campaign_id=85b78a81&utm_source=wa_push'),
          STOP_BUTTON,
        ],
      },
    ],
  },
  {
    name: 'marketing_offer',
    language: LANGUAGE,
    category: 'MARKETING',
    allow_category_change: true,
    components: [
      {
        type: 'HEADER',
        format: 'TEXT',
        text: 'A little something for you',
      },
      {
        type: 'BODY',
        text:
          "Hi {{1}}, here's something we think you'll like: {{2}}. {{3}}.\n\nTap below to see the details — it takes less than a minute.",
        example: {
          body_text: [['Shawn', 'a $10 GrabFood voucher when you sign up this week', 'Available while stocks last']],
        },
      },
      { type: 'FOOTER', text: FOOTER },
      {
        type: 'BUTTONS',
        buttons: [
          cta('See details', 'LeadCapture?campaign_id=1a2b3c4d&utm_source=wa_push'),
          STOP_BUTTON,
        ],
      },
    ],
  },
];

const OUR_NAMES = new Set(TEMPLATES.map((t) => t.name));

async function graphGet(path, token) {
  const res = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = json?.error;
    throw new Error(`GET ${path.split('?')[0]} → ${res.status}${e ? ` ${e.code}: ${e.message}` : ''}`);
  }
  return json;
}

/**
 * WABA id: env override → debug_token granular scopes. With several WABAs on
 * the token, WHATSAPP_PHONE_NUMBER_ID picks the one that owns our sender.
 */
async function resolveWabaId(token) {
  if (process.env.WHATSAPP_WABA_ID) return process.env.WHATSAPP_WABA_ID;
  const dbg = await graphGet(`/debug_token?input_token=${encodeURIComponent(token)}`, token);
  const scopes = dbg?.data?.granular_scopes || [];
  const ids = [
    ...new Set(
      scopes
        .filter((s) => ['whatsapp_business_management', 'whatsapp_business_messaging'].includes(s.scope))
        .flatMap((s) => s.target_ids || []),
    ),
  ];
  if (ids.length === 1) return ids[0];
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (ids.length > 1 && phoneId) {
    for (const id of ids) {
      const phones = await graphGet(`/${id}/phone_numbers?fields=id&limit=50`, token).catch(() => null);
      if (phones?.data?.some((p) => p.id === phoneId)) return id;
    }
  }
  throw new Error(
    ids.length
      ? `Token spans ${ids.length} WABAs (${ids.join(', ')}) — set WHATSAPP_WABA_ID or WHATSAPP_PHONE_NUMBER_ID.`
      : 'Could not auto-resolve the WABA from the token — set WHATSAPP_WABA_ID (WhatsApp Manager URL shows it as asset_id).',
  );
}

async function fetchExisting(wabaId, token) {
  const json = await graphGet(
    `/${wabaId}/message_templates?fields=name,status,category,language,quality_score,rejected_reason&limit=200`,
    token,
  );
  return json?.data || [];
}

function printStatusTable(existing) {
  const byName = new Map(existing.filter((t) => OUR_NAMES.has(t.name)).map((t) => [t.name, t]));
  for (const t of TEMPLATES) {
    const row = byName.get(t.name);
    if (!row) {
      console.log(`  ${t.name.padEnd(24)} NOT SUBMITTED`);
    } else {
      const extra = [
        row.category !== 'MARKETING' ? `category=${row.category}` : null,
        row.rejected_reason && row.rejected_reason !== 'NONE' ? `reason=${row.rejected_reason}` : null,
        row.quality_score?.score ? `quality=${row.quality_score.score}` : null,
      ].filter(Boolean).join(' ');
      console.log(`  ${t.name.padEnd(24)} ${row.status}${extra ? `  (${extra})` : ''}`);
    }
  }
  const sanity = existing.some((t) => ['reward_pass', 'reward_voucher'].includes(t.name));
  console.log(
    sanity
      ? '  ✓ reward_pass/reward_voucher present — this is the Redeem sender WABA'
      : '  ⚠ reward_pass/reward_voucher NOT on this WABA — check you are on the Redeem sender WABA',
  );
}

async function main() {
  const dry = process.argv.includes('--dry');
  const statusOnly = process.argv.includes('--status');

  if (dry) {
    console.log(JSON.stringify(TEMPLATES, null, 2));
    return;
  }

  const token = process.env.WHATSAPP_TOKEN;
  if (!token) {
    console.error(
      'WHATSAPP_TOKEN not set. Copy it from Render → mktr-backend-jo6r → Environment → WHATSAPP_TOKEN, then:\n' +
        '  WHATSAPP_TOKEN=… node backend/scripts/submit-wa-marketing-templates.mjs',
    );
    process.exit(1);
  }

  const wabaId = await resolveWabaId(token);
  console.log(`WABA ${wabaId} (Graph ${VERSION})`);
  let existing = await fetchExisting(wabaId, token);

  if (statusOnly) {
    printStatusTable(existing);
    return;
  }

  const have = new Set(existing.filter((t) => t.language === LANGUAGE).map((t) => t.name));
  let failed = 0;
  for (const t of TEMPLATES) {
    if (have.has(t.name)) {
      console.log(`  ${t.name} already on the WABA — skipped (idempotent)`);
      continue;
    }
    const res = await fetch(`${BASE}/${wabaId}/message_templates`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(t),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      failed += 1;
      const e = json?.error;
      console.error(`  ✗ ${t.name} — ${e?.code || res.status}: ${e?.error_user_msg || e?.message || 'submit failed'}`);
    } else {
      console.log(`  ✓ ${t.name} submitted — id ${json.id}, status ${json.status}${json.category !== 'MARKETING' ? `, category ${json.category}` : ''}`);
    }
  }

  console.log('\nCurrent status on the WABA:');
  existing = await fetchExisting(wabaId, token);
  printStatusTable(existing);
  console.log('\nApproval is usually minutes-to-hours (Meta SLA: up to 24h). Poll with --status.');
  if (failed) process.exit(1);
}

// Guarded so tests/tooling can import TEMPLATES without triggering a run.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err?.message || err);
    process.exit(1);
  });
}
