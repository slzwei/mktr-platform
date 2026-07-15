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

/* DSA field guide (/dsa). Facts sourced from MOE's published 2026 DSA-Sec
   schedule and parliamentary replies (Feb 2024) — update yearly. */
export const DSA_GUIDE = {
  ledger: [
    { n: '4,400', d: 'students admitted via DSA in 2023' },
    { n: '1 in 9', d: 'of the P6 cohort — up from 1 in 11 in 2019' },
    { n: '~8,000', d: 'places on offer yearly · many go unfilled' },
    { n: '$0', d: 'to apply — one form, MOE portal' },
  ],
  ledgerSource: 'Source: MOE, parliamentary reply, Feb 2024 · moe.gov.sg',
  chapters: [
    { id: 'basics', n: '01', t: 'The basics', k: 'What DSA actually is' },
    { id: 'trade', n: '02', t: 'The honest trade', k: 'What it gives · what it asks' },
    { id: 'routes', n: '03', t: 'The seven routes', k: 'A field guide to each door' },
    { id: 'year', n: '04', t: 'The 2026 calendar', k: "MOE's published schedule" },
    { id: 'runway', n: '05', t: 'The runway', k: 'P3 → P6, without the panic' },
    { id: 'programmes', n: '06', t: 'Choosing programmes honestly', k: 'Guardrails first' },
    { id: 'faq', n: '07', t: 'Questions, answered', k: 'The ones parents actually ask' },
  ],
  mechanics: [
    { k: 'Apply', v: 'One MOE portal form · free', s: '6 May – 2 Jun 2026' },
    { k: 'Choices', v: 'Up to 3', s: 'at most 2 at the same school' },
    { k: 'Selection', v: 'By the schools', s: 'trials · auditions · interviews, Jun–Aug' },
    { k: 'Outcomes', v: 'By 28 Aug', s: 'Confirmed Offer or Wait List' },
    { k: 'Rank', v: '19 – 23 Oct', s: 'submit school preferences' },
    { k: 'Guarantee', v: 'Place secured', s: "if PSLE meets the course's entry" },
    { k: 'Intake cap', v: 'Up to 20%', s: "of a school's non-IP S1 intake" },
  ],
  gives: [
    { t: 'A place settled before results week', d: 'The offer is in hand by late August — the P6 year ends calmer for everyone.' },
    { t: 'Entry judged on the talent itself', d: 'Selection looks at aptitude and potential in the talent area — not only the four-subject aggregate.' },
    { t: 'Four years inside the right programme', d: 'Coaches, studios, labs and stages — with schoolmates who chose the same thing.' },
    { t: 'A school chosen for fit', d: 'The question becomes "where will this talent grow?", not just "what\'s the cut-off?"' },
  ],
  asks: [
    { t: 'A binding commitment', d: 'A taken-up DSA place means no S1 posting choices and no transfer after PSLE results — the programme is honoured for its duration.' },
    { t: 'PSLE still gates the door', d: 'Miss the posting group the school offers, and the DSA place lapses. The exam still matters.' },
    { t: 'The talent continues', d: 'Schools admit contributors — expect the CCA or programme to run through the secondary years.' },
    { t: 'Honesty about whose dream it is', d: "Four years is a long time to carry a parent's ambition. The interest has to be the child's." },
  ],
  routes: [
    {
      id: 'sports', num: '01', tint: 'rm-dsa-t1', name: 'Sports & Games',
      share: '≈ one-third of all applications — the busiest door',
      formats: ['Trials', 'Records', 'Interview'],
      how: 'School trials — often by invitation — plus your competition record. Some sports skip trials entirely and select on verified results alone: swimming times, for instance. Team sports also weigh positional needs: a school flush with strikers is hunting for a keeper.',
      look: 'Performance beyond age-group norms; National School Games results at zonal or national level; club and academy competition (JSSL, SYL, NYL and other FAS-sanctioned leagues for footballers); and coachability — how a child responds to correction on the day.',
      evidence: 'NSG placings, club and tournament records, timings and rankings, coach references, match or meet video.',
      startLabel: 'Test the interest first:',
      start: [{ label: 'Sports & Movement →', to: '/c/sports_movement' }],
    },
    {
      id: 'arts', num: '02', tint: 'rm-dsa-t2', name: 'Visual, Literary & Performing Arts',
      share: 'Music · dance · drama · art · creative writing',
      formats: ['Audition', 'Portfolio', 'Interview'],
      how: 'Auditions and portfolios, then interviews — often with an on-the-spot task: sight-reading, live drawing, improvisation. Music applications usually mean one instrument (or voice) and one track, so choose the strongest suit rather than listing everything.',
      look: "Technique and expressive range for the age; sustained practice rather than a crammed showcase; and a genuine voice in the work — panels can tell a child's own portfolio from a tutor's.",
      evidence: 'A curated portfolio (visual arts commonly 8–15 pieces), performance recordings, graded-exam certificates (ABRSM, Trinity) where relevant, SYF and concert or exhibition history.',
      startLabel: 'Test the interest first:',
      start: [{ label: 'Music & Dance →', to: '/c/music_dance' }, { label: 'Art & Creativity →', to: '/c/art_creativity' }],
    },
    {
      id: 'stem', num: '03', tint: 'rm-dsa-t3', name: 'Science, Mathematics & Engineering',
      share: '≈ one-quarter of applications',
      formats: ['Problem test', 'Portfolio', 'Interview'],
      how: "Problem-solving papers and interviews; some schools run selection camps or ask for a project walk-through, and a few weigh Primary 5 school results. The test is rarely the syllabus — it's how a child attacks an unfamiliar problem.",
      look: 'Reasoning beyond the textbook, curiosity with a track record, and projects taken from idea to working thing. A robot that runs beats a folder of participation certificates.',
      evidence: 'Olympiad results (NMOS, APMOPS, RIPMWC, SMOPS, SASMO, SPSO), robotics and coding competitions, and a project portfolio — builds, code, experiments, write-ups.',
      startLabel: 'Test the interest first:',
      start: [{ label: 'Coding & Robotics →', to: '/c/coding_robotics' }, { label: 'Academic →', to: '/c/academic' }],
    },
    {
      id: 'debate', num: '04', tint: 'rm-dsa-t4', name: 'Debate & Public Speaking',
      share: 'Argument · oratory · the thinking voice',
      formats: ['Impromptu task', 'Essay', 'Interview'],
      how: 'Interviews plus live tasks — an impromptu speech, a mini debate round, sometimes a written piece. Topicality matters less than clarity under pressure.',
      look: 'Structured thinking on unseen questions, listening and rebuttal rather than rehearsed polish, and the reading habits that show up the moment a child opens their mouth.',
      evidence: 'Debate tournament records, public-speaking and oratorical competitions, drama and elocution history, essays and school speech roles.',
      startLabel: 'Test the interest first:',
      start: [{ label: 'Speech & Performance →', to: '/c/speech_performance' }],
    },
    {
      id: 'lang', num: '05', tint: 'rm-dsa-t5', name: 'Languages & Humanities',
      share: 'Writing · bilingualism · people, places & ideas',
      formats: ['Essay', 'Interview', 'Language task'],
      how: 'Essays and interviews; some schools set comprehension or translation tasks, and bilingual programmes may assess both languages. Expect conversation, not recitation.',
      look: 'Depth of reading, sustained curiosity about how the world works, and writing with an actual voice — the child who reads for pleasure is visible within minutes.',
      evidence: 'Writing competitions, language contests and olympiads, Mother Tongue achievements, published pieces, a reading portfolio.',
      startLabel: 'Test the interest first:',
      start: [{ label: 'Academic →', to: '/c/academic' }],
    },
    {
      id: 'uniformed', num: '06', tint: 'rm-dsa-t6', name: 'Uniformed Groups',
      share: 'Scouts · Guides · NPCC · St John & more',
      formats: ['Record review', 'Group activity', 'Interview'],
      how: "Schools review the primary-school uniformed-group record, then observe candidates in group activities and interviews. There's no audition to cram for — the record is the audition.",
      look: 'A service ethos, discipline and teamwork; badges, ranks and sustained participation; and quiet leadership within the unit — the child others follow on a camp at 6am.',
      evidence: 'Rank and badge records, service hours, camps and parades, teacher and unit-leader testimonials.',
      startLabel: 'Built in the unit itself — consistency beats any crash course.',
      start: [],
    },
    {
      id: 'leadership', num: '07', tint: 'rm-dsa-t7', name: 'Leadership',
      share: 'Prefects · councillors · the ones who organise',
      formats: ['Group challenge', 'Interview'],
      how: 'Interviews and observed group challenges — schools watch how a child actually works in a team under mild pressure, not what they claim in a form. In many schools, DSA-Leadership students join the class committee in Sec 1 and student council from Sec 2, often alongside a uniformed group.',
      look: 'A real record of responsibility — prefect, class committee, CCA leader, peer-support roles; self-reflection when asked about failure; a heart to serve; and clarity when they speak.',
      evidence: 'Appointment records, teacher testimonials, service projects, and concrete stories of leading something — however small — from start to finish.',
      startLabel: 'Communication confidence compounds here:',
      start: [{ label: 'Speech & Performance →', to: '/c/speech_performance' }],
    },
  ],
  timeline: [
    { date: 'Jan – May', t: 'Explore schools', d: 'Open houses and school DSA pages: each school lists its talent areas and selection format. Shortlist where the programme fits — not just the name on the gate.' },
    { date: '6 May, 11am', date2: '– 2 Jun, 4:30pm', key: true, t: 'Applications open — one free form', d: 'Submitted once on the MOE DSA-Sec portal: up to three choices, each tagged to a school and talent area, at most two choices at the same school.' },
    { date: 'Jun – Aug', t: 'Selection at the schools', d: 'Trials, auditions, portfolio reviews and interviews. Shortlists go out around early July; every applicant hears back by 28 August — Confirmed Offer, Wait List, or unsuccessful.' },
    { date: 'Late Sep – Oct', t: 'PSLE written papers', d: 'DSA outcomes are already known before the first paper — which is rather the point. The exam still decides the posting group.' },
    { date: '19 – 23 Oct', key: true, t: 'Rank your offers', d: 'Students holding offers submit school preferences on the portal by 4:30pm, 23 October. Rank only schools your child will genuinely commit to — this choice is binding.' },
    { date: '24 – 25 Nov', t: 'Results, with S1 posting', d: "A confirmed, ranked DSA place is guaranteed if the PSLE score qualifies for the school's posting group.", note: 'Dates tentative · verify at moe.gov.sg/secondary/dsa' },
  ],
  stages: [
    { tag: 'P3 – P4', t: 'Explore', d: 'Try widely and cheaply. The goal is honest signal: does the interest survive six months of Saturdays? Trials exist for exactly this.' },
    { tag: 'P4 – P5', t: 'Commit', d: 'Narrow to one or two areas. Regular training, first competitions, first portfolio pieces — the record starts here.' },
    { tag: 'P5', t: 'Build the record', d: 'Competitions, gradings, projects, video. Ask coaches for honest assessments, and start visiting open houses with a shortlist forming.' },
    { tag: 'P6', t: 'Apply & perform', d: "Apply in May; selection runs June–August. Rehearse the formats so nerves don't eat the talent — then let PSLE prep take the calendar back." },
  ],
  evaluate: [
    'Verified business registration and teaching credentials',
    'Structured feedback after trials — not just "it went well"',
    'Transparent pricing for anything beyond the free session',
    'No admission guarantees — schools decide, full stop',
    'Willing to say a programme is NOT a fit for your child',
  ],
  questions: [
    'What does progress look like after three months?',
    'How do you assess whether my child has an aptitude here?',
    'What proportion of your students continue after the trial?',
    'What would make you advise us not to continue?',
  ],
  faq: [
    { q: 'Does PSLE still matter if we hold a confirmed offer?', a: "Yes. The offer converts only if the PSLE score qualifies for the school's posting group under Full Subject-Based Banding. DSA changes how your child is admitted — not whether they must qualify." },
    { q: 'Can we change our mind after taking up a place?', a: "Treat the October ranking as binding. Successful DSA students don't take part in S1 posting, can't transfer schools after results are released, and are expected to honour the talent programme for its duration. Rank only schools your child will genuinely commit to." },
    { q: 'Is DSA only for national champions?', a: 'No. Schools assess aptitude and potential, not just trophies — and a large share of the ~8,000 yearly places go unfilled. The right school-talent match matters far more than raw prestige.' },
    { q: "What happens if the application doesn't succeed?", a: 'Nothing is lost. Your child goes through S1 posting exactly like everyone else — and can usually still join the same CCA at whichever school they post to.' },
    { q: 'How many talent areas can one child apply with?', a: 'Up to three choices in total, each tagged to a school and talent area — with at most two choices at the same school. Depth beats spread: three half-hearted applications rarely beat one genuine one.' },
    { q: 'Are there academic tests at selection?', a: 'Selection is talent-specific. A school may test the domain itself — an olympiad-style paper for a STEM application, say — but general academic-ability testing isn\'t part of DSA selection.' },
    { q: 'Does DSA exist beyond Secondary 1?', a: 'Yes. DSA-JC admits O-Level students to junior colleges on talent, and the polytechnics and ITE run their own aptitude-based Early Admissions Exercise (EAE). The principle is the same: demonstrated aptitude, considered before grades alone.' },
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

/**
 * Why an offer can't be redeemed right now, or null when it can.
 * 'draw_closed'   — draw entry cutoff passed (intake would 410; SGT day-end,
 *                   mirroring the backend's sgtDayEndExclusiveMs gate)
 * 'sold_out'      — no remaining capacity (zero-allocation activations
 *                   included: they can never issue a reward)
 * 'unserviceable' — ops chain unresolvable (activation/offer paused, expired)
 * Used by the card, the detail CTA AND the flow — the flow must never accept
 * submissions the pipeline can't service.
 */
export function offerUnavailability(campaign, now = new Date()) {
  const dc = campaign?.design_config || {};
  if (dc.luckyDraw?.enabled === true && dc.luckyDraw.closesAt) {
    const end = new Date(`${dc.luckyDraw.closesAt}T23:59:59.999+08:00`);
    if (!Number.isNaN(end.getTime()) && now > end) return 'draw_closed';
  }
  const ops = campaign?.ops;
  if (!ops) return 'unserviceable';
  if (ops.capacity && ops.capacity.remaining <= 0) return 'sold_out';
  return null;
}

export const UNAVAILABLE_COPY = {
  draw_closed: { cta: 'Draw closed', title: 'This draw has closed', body: 'Entries are no longer being accepted. Winners are contacted directly and listed on the winners page.' },
  sold_out: { cta: 'Fully redeemed', title: 'This offer is fully redeemed', body: 'All available slots have been claimed. New campaigns launch weekly.' },
  unserviceable: { cta: 'Currently unavailable', title: "This offer isn't available right now", body: 'It may have ended or been paused. Plenty of other offers are live.' },
};

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
