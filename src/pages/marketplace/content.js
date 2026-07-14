/**
 * Marketplace static content + display helpers (from the approved
 * claude.ai/design Prototype v2). Categories mirror the backend consumer
 * taxonomy (backend/src/utils/marketplaceContent.js CONSUMER_CATEGORIES) —
 * change them together.
 */

export const CATEGORIES = [
  { id: 'art_creativity', label: 'Art & Creativity', group: 'education', blurb: 'Drawing, painting and portfolio discovery' },
  { id: 'coding_robotics', label: 'Coding & Robotics', group: 'education', blurb: 'Build, program and problem-solve' },
  { id: 'speech_performance', label: 'Speech & Performance', group: 'education', blurb: 'Confidence on stage and in class' },
  { id: 'sports_movement', label: 'Sports & Movement', group: 'education', blurb: 'Swim, play and move well' },
  { id: 'music_dance', label: 'Music & Dance', group: 'education', blurb: 'Instruments, voice and rhythm' },
  { id: 'academic', label: 'Academic', group: 'education', blurb: 'Diagnostics and subject support' },
  { id: 'family_lifestyle', label: 'Family & Lifestyle', group: 'lifestyle', blurb: 'Experiences to share together' },
  { id: 'wellness', label: 'Wellness', group: 'lifestyle', blurb: 'Self-care that earns its slot' },
  { id: 'dining', label: 'Dining', group: 'lifestyle', blurb: 'Tables worth booking' },
  { id: 'financial_education', label: 'Financial Education', group: 'lifestyle', blurb: 'Understand your money better' },
];

export const categoryLabel = (id) => CATEGORIES.find((c) => c.id === id)?.label || id;

export const HOW_STEPS = [
  { n: '1', t: 'Discover and submit interest', d: 'Browse experiences from verified Singapore partners, check the details and any activation requirement, then submit and verify your number with a one-time code.' },
  { n: '2', t: 'Complete the activation step', d: "If the campaign has one — for example a 20-minute financial-planning conversation — complete it. It's always stated before you submit, and no purchase is ever required." },
  { n: '3', t: 'Enjoy your experience', d: "The partner confirms your slot. Show up and enjoy — that's it." },
];

export const TRUST_POINTS = [
  { t: 'Verified Singapore businesses', d: 'Registration, licensing and venues checked before a partner can list.' },
  { t: 'OTP-verified redemptions', d: 'Every submission is confirmed by a one-time code — no bots, no duplicates.' },
  { t: 'Clear activation conditions', d: 'Any requirement is on the offer card and page before you submit. Always.' },
  { t: 'No membership, no card', d: 'Free to use. No points to collect, nothing to subscribe to.' },
  { t: 'Consent you control', d: 'Plain-language consent choices, including Do-Not-Call protection.' },
  { t: 'Real availability only', d: 'Capacity and expiry shown are real. No fake countdowns, ever.' },
];

export const HOME_FAQ = [
  { q: 'Is Redeem really free to use?', a: 'Yes. Offers are funded by the businesses themselves and, for selected campaigns, by licensed financial consultants who sponsor them. You never pay Redeem anything.' },
  { q: "What's the catch with sponsored offers?", a: "There isn't a hidden one — the condition is printed on the offer before you give any details. Sponsored campaigns ask you to complete one clearly stated step, most commonly a 20-minute financial-planning conversation. No purchase is ever required." },
  { q: 'Why do you need my phone number?', a: "It's how we verify you're a real person (one-time code) and how the partner confirms your booking. One redemption per person keeps offers honest for everyone." },
  { q: 'Will I get marketing calls?', a: 'Only what you consent to. Contact consent is a choice you control at submission, and numbers on the Do-Not-Call registry get an extra explicit consent step.' },
  { q: 'Who is behind Redeem?', a: 'Redeem.sg is the consumer brand of MKTR PTE. LTD. (UEN 202507548M), registered in Singapore.' },
  { q: 'How do lucky draws work?', a: 'Sign up and verify your number — one entry per person. Some draws let you multiply your entry by completing the activation step before the boost deadline. Winners are contacted directly and listed (partially masked) on the winners page.' },
];

export const DSA_CONTENT = {
  talents: ['Art', 'Music', 'Sports', 'STEM & Robotics', 'Debate & Oratory', 'Drama', 'Dance', 'Leadership', 'Languages'],
  prep: [
    'Portfolio or audition preparation in the talent area',
    'Trial sessions to confirm genuine interest before committing',
    'Skill assessments that identify strengths and gaps',
    'Interview confidence and communication practice',
  ],
  evaluate: [
    'Verified business registration and teaching credentials',
    'Structured feedback after trials — not just "it went well"',
    'Transparent pricing for anything beyond the free session',
    'No admission guarantees — schools decide, full stop',
    'Willingness to say a programme is NOT a fit',
  ],
  questions: [
    'What does progress look like after three months?',
    'How do you assess whether my child has an aptitude here?',
    'What proportion of your students continue after the trial?',
    'What would make you advise us not to continue?',
  ],
};

