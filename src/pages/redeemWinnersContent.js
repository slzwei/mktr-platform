// Lucky-draw results shown on redeem.sg/winners — edit this file to post a
// result; the page's empty state shows until this list has entries.
//
// PDPA rules baked into the format: mask the name to first name + initial,
// mask the entry number (keep last 3-4 digits), photo ONLY with the winner's
// written permission (photoCaption should say so). Photos live in
// public/winners/ (JPG/PNG, roughly square, ≥600px).
//
// ONE ENTRY = ONE DRAW, not one winner. A draw that awards several prizes
// carries all of its winners in `winners[]`, so a 5-winner draw renders as one
// result with five masked names rather than five unrelated-looking cards.
// Newest draw first — the top entry becomes the featured result.
//
//   {
//     draw: 'Draw 05',
//     prize: 'AirPods Pro 3',
//     prizeMeta: 'Five winners drawn from 2,140 verified entries',
//     drawnOn: '30 Sep 2026',
//     archTag: 'prize: airpods',          // optional caption for the placeholder panel
//     winners: [
//       { name: 'Sarah T.', entry: '9••• •312', area: 'Bedok', status: 'claimed' },
//       { name: 'Marcus L.', entry: '8••• •907', status: 'pending' },
//     ],
//   },
//
// A single-winner draw may keep the flat shape — `name`/`entry`/`area`/`status`
// directly on the row — and renders identically. Both forms are accepted.

export const WINNERS = [];

/** Board label for a winner's claim state. Unknown/missing → treated as drawn. */
export function statusLabel(status) {
  return status === 'pending' ? 'Contacted' : 'Claimed';
}

/**
 * The winners of one draw, in award order, whichever shape the row used.
 * Always an array — a flat single-winner row becomes a one-element list, so
 * every render path can treat draws uniformly.
 */
export function winnersOf(row) {
  if (Array.isArray(row?.winners) && row.winners.length > 0) return row.winners;
  if (!row?.name && !row?.entry) return [];
  return [{ name: row.name, entry: row.entry, area: row.area, status: row.status }];
}

/**
 * A draw's overall claim state: 'Claimed' only once EVERY winner has claimed —
 * the same rule the engine applies to the draw record, so the public board and
 * the ledger can never disagree about whether a draw is finished.
 */
export function drawStatusLabel(row) {
  const winners = winnersOf(row);
  if (winners.length === 0) return statusLabel(row?.status);
  return winners.every((w) => w.status !== 'pending') ? 'Claimed' : 'Contacted';
}
