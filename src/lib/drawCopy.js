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
