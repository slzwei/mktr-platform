#!/usr/bin/env node
/**
 * Submit the MARKETING template packs to the Redeem WABA — the cohort-push pack
 * (tracker item "watemplates"; pack doc: docs/plans/wa-marketing-template-pack.md)
 * plus the screening-callback opt-in (docs/plans/retell-screening-calls.md).
 *
 * The Cloud API creds live ONLY on Render (mktr-backend-jo6r → Environment tab),
 * so run this with the token pasted inline — it is never printed — or from the
 * Render Shell tab where the env already exists:
 *
 *   WHATSAPP_TOKEN=…  node backend/scripts/submit-wa-marketing-templates.mjs
 *
 * Modes:
 *   (default)        idempotent submit of all 7 templates (3 text-header + 3
 *                    image-header variants + the screening callback) — reads
 *                    existing templates first, POSTs only the missing ones,
 *                    then prints a status table
 *   --status         read-only status poll (use while waiting on Meta review)
 *   --dry            print the exact JSON payloads, no network, no token needed
 *   --text-only      submit/consider only the text-header set
 *   --images-only    submit/consider only the image-header set
 *   --callback-only  submit/consider only draw_callback_optin
 *   --utility-only   submit/consider only the UTILITY receipt pack
 *                    (draw_boost_receipt_v2 + reward_voucher_v2 — the
 *                    frequency-cap-exempt twins; docs/plans/wa-delivery-truth.md)
 *   --token-stdin    read the token from stdin instead of WHATSAPP_TOKEN, so it
 *                    never lands in the command line or shell history:
 *                      pbpaste | node …/submit-wa-marketing-templates.mjs --token-stdin
 *   --whoami         print the token's app/type/scopes and the WABAs reachable
 *                    from it — first stop when WABA resolution fails
 *   --business <id>  resolve the WABA through this Business (system-user tokens
 *                    carry a business id, not a WABA id)
 *   --waba <id>      skip resolution entirely
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

/**
 * Screening-callback opt-in (2026-07-25) — the WhatsApp leg of the AI screening
 * gate: when the call could not reach a verdict (no answer, or "call me back
 * later"), messaging beats a third dial. The URL button is the consent: tapping
 * it is the person ASKING to be called, which is the only thing that makes the
 * ring-back welcome rather than pestering.
 *
 * Copy contract: the boost is earned when the consultant RECORDS the completed
 * session (src/lib/drawCopy.js DRAW_RECORD_PHRASE) and ×N is the TOTAL, not N
 * extra — the same promise the campaign page, the Vault pass and the boost
 * receipt make. Do not reword to "N more chances" here; that is the phone
 * script's register, and the two must not drift into different promises.
 *
 * NOT SENDABLE YET: the `/callback` landing page and its consent-capture
 * endpoint do not exist, and whatsappService must call this one with
 * purpose:'marketing' (its sends are transactional today). Approval first,
 * wiring second.
 */
