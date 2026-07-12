// Lucky-draw results shown on redeem.sg/winners — edit this file to post a
// winner; the page's empty state shows until this list has entries.
//
// PDPA rules baked into the format: mask the name to first name + initial,
// mask the entry number (keep last 3-4 digits), photo ONLY with the winner's
// written permission (photoCaption should say so). Photos live in
// public/winners/ (JPG/PNG, roughly square, ≥600px).
//
// Newest draw first — the top entry renders as the featured card. Example:
//
//   {
//     draw: 'Drop 08',                    // which drop/campaign the draw belonged to
//     prize: 'Cabin luggage',
//     prizeMeta: 'Hardshell spinner · 1 of 300 entries drawn',
//     name: 'Sarah T.',                   // masked
//     entry: '9••• •312',                 // masked mobile/entry number
//     area: 'Bedok',                      // optional
//     drawnOn: '20 Jul 2026',
//     status: 'claimed',                  // 'claimed' | 'pending' (contacted, not yet collected)
//     photo: '/winners/drop08-sarah.jpg', // optional — omit for initials avatar
//     photoCaption: 'Sarah collects her luggage',
//   },

export const WINNERS = [];
