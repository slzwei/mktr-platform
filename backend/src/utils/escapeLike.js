/**
 * LIKE/ILIKE-safe literal: trim → cap at 100 chars → escape backslash, %, _.
 * The listProspects sanitizer (prospectService) escapes only %/_ and never
 * trims — this is the corrected shared form (admin-people-directory §4.1).
 * Pair every use with an explicit `ESCAPE '\'` clause so the contract is
 * visible at the call site.
 */
export function escapeLike(raw) {
  return String(raw ?? '')
    .trim()
    .slice(0, 100)
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_');
}