export const CALLBACK_TEMPLATES = [
  {
    name: 'draw_callback_optin',
    language: LANGUAGE,
    category: 'MARKETING',
    allow_category_change: true,
    components: [
      { type: 'HEADER', format: 'TEXT', text: 'About your lucky draw entry' },
      {
        // Trimmed 2026-07-25 (wordiness audit — 66→44 words). Kept on purpose:
        // "financial consultants" (meet-up honesty), the record condition
        // (promise precision) and the ×N-total register. The edit was pushed
        // to the approved template via Graph POST /<template-id>.
        type: 'BODY',
        text:
          "Hi {{1}}, sorry we missed you on the phone about the {{2}}!\n\nMeet one of our financial consultants — once your session is recorded, your 1 entry becomes {{3}}: ×{{3}} chances at {{4}}.\n\nTap below and we'll call you at a time that suits you.",
        example: {
          body_text: [['Shawn', 'iPhone 17 Pro Lucky Draw', '10', 'an iPhone 17 Pro']],
        },
      },
      { type: 'FOOTER', text: FOOTER },
      {
        type: 'BUTTONS',
        buttons: [
          cta('Yes, call me', 'callback?t=8f3c1d9a2b&utm_source=wa_screening'),
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

// UTILITY receipts — transactional twins of two MARKETING templates whose
// sends Meta silently drops under the per-user marketing frequency cap
// (error 131049; docs/plans/wa-delivery-truth.md).
//
// ROUND 1 (2026-07-26, names burned): draw_boost_receipt_v2 /
// reward_voucher_v2 carried the approved originals' bodies verbatim with
// category UTILITY and allow_category_change: false. Meta APPROVED both but
// silently recategorized them to MARKETING at review — the flag no longer
// forces an INCORRECT_CATEGORY rejection (2026 behavior: approve-and-flip).
// Those shells stay on the WABA; do not send with them (same cap as the
// originals) and do not delete them (30-day name block).
//
// ROUND 2 (below): same facts in record-keeping register. The classifier
// difference between our UTILITY approvals (draw_pass_receipt, draw_entry_pass
// — both carry an ACTION: "show this pass, they will scan it") and the flipped
// round-1 pair (pure congratulation) is the promotional scent of celebration
// copy. So: "this is your record / keep this message" and "ready to use — show
// the QR at the counter" (Meta's own canonical utility example). Param COUNT
// AND ORDER are identical to what whatsappService already sends
// (boost: name, draw name, multiplier · voucher: name, reward, token, expiry)
// — approval needs only the WHATSAPP_TEMPLATE_DRAW_BOOST /
// WHATSAPP_TEMPLATE_VOUCHER env flip, zero code change.
export const UTILITY_TEMPLATES = [
  {
    name: 'draw_session_receipt',
    language: LANGUAGE,
    category: 'UTILITY',
    allow_category_change: false,
    components: [
      { type: 'HEADER', format: 'IMAGE', example: { header_handle: [HANDLE_PLACEHOLDER] } },
      {
        type: 'BODY',
        text:
          'Hi {{1}}, this is your record for the consultation session you completed.\n\nCampaign: {{2}}\nEntry total after this session: ×{{3}}\n\nKeep this message for your records. No further action is needed, and we will never ask you for payment.',
        example: { body_text: [['Shawn', 'iPhone 17 Pro Lucky Draw', '10']] },
      },
    ],
  },
  {
    name: 'voucher_delivery',
    language: LANGUAGE,
    category: 'UTILITY',
    allow_category_change: false,
    components: [
      { type: 'HEADER', format: 'IMAGE', example: { header_handle: [HANDLE_PLACEHOLDER] } },
      {
        type: 'BODY',
        text:
          'Hi {{1}}, your {{2}} is ready to use.\n\nShow the QR above at the counter, or open: https://redeem.sg/r/{{3}}\n\nValid until {{4}}. Thank you.',
        example: { body_text: [['Sarah', 'S$10 FairPrice voucher', 'a1b2c3d4e5f6', '17 Aug 2026']] },
      },
    ],
  },
];

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

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : null;
}

function targetIdsFor(dbg, scopeNames) {
  return [
    ...new Set(
      (dbg?.data?.granular_scopes || [])
        .filter((s) => scopeNames.includes(s.scope))
        .flatMap((s) => s.target_ids || []),
    ),
  ];
}

/** WABAs a Business owns or is a client of (needs business_management). */
async function wabasOfBusiness(businessId, token) {
  const edges = ['owned_whatsapp_business_accounts', 'client_whatsapp_business_accounts'];
  const found = [];
  for (const edge of edges) {
    const json = await graphGet(`/${businessId}/${edge}?fields=id,name&limit=50`, token).catch(() => null);
    for (const w of json?.data || []) found.push(w);
  }
  return found;
}

/**
 * The Redeem sender WABA. An asset id, not a secret — the same value persisted
 * on Render as WHATSAPP_WABA_ID (docs/plans/draw-boost-rail-auto-provision.md).
 * Needed as a local fallback because the prod system-user token's granular
 * scopes carry NO target ids (verified 2026-07-25 via --whoami), so nothing can
 * be enumerated from the token alone. The end-of-run sanity check (reward_pass /
 * reward_voucher present) still proves every submission landed on this WABA.
 */
const REDEEM_WABA_ID = '1912683432731970';

/**
 * WABA id: env/flag override → debug_token granular scopes → the Business's
 * owned/client WABAs → the known Redeem WABA. With several candidates,
 * WHATSAPP_PHONE_NUMBER_ID picks the one that owns our sender.
 */
async function resolveWabaId(token) {
  const override = process.env.WHATSAPP_WABA_ID || argValue('--waba');
  if (override) return override;

  const dbg = await inspectToken(token);
  let ids = targetIdsFor(dbg, ['whatsapp_business_management', 'whatsapp_business_messaging']);

  if (ids.length === 0) {
    const businessIds = [argValue('--business'), ...targetIdsFor(dbg, ['business_management'])].filter(Boolean);
    const wabas = [];
    for (const bizId of [...new Set(businessIds)]) {
      for (const w of await wabasOfBusiness(bizId, token)) wabas.push(w);
    }
    if (wabas.length) console.log(`  WABAs via business: ${wabas.map((w) => `${w.name || '?'} (${w.id})`).join(', ')}`);
    ids = [...new Set(wabas.map((w) => w.id))];
  }

  if (ids.length === 1) return ids[0];
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (ids.length > 1 && phoneId) {
    for (const id of ids) {
      const phones = await graphGet(`/${id}/phone_numbers?fields=id&limit=50`, token).catch(() => null);
      if (phones?.data?.some((p) => p.id === phoneId)) return id;
    }
  }
  if (ids.length > 1) {
    throw new Error(`Token spans ${ids.length} WABAs (${ids.join(', ')}) — pass --waba <id> or set WHATSAPP_PHONE_NUMBER_ID.`);
  }
  // Nothing enumerable from the token — fall back to the known Redeem WABA,
  // but PROVE it first (a token for some other WABA must fail loudly here,
  // not submit templates into the wrong account).
  const probe = await graphGet(`/${REDEEM_WABA_ID}?fields=id,name`, token).catch((err) => {
    throw new Error(
      `Could not auto-resolve the WABA, and the token cannot read the known Redeem WABA ${REDEEM_WABA_ID} `
        + `(${err?.message || err}) — pass --waba <id> (WhatsApp Manager URL shows it as asset_id), or run --whoami.`,
    );
  });
  console.log(`  WABA auto-resolution found nothing on the token — using the known Redeem WABA "${probe.name || '?'}" (${probe.id})`);
  return probe.id;
}

/** Token diagnostic: what identity/scopes/assets does this token actually carry? */
async function whoami(token) {
  const dbg = await inspectToken(token);
  const d = dbg?.data || {};
  console.log(`app_id       ${d.app_id || '—'}`);
  console.log(`type         ${d.type || '—'}${d.expires_at ? ` (expires ${new Date(d.expires_at * 1000).toISOString()})` : ' (no expiry)'}`);
  console.log(`scopes       ${(d.scopes || []).join(', ') || '—'}`);
  for (const s of d.granular_scopes || []) {
    console.log(`  ${s.scope.padEnd(32)} ${(s.target_ids || []).join(', ') || '(no target ids)'}`);
  }
  const businessIds = [argValue('--business'), ...targetIdsFor(dbg, ['business_management'])].filter(Boolean);
  for (const bizId of [...new Set(businessIds)]) {
    const wabas = await wabasOfBusiness(bizId, token);
    console.log(`business ${bizId} → ${wabas.length ? wabas.map((w) => `${w.name || '?'} (${w.id})`).join(', ') : 'no WABAs visible'}`);
  }
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
  const only = ['--text-only', '--images-only', '--callback-only', '--utility-only'].filter((f) => process.argv.includes(f));
  if (only.length > 1) throw new Error(`${only.join(' and ')} are mutually exclusive`);
  const all = only.length === 0;
  return {
    text: all || only[0] === '--text-only' ? TEMPLATES : [],
    callback: all || only[0] === '--callback-only' ? CALLBACK_TEMPLATES : [],
    image: all || only[0] === '--images-only' ? IMAGE_TEMPLATES : [],
    utility: all || only[0] === '--utility-only' ? UTILITY_TEMPLATES : [],
  };
}

function samplePathArg() {
  const i = process.argv.indexOf('--sample');
  return i >= 0 && process.argv[i + 1] ? path.resolve(process.argv[i + 1]) : DEFAULT_SAMPLE;
}

/**
 * Token via stdin (`--token-stdin`), so the secret never appears in the command
 * line, the shell history, or a placeholder the caller has to hand-substitute:
 *   pbpaste | node backend/scripts/submit-wa-marketing-templates.mjs --token-stdin
 */
async function readStdinToken() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8').trim();
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
  const { text, callback, image, utility } = selectedSets();
  const considered = [...text, ...callback, ...image, ...utility];

  if (process.argv.includes('--dry')) {
    console.log(JSON.stringify(considered, null, 2));
    return;
  }

  const token = process.argv.includes('--token-stdin')
    ? await readStdinToken()
    : process.env.WHATSAPP_TOKEN;
  if (!token) {
    console.error(
      'WHATSAPP_TOKEN not set. Copy it from Render → mktr-backend-jo6r → Environment → WHATSAPP_TOKEN, then:\n' +
        '  WHATSAPP_TOKEN=… node backend/scripts/submit-wa-marketing-templates.mjs\n' +
        'Or run from the Render Shell tab (env already present):\n' +
        '  node scripts/submit-wa-marketing-templates.mjs',
    );
    process.exit(1);
  }
  // Pasting the command with its "…" placeholder intact otherwise dies deep in
  // fetch with "Cannot convert argument to a ByteString" — a header-encoding
  // error that says nothing about the actual mistake.
  if (!/^[\x21-\x7e]+$/.test(token)) {
    console.error(
      'WHATSAPP_TOKEN is not a usable token — it must be the raw value from Render, not the "…" placeholder.\n' +
        '  WHATSAPP_TOKEN=EAAG…the-real-token node backend/scripts/submit-wa-marketing-templates.mjs --callback-only',
    );
    process.exit(1);
  }

  if (process.argv.includes('--whoami')) {
    await whoami(token);
    return;
  }

  // Resolution failure prints the token diagnostic itself: re-running with
  // --whoami would mean copying another command, and on macOS that clobbers the
  // very clipboard the token was piped from.
  let wabaId;
  try {
    wabaId = await resolveWabaId(token);
  } catch (err) {
    console.error(`${err?.message || err}\n\nWhat this token actually carries:`);
    await whoami(token).catch((e) => console.error(`  (diagnostic failed: ${e?.message || e})`));
    process.exit(1);
  }
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
  await submitSet(callback);

  // Image-header sets share one sample upload: the _img marketing twins and
  // the UTILITY receipt pack both need a handle-bearing example.
  const imageSets = [...image, ...utility];
  if (imageSets.length) {
    const missing = imageSets.filter((t) => !have.has(t.name));
    if (!missing.length) {
      imageSets.forEach((t) => console.log(`  ${t.name} already on the WABA — skipped (idempotent)`));
    } else {
      try {
        const handle = await uploadSampleHandle(token, samplePathArg());
        console.log('  sample image uploaded for the image-header review examples');
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
