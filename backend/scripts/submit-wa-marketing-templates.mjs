#!/usr/bin/env node
/**
 * Submit the cohort-push MARKETING template pack to the Redeem WABA
 * (tracker item "watemplates"; pack doc: docs/plans/wa-marketing-template-pack.md).
 *
 * The Cloud API creds live ONLY on Render (mktr-backend-jo6r → Environment tab),
 * so run this with the token pasted inline — it is never printed — or from the
 * Render Shell tab where the env already exists:
 *
 *   WHATSAPP_TOKEN=…  node backend/scripts/submit-wa-marketing-templates.mjs
 *
 * Modes:
 *   (default)      idempotent submit of all 6 templates (3 text-header + 3
 *                  image-header variants) — reads existing templates first,
 *                  POSTs only the missing ones, then prints a status table
 *   --status       read-only status poll (use while waiting on Meta review)
 *   --dry          print the exact JSON payloads, no network, no token needed
 *   --text-only    submit/consider only the text-header set
 *   --images-only  submit/consider only the image-header set
 *   --sample <p>   sample image for the image-header review examples
 *                  (default: backend/scripts/assets/wa-marketing-sample.png)
 *
 * Image variants: the header image is a PER-SEND parameter — Meta only reviews
 * the sample uploaded here; every push can carry its own campaign hero without
 * re-approval. The sample is uploaded via the Resumable Upload API (needs the
 * app id, auto-read from debug_token; WHATSAPP_APP_ID overrides).
 *
 * Optional env:
 *   WHATSAPP_WABA_ID          skip WABA auto-resolve (needed only if the token
 *                             spans several WABAs and WHATSAPP_PHONE_NUMBER_ID
 *                             isn't set to disambiguate)
 *   WHATSAPP_PHONE_NUMBER_ID  used to pick the right WABA when several match
 *   WHATSAPP_APP_ID           app id for the sample upload (else debug_token)
 *   META_GRAPH_API_VERSION    default v21.0 (matches whatsappService.js)
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const VERSION = process.env.META_GRAPH_API_VERSION || 'v21.0';
const BASE = `https://graph.facebook.com/${VERSION}`;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SAMPLE = path.join(HERE, 'assets/wa-marketing-sample.png');

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

// Image-header twins: footer/buttons unchanged, the text header becomes an
// IMAGE header whose content is a send-time parameter ({link} or {id}), and
// the body opens with a bold headline line — the text header carried the
// headline in the text set, so without this the image twins had none (Shawn's
// Manager adaptation, 2026-07-23). {{1}} stays the first name across the whole
// pack; the headline reuses the title var. The example handle is injected at
// submit time after the sample upload.
const HANDLE_PLACEHOLDER = '<sample-handle-uploaded-at-submit>';
const IMG_BODIES = {
  marketing_new_campaign_img: {
    text:
      "*New reward: {{2}}*\n\nHi {{1}}, a new reward just went live on Redeem: *{{2}}*, from *{{3}}*.\n\nQuantities are limited and available on a first-come, first-served basis.\n\nTap below to view the reward and claim yours in about a minute.",
    example: { body_text: [['Shawn', 'FairPrice $20 Voucher', 'FairPrice']] },
  },
  marketing_new_draw_img: {
    text:
      '*Now open: {{2}}*\n\nHi {{1}}, the {{2}} is open for entries — stand a chance to win *{{3}}*. Entries close {{4}}, and entering takes about a minute.\n\nGood luck 🍀',
    example: { body_text: [['Shawn', 'Tokyo Getaway Lucky Draw', 'a 4D3N trip for two to Tokyo', '30 Oct 2026']] },
  },
  marketing_offer_img: {
    text:
      "*A little something for you*\n\nHi {{1}}, here's something we think you'll like: {{2}}. {{3}}.\n\nTap below to see the details — it takes less than a minute.",
    example: { body_text: [['Shawn', 'a $10 GrabFood voucher when you sign up this week', 'Available while stocks last']] },
  },
};
export const IMAGE_TEMPLATES = TEMPLATES.map((t) => {
  const name = `${t.name}_img`;
  return {
    ...t,
    name,
    components: [
      { type: 'HEADER', format: 'IMAGE', example: { header_handle: [HANDLE_PLACEHOLDER] } },
      ...t.components
        .filter((c) => c.type !== 'HEADER')
        .map((c) => (c.type === 'BODY' ? { ...c, ...IMG_BODIES[name] } : c)),
    ],
  };
});

async function graphGet(path_, token) {
  const res = await fetch(`${BASE}${path_}`, { headers: { Authorization: `Bearer ${token}` } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = json?.error;
    throw new Error(`GET ${path_.split('?')[0]} → ${res.status}${e ? ` ${e.code}: ${e.message}` : ''}`);
  }
  return json;
}

let debugTokenCache = null;
async function inspectToken(token) {
  if (!debugTokenCache) {
    debugTokenCache = await graphGet(`/debug_token?input_token=${encodeURIComponent(token)}`, token);
  }
  return debugTokenCache;
}

/**
 * WABA id: env override → debug_token granular scopes. With several WABAs on
 * the token, WHATSAPP_PHONE_NUMBER_ID picks the one that owns our sender.
 */
