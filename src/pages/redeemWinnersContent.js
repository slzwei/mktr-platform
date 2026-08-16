// Lucky-draw results shown on redeem.sg/winners — edit this file to post a
// winner; the page's empty state shows until this list has entries.
//
// PDPA rules baked into the format: mask the name to first name + initial,
// mask the entry number (keep last 3-4 digits), photo ONLY with the winner's
// written permission (photoCaption should say so). Photos live in
// public/winners/ (JPG/PNG, roughly square, ≥600px).
//
// Newest draw first — the top entry renders as the featured result and the
// rest fill the "Earlier draws" ledger. Example:
//
//   {
//     draw: 'Draw 04',                    // which drop/campaign the draw belonged to
//     prize: 'Family staycation for four',
//     prizeMeta: 'Two nights, weekend stay · drawn from 1,240 verified entries',
//     name: 'Sarah T.',                   // masked
//     entry: '9••• •312',                 // masked mobile/entry number
//     area: 'Bedok',                      // optional
//     drawnOn: '20 Jul 2026',
//     status: 'claimed',                  // 'claimed' | 'pending' (contacted, not yet collected)
//     archTag: 'prize: staycation',       // optional caption for the placeholder panel
//     photo: '/winners/draw04-sarah.jpg', // optional — omit for the placeholder panel
//     photoCaption: 'Sarah collects her staycation',
//   },

export const WINNERS = [];

/** Board label for a winner's claim state. Unknown/missing → treated as drawn. */
export function statusLabel(status) {
  return status === 'pending' ? 'Contacted' : 'Claimed';
}
