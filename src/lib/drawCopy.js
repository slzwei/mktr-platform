/**
 * The ONE neutral phrasing for how a draw's ×N boost is earned (plan §9.11):
 * boost evidence can be a consultant QR SCAN or an approved virtual-session
 * confirmation, so customer copy says "records", never "scans" — a
 * virtual-session entrant must not be told a scan is mandatory. Imported by
 * the marketplace surfaces AND the campaign-page draw templates so the two
 * doors can never drift on this sentence.
 */

export const DRAW_RECORD_PHRASE = 'your consultant records your completed session';

/** e.g. "×10 when your consultant records your completed session — any time before 30 October 2026." */
export function drawBoostLine(multiplier, boostDateLong) {
  const m = multiplier || 10;
  return `×${m} when ${DRAW_RECORD_PHRASE}${boostDateLong ? ` — any time before ${boostDateLong}` : ''}.`;
}

/**
 * Draw-chrome copy DEFAULTS — the composed strings the draw templates render
 * when a campaign has no `content.drawCopy` override. One module feeds the
 * templates AND the Studio panel placeholders, so what the operator sees as
 * "default" is byte-identical to what an untouched campaign renders.
 * Overrides are STATIC text: they do not re-derive when draw config changes.
 */
export const DRAW_TRUST_ROW_DEFAULT = 'SMS-VERIFIED · ONE ENTRY PER NUMBER · FREE TO ENTER';
export const DRAW_SCAM_LINE_DEFAULT = 'We never ask for payment to release a prize.';

export function drawWinnersNoteDefault(winners) {
  return winners > 1 ? 'Winners contacted directly.' : 'Winner contacted directly.';
}

export function drawCtaSublineDefault(multiplier) {
  return `THEN MEET A CONSULTANT · PASS SCANNED · ENTRY ×${multiplier || 10}`;
}

export function drawBoostBodyDefault(multiplier, boostDateLong) {
  return `Meet a consultant for a complimentary 20-minute financial review before ${boostDateLong} — when ${DRAW_RECORD_PHRASE}, your 1 entry becomes ${multiplier || 10}.`;
}