async function resolveWabaId(token) {
  if (process.env.WHATSAPP_WABA_ID) return process.env.WHATSAPP_WABA_ID;
  const dbg = await inspectToken(token);
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

/**
 * Resumable Upload API: sample bytes → asset handle for the IMAGE header
 * example. Two phases; phase 2 uses the "OAuth" auth scheme (documented Meta
 * quirk, not a bug).
 */
async function uploadSampleHandle(token, samplePath) {
  const bytes = await readFile(samplePath);
  const appId = process.env.WHATSAPP_APP_ID || (await inspectToken(token))?.data?.app_id;
  if (!appId) {
    throw new Error('No app id on the token (debug_token) — set WHATSAPP_APP_ID to submit image variants.');
  }
  const fileName = path.basename(samplePath);
  const session = await fetch(
    `${BASE}/${appId}/uploads?file_name=${encodeURIComponent(fileName)}&file_length=${bytes.length}&file_type=image%2Fpng`,
    { method: 'POST', headers: { Authorization: `Bearer ${token}` } },
  );
  const sessionJson = await session.json().catch(() => ({}));
  if (!session.ok || !sessionJson?.id) {
    const e = sessionJson?.error;
    throw new Error(`upload session failed — ${e ? `${e.code}: ${e.message}` : `HTTP ${session.status}`}`);
  }
  const up = await fetch(`${BASE}/${sessionJson.id}`, {
    method: 'POST',
    headers: { Authorization: `OAuth ${token}`, file_offset: '0' },
    body: bytes,
  });
  const upJson = await up.json().catch(() => ({}));
  if (!up.ok || !upJson?.h) {
    const e = upJson?.error;
    throw new Error(`sample upload failed — ${e ? `${e.code}: ${e.message}` : `HTTP ${up.status}`}`);
  }
  return upJson.h;
}

function withHandle(template, handle) {
  return {
    ...template,
    components: template.components.map((c) =>
      c.type === 'HEADER' && c.format === 'IMAGE' ? { ...c, example: { header_handle: [handle] } } : c,
    ),
  };
}

async function fetchExisting(wabaId, token) {
  const json = await graphGet(
    `/${wabaId}/message_templates?fields=name,status,category,language,quality_score,rejected_reason&limit=200`,
    token,
  );
  return json?.data || [];
}

function printStatusTable(existing, templates) {
  const names = new Set(templates.map((t) => t.name));
  const byName = new Map(existing.filter((t) => names.has(t.name)).map((t) => [t.name, t]));
  for (const t of templates) {
    const row = byName.get(t.name);
    if (!row) {
      console.log(`  ${t.name.padEnd(28)} NOT SUBMITTED`);
    } else {
      const extra = [
        row.category !== 'MARKETING' ? `category=${row.category}` : null,
        row.rejected_reason && row.rejected_reason !== 'NONE' ? `reason=${row.rejected_reason}` : null,
        row.quality_score?.score ? `quality=${row.quality_score.score}` : null,
      ].filter(Boolean).join(' ');
      console.log(`  ${t.name.padEnd(28)} ${row.status}${extra ? `  (${extra})` : ''}`);
    }
  }
  const sanity = existing.some((t) => ['reward_pass', 'reward_voucher'].includes(t.name));
  console.log(
    sanity
      ? '  ✓ reward_pass/reward_voucher present — this is the Redeem sender WABA'
      : '  ⚠ reward_pass/reward_voucher NOT on this WABA — check you are on the Redeem sender WABA',
  );
}

function selectedSets() {
  const textOnly = process.argv.includes('--text-only');
  const imagesOnly = process.argv.includes('--images-only');
  if (textOnly && imagesOnly) throw new Error('--text-only and --images-only are mutually exclusive');
  return {
    text: !imagesOnly ? TEMPLATES : [],
    image: !textOnly ? IMAGE_TEMPLATES : [],
  };
}

function samplePathArg() {
  const i = process.argv.indexOf('--sample');
  return i >= 0 && process.argv[i + 1] ? path.resolve(process.argv[i + 1]) : DEFAULT_SAMPLE;
}

async function postTemplate(wabaId, token, template) {
  const res = await fetch(`${BASE}/${wabaId}/message_templates`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(template),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = json?.error;
    return { ok: false, detail: `${e?.code || res.status}: ${e?.error_user_msg || e?.message || 'submit failed'}` };
  }
  return { ok: true, id: json.id, status: json.status, category: json.category };
}

async function main() {
  const { text, image } = selectedSets();
  const considered = [...text, ...image];

  if (process.argv.includes('--dry')) {
    console.log(JSON.stringify(considered, null, 2));
    return;
  }

  const token = process.env.WHATSAPP_TOKEN;
  if (!token) {
    console.error(
      'WHATSAPP_TOKEN not set. Copy it from Render → mktr-backend-jo6r → Environment → WHATSAPP_TOKEN, then:\n' +
        '  WHATSAPP_TOKEN=… node backend/scripts/submit-wa-marketing-templates.mjs\n' +
        'Or run from the Render Shell tab (env already present):\n' +
        '  node scripts/submit-wa-marketing-templates.mjs',
    );
    process.exit(1);
  }

  const wabaId = await resolveWabaId(token);
  console.log(`WABA ${wabaId} (Graph ${VERSION})`);
  let existing = await fetchExisting(wabaId, token);

  if (process.argv.includes('--status')) {
    printStatusTable(existing, considered);
    return;
  }

  const have = new Set(existing.filter((t) => t.language === LANGUAGE).map((t) => t.name));
  let failed = 0;

  const submitSet = async (templates) => {
    for (const t of templates) {
      if (have.has(t.name)) {
        console.log(`  ${t.name} already on the WABA — skipped (idempotent)`);
        continue;
      }
      const res = await postTemplate(wabaId, token, t);
      if (!res.ok) {
        failed += 1;
        console.error(`  ✗ ${t.name} — ${res.detail}`);
      } else {
        console.log(`  ✓ ${t.name} submitted — id ${res.id}, status ${res.status}${res.category !== 'MARKETING' ? `, category ${res.category}` : ''}`);
      }
    }
  };

  await submitSet(text);

  if (image.length) {
    const missing = image.filter((t) => !have.has(t.name));
    if (!missing.length) {
      image.forEach((t) => console.log(`  ${t.name} already on the WABA — skipped (idempotent)`));
    } else {
      try {
        const handle = await uploadSampleHandle(token, samplePathArg());
        console.log('  sample image uploaded for the _img review examples');
        await submitSet(missing.map((t) => withHandle(t, handle)));
      } catch (err) {
        failed += missing.length;
        console.error(`  ✗ image variants skipped — ${err?.message || err}`);
      }
    }
  }

  console.log('\nCurrent status on the WABA:');
  existing = await fetchExisting(wabaId, token);
  printStatusTable(existing, considered);
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
