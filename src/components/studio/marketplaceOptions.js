/**
 * Marketplace listing option lists shared by the Distribution panel and the
 * AI review panel (pick-row display labels). Values mirror the backend
 * validator (backend/src/utils/marketplaceContent.js) — the save clamp
 * re-validates, so a drifted id degrades to a dropped value, never a write.
 */

export const CATEGORY_OPTIONS = [
  ['art_creativity', 'Art & Creativity'],
  ['coding_robotics', 'Coding & Robotics'],
  ['speech_performance', 'Speech & Performance'],
  ['sports_movement', 'Sports & Movement'],
  ['music_dance', 'Music & Dance'],
  ['academic', 'Academic'],
  ['family_lifestyle', 'Family & Lifestyle'],
  ['wellness', 'Wellness'],
  ['dining', 'Dining'],
  ['financial_education', 'Financial Education'],
];

export const OFFER_TYPES = ['trial', 'assessment', 'workshop', 'reward', 'consultation'];
export const MODES = ['physical', 'online', 'hybrid'];
