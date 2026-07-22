/**
 * Starter Terms & Conditions for a lucky-draw campaign created from the
 * workspace. Modeled clause-for-clause on the live Tokyo Getaway draw terms
 * (the first pinned draw_terms_versions row): promoter, prize, verified-entry
 * eligibility, SGT close, witnessed draw + session ×N boost, 14-day claim and
 * redraw, masked results, DNC posture, and the never-pay-for-a-prize line.
 *
 * The server pins whatever is saved as an immutable draw_terms_versions row
 * (campaignService.ensureDrawTermsVersion), and later edits mint a NEW
 * version — so this scaffold is a safe starting point, not final legal copy.
 * Campaigns start as drafts; review the generated terms in the designer
 * before launching.
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

/**
 * @param {object} opts
 * @param {string} opts.campaignName  e.g. "iPhone Lucky Draw — August 2026"
 * @param {string} opts.prize        e.g. "One (1) iPhone 17 Pro"
 * @param {string} opts.closesAt     YYYY-MM-DD (SGT)
 * @param {string} [opts.boostClosesAt]  YYYY-MM-DD; defaults to closesAt
 * @param {number} [opts.multiplier]     default 10
 */
export function buildDrawTermsHtml({ campaignName, prize, closesAt, boostClosesAt, multiplier = 10 }) {
  const name = escapeHtml((campaignName || '').trim() || 'Lucky Draw');
  const prizeText = escapeHtml((prize || '').trim());
  const closesLong = formatLongDate(closesAt);
  const boostLong = formatLongDate(boostClosesAt || closesAt) || closesLong;
  const m = Number.isInteger(multiplier) && multiplier >= 2 ? multiplier : 10;
  return [
    `<h3>Redeem &times; MKTR &mdash; ${name}</h3>`,
    '<p><strong>Promoter:</strong> MKTR PTE. LTD. (UEN 202507548M), Singapore. Redeem is a service of MKTR PTE. LTD.</p>',
    `<p><strong>Prize:</strong> ${prizeText}. The prize is not exchangeable for cash and is subject to availability and any conditions advised to the winner.</p>`,
    '<p><strong>Eligibility &amp; entry:</strong> Open to Singapore residents aged 18 and above. Entry is free. Complete the form and verify your mobile number with the one-time SMS code &mdash; one entry per verified mobile number.</p>',
    `<p><strong>Entry period:</strong> Entries close at 23:59 (SGT) on ${closesLong}. Entries received after that time are not eligible.</p>`,
    `<p><strong>The draw:</strong> One winner is drawn at random from all verified entries after the entry period closes, in a process witnessed by MKTR staff. Completing a complimentary financial-review session on or before ${boostLong} earns you ${m} entries instead of one.</p>`,
    "<p><strong>Winner notification &amp; claim:</strong> The winner is contacted directly by phone or SMS using the details provided and has fourteen (14) days to respond and claim. If unclaimed within 14 days, a replacement winner is drawn. Results are posted, with the winner's masked details, at redeem.sg/winners.</p>",
    '<p><strong>Data &amp; contact:</strong> By entering you agree to be contacted by MKTR and its financial-advisory representatives about this promotion and related services, in line with our Personal Data Policy. We honour the Do Not Call registry and every opt-out.</p>',
    '<p><strong>Integrity:</strong> MKTR will never ask you to pay a fee to release a prize. Anyone requesting payment is not us &mdash; report them to hello@redeem.sg.</p>',
  ].join('\n');
}