export const BIZ_PROPS = [
  { t: 'Fill unused capacity', d: 'Turn empty trial-class seats and appointment slots into booked, confirmed visits.' },
  { t: 'Qualified, verified customers', d: 'Every redemption is OTP-verified and consented — no bot lists, no cold data.' },
  { t: 'Campaigns without the build', d: 'Offer pages, forms, verification and consent handling are our infrastructure, not your project.' },
  { t: 'Conditions shown up front', d: 'Customers arrive knowing the offer, the value and any requirement — better attendance, better conversations.' },
  { t: 'Outcome-based economics', d: 'Structure around attended visits or qualified leads — agreed per campaign, not per click.' },
  { t: 'A brand-safe environment', d: 'Verified partners only, no fake urgency, clear consumer protections you can point to.' },
];

export const BIZ_STEPS = [
  { n: '1', t: 'Scope the offer', d: 'you define capacity, audience and any qualification rules with us.' },
  { n: '2', t: 'We build the campaign', d: 'page, form config, OTP channel and disclosures set up on our side.' },
  { n: '3', t: 'Verified redemptions arrive', d: 'routed to you with consent records attached.' },
  { n: '4', t: 'You fulfil and confirm', d: 'host the visit, mark attendance, and settle on agreed outcomes.' },
];

export const LEGAL_DOCS = {
  terms: {
    title: 'Terms of use',
    updated: 'Updated 14 July 2026',
    blocks: [
      { h: 'What Redeem is', body: 'Redeem.sg lists experiences and rewards from verified Singapore businesses. Redeem is operated by MKTR PTE. LTD. (UEN 202507548M). We are the campaign operator — the experience itself is provided by the named partner.' },
      { h: 'One redemption per person', body: 'Each offer is limited to one redemption per verified person unless the offer states otherwise. Duplicate submissions are not recorded.' },
      { h: 'Activation requirements', body: 'Some campaigns require one clearly stated step (for example a sponsored financial-planning conversation) before the experience is confirmed. The requirement is always shown before you submit any details. No purchase is ever required.' },
      { h: 'Campaign terms', body: "Individual campaigns (including lucky draws) carry their own terms, shown at submission. The version you accept is recorded with your entry." },
      { h: 'Fair use', body: 'We may decline or cancel redemptions that are fraudulent, automated, or abusive. Partners may reschedule sessions with reasonable notice.' },
    ],
  },
  dnc: {
    title: 'DNC information',
    updated: 'Updated 14 July 2026',
    blocks: [
      { h: 'We respect the Do-Not-Call registry', body: "If your verified number is registered on Singapore's DNC registry, we tell you during submission and ask for explicit, campaign-specific consent before the partner or sponsor may contact you about it." },
      { h: 'Declining is fine', body: 'If you decline, we simply do not proceed with that campaign — your DNC registration stays fully respected and nothing is stored beyond the attempt.' },
      { h: 'Withdrawing consent', body: 'You can withdraw consent at any time by writing to support@redeem.sg — we action withdrawals within 5 working days.' },
    ],
  },
  'leads-privacy': {
    title: 'Leads privacy',
    updated: 'Updated 14 July 2026',
    blocks: [
      { h: 'What we collect', body: 'The details you submit on an offer (name, verified mobile number, email, and any campaign-specific fields shown on the form), plus your consent choices.' },
      { h: 'How they are used', body: 'To arrange your redemption with the named partner and, only with your explicit third-party consent, with the sponsoring consultant. Consent records are stored with every submission.' },
      { h: 'Where they go', body: 'Your details are delivered to the partner fulfilling your redemption through our operator platform. We never sell your data.' },
      { h: 'Your rights', body: 'Ask for access, correction, or deletion any time: support@redeem.sg. See the full Personal Data Protection Policy for details.' },
    ],
  },
};

/* ---------- Display helpers (design_config + ops) ---------- */

export function composeValueLine(campaign) {
  const dc = campaign?.design_config || {};
  const ops = campaign?.ops;
  if (dc.value_line) return dc.value_line;
  if (!ops || ops.retail_value == null) return null;
  return `Worth S$${ops.retail_value}${dc.activation?.required ? ' · free with activation' : ' · free'}`;
}

export function ageLabelOf(dc = {}) {
  const lv = dc.school_levels || [];
  const ar = dc.age_range || {};
  if (lv.length) return lv.length > 1 ? `${lv[0]}–${lv[lv.length - 1]}` : lv[0];
  if (ar.min == null) return null;
  if (ar.max >= 99) return ar.min >= 21 ? 'Adults (21+)' : `Ages ${ar.min}+`;
  return `Ages ${ar.min}–${ar.max}`;
}

const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function fmtDateLong(iso) {
  if (!iso) return '';
  const d = new Date(String(iso).length > 10 ? iso : `${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getDate()} ${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}`;
}

export function fmtDateShort(iso) {
  if (!iso) return '';
  const d = new Date(String(iso).length > 10 ? iso : `${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
}

export const isDrawCampaign = (campaign) => campaign?.design_config?.luckyDraw?.enabled === true;

/** Boost tier facts — luckyDraw (authored dates) + ops.draw (live Draw row). */
export function boostOf(campaign) {
  const ld = campaign?.design_config?.luckyDraw;
  const draw = campaign?.ops?.draw;
  if (!ld?.enabled) return null;
  const boostClosesAt = draw?.boostClosesAt || ld.boostClosesAt || null;
  const multiplier = draw?.multiplier || ld.multiplier || 10;
  if (!boostClosesAt) return null;
  return { boostClosesAt, multiplier };
}
