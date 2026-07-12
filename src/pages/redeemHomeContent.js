// Redeem homepage content — edit this file to change what's live on redeem.sg/
// without touching layout code. Rendered by RedeemHome.jsx.
//
// DROPS: each entry drives one card in the "Live this week" section and, when
// `status: 'live'`, the hero CTA scrolls to it. NEVER ship a fake 'live' drop:
// `claimUrl` must point at a real campaign, e.g.
//   https://redeem.sg/LeadCapture?campaign_id=<uuid>   (or a /t/<slug> QR link)
// Percentages/counts are optional — omit `claimedPct`/`left` to hide the meter.
//
// status: 'live'  → lime panel, CLAIM button (claimUrl required)
//         'soon'  → outlined panel, "Dropping soon" (no button)
//         'gone'  → grayscale panel, "Too slow — gone" + Notify hint

export const DROPS = [
  {
    id: 'cabin-luggage',
    title: 'Cabin luggage',
    meta: 'Hardshell spinner · first 300 only',
    value: 'FREE',
    emoji: '🧳',
    panel: 'lime',
    status: 'soon',
    // To go live: status: 'live', claimUrl: 'https://redeem.sg/LeadCapture?campaign_id=<uuid>',
    // plus optional claimedPct: 72, left: 66, ends: 'Ends Sunday'.
  },
  {
    id: 'grocery-20',
    title: 'S$20 grocery voucher',
    meta: 'Everyday essentials, on us',
    value: 'S$20',
    emoji: '🛒',
    panel: 'pink',
    status: 'soon',
  },
];

// One evergreen line per item — keep these truthful; no invented counts.
export const MARQUEE_ITEMS = [
  { text: 'Free cabin luggage', accent: true },
  { text: 'S$20 vouchers' },
  { text: 'SMS-verified claims', accent: true },
  { text: 'No app. No points.' },
  { text: 'New drop every week', accent: true },
  { text: 'redeem.sg only' },
];

export const FAQ = [
  {
    q: 'Why do you need my number?',
    a: 'The one-time code proves you’re a real person — one reward per human, not per bot — and it’s where the voucher lands. Some drops are sponsored by partners who’d like to say hello: we name them on the form, before you submit.',
  },
  {
    q: 'Do I need an app?',
    a: 'No. Everything runs in your browser on redeem.sg. Scan the QR or tap the link, fill in the short form, and your voucher arrives by SMS. Nothing to download, nothing to sign in to.',
  },
  {
    q: 'Will I get spam calls?',
    a: 'Only what you agreed to. Every form names its sponsor and spells out who may contact you — if you don’t like the trade, don’t submit. We honour the Do Not Call registry and every opt-out, immediately.',
  },
  {
    q: 'How do I spot a fake?',
    a: 'One rule: real Redeem links live on redeem.sg — nothing else, no lookalike domains. We verify you with an SMS code before any reward, and we will never ask for your NRIC, bank details, or any payment.',
  },
  {
    q: 'My voucher didn’t arrive.',
    a: 'Check the mobile number you entered and give the SMS a minute. Still nothing? Email hello@redeem.sg with the drop name and your number — a human will sort it out.',
  },
];
