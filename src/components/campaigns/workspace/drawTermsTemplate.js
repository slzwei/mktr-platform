/**
 * Starter Terms & Conditions for a lucky-draw campaign created from the
 * workspace. Modeled clause-for-clause on the live Tokyo Getaway draw terms
 * (the first pinned draw_terms_versions row): promoter, prize(s), verified-entry
 * eligibility, SGT close, witnessed draw + session ×N boost, 14-day claim and
 * redraw, masked results, DNC posture, and the never-pay-for-a-prize line.
 *
 * Structured prizes ([{qty, name}], array order = award order) pluralize the
 * prize/draw/notification clauses; a single prize unit produces the exact
 * legacy wording. The server pins whatever is saved as an immutable
 * draw_terms_versions row (campaignService.ensureDrawTermsVersion), and later
 * edits mint a NEW version — so this scaffold is a safe starting point, not
 * final legal copy. Campaigns start as drafts; review the generated terms in
 * the designer before launching.
 */

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** '2026-10-30' → '30 October 2026' (string split — SGT calendar date). */
export function formatLongDate(ymd) {
  const m = typeof ymd === 'string' ? ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/) : null;
  if (!m) return '';
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${Number(m[3])} ${month} ${m[1]}` : '';
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

/** Legal-style count words, 1..99 ("One", "Three", "Twenty-five"); digits beyond. */
export function numberWords(n) {
  if (!Number.isInteger(n) || n < 1 || n > 99) return String(n);
  if (n < 20) return ONES[n];
  const tens = TENS[Math.floor(n / 10)];
  const one = n % 10;
  return one ? `${tens}-${ONES[one].toLowerCase()}` : tens;
}

/** Valid rows only: {qty 1.., name non-empty}; mirrors the server normalizer's shape. */
function cleanRows(prizes) {
  if (!Array.isArray(prizes)) return [];
  return prizes
    .filter((p) => p && typeof p.name === 'string' && p.name.trim())
    .map((p) => ({
      qty: Number.isInteger(Number(p.qty)) && Number(p.qty) >= 1 ? Number(p.qty) : 1,
      name: p.name.trim(),
    }));
}

/**
 * @param {object} opts
 * @param {string} opts.campaignName  e.g. "iPhone Lucky Draw — August 2026"
 * @param {Array<{qty:number,name:string}>} [opts.prizes]  structured prizes, award order
 * @param {string} [opts.prize]      legacy single free-text prize (used when prizes absent)
 * @param {string} opts.closesAt     YYYY-MM-DD (SGT)
 * @param {string} [opts.boostClosesAt]  YYYY-MM-DD; defaults to closesAt
 * @param {number} [opts.multiplier]     default 10
 * @param {number} [opts.minAge]         default 18 (defaults keep legacy output byte-identical)
 * @param {'sms'|'whatsapp'} [opts.verification]  default 'sms'
 */
export function buildDrawTermsHtml({ campaignName, prizes, prize, closesAt, boostClosesAt, multiplier = 10, minAge = 18, verification = 'sms' }) {
  const name = escapeHtml((campaignName || '').trim() || 'Lucky Draw');
  const rows = cleanRows(prizes);
  const legacyRows = rows.length ? rows : cleanRows(prize ? [{ qty: 1, name: prize }] : []);
  const total = legacyRows.reduce((sum, p) => sum + p.qty, 0);
  const closesLong = formatLongDate(closesAt);
  const boostLong = formatLongDate(boostClosesAt || closesAt) || closesLong;
  const m = Number.isInteger(multiplier) && multiplier >= 2 ? multiplier : 10;

  // One prize unit → the exact legacy singular wording (regression-pinned);
  // multiple units → enumerated prizes, N winners, exhaust-quantity award order.
  const single = total <= 1;
  const prizeClause = single
    ? `<p><strong>Prize:</strong> ${escapeHtml(legacyRows[0]?.name || '')}. The prize is not exchangeable for cash and is subject to availability and any conditions advised to the winner.</p>`
    : [
        '<p><strong>Prizes:</strong></p>',
        '<ol>',
        ...legacyRows.map((p) => `<li>${numberWords(p.qty)} (${p.qty}) &times; ${escapeHtml(p.name)}</li>`),
        '</ol>',
        '<p>Prizes are not exchangeable for cash and are subject to availability and any conditions advised to winners.</p>',
      ].join('\n');
  const drawClause = single
    ? `<p><strong>The draw:</strong> One winner is drawn at random from all verified entries after the entry period closes, in a process witnessed by MKTR staff. Completing a complimentary financial-review session on or before ${boostLong} earns you ${m} entries instead of one.</p>`
    : `<p><strong>The draw:</strong> ${numberWords(total)} (${total}) winners are drawn at random from all verified entries after the entry period closes, in a process witnessed by MKTR staff. Prizes are awarded in the order listed above, with each prize awarded its stated number of times before the draw moves to the next. Each verified mobile number can win at most one prize. Completing a complimentary financial-review session on or before ${boostLong} earns you ${m} entries instead of one.</p>`;
  const notifyClause = single
    ? "<p><strong>Winner notification &amp; claim:</strong> The winner is contacted directly by phone or SMS using the details provided and has fourteen (14) days to respond and claim. If unclaimed within 14 days, a replacement winner is drawn. Results are posted, with the winner's masked details, at redeem.sg/winners.</p>"
    : "<p><strong>Winner notification &amp; claim:</strong> Winners are contacted directly by phone or SMS using the details provided, and each has fourteen (14) days to respond and claim. If a prize is unclaimed within 14 days, a replacement winner is drawn for that prize. Results are posted, with each winner's masked details, at redeem.sg/winners.</p>";

  return [
    `<h3>Redeem &times; MKTR &mdash; ${name}</h3>`,
    '<p><strong>Promoter:</strong> MKTR PTE. LTD. (UEN 202507548M), Singapore. Redeem is a service of MKTR PTE. LTD.</p>',
    prizeClause,
    `<p><strong>Eligibility &amp; entry:</strong> Open to Singapore residents aged ${Number.isInteger(minAge) && minAge > 18 ? minAge : 18} and above. Entry is free. Complete the form and verify your mobile number with the one-time ${verification === 'whatsapp' ? 'WhatsApp' : 'SMS'} code &mdash; one entry per verified mobile number.</p>`,
    `<p><strong>Entry period:</strong> Entries close at 23:59 (SGT) on ${closesLong}. Entries received after that time are not eligible.</p>`,
    drawClause,
    notifyClause,
    '<p><strong>Data &amp; contact:</strong> By entering you agree to be contacted by MKTR and its financial-advisory representatives about this promotion and related services, in line with our Personal Data Policy. We honour the Do Not Call registry and every opt-out.</p>',
    '<p><strong>Integrity:</strong> MKTR will never ask you to pay a fee to release a prize. Anyone requesting payment is not us &mdash; report them to hello@redeem.sg.</p>',
  ].join('\n');
}
