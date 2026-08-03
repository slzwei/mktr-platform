/**
 * sgtAgeFromDob (M8): age on the SINGAPORE calendar, independent of server TZ.
 * The old gate compared server-LOCAL date parts — on a UTC host an applicant
 * whose birthday began at 00:00 SGT stayed underage until 08:00 SGT.
 */
import { sgtAgeFromDob } from '../../src/utils/sgtTime.js';

describe('sgtAgeFromDob', () => {
  // 2026-08-02T17:00:00Z = 2026-08-03 01:00 SGT — the UTC calendar still says
  // Aug 2, the Singapore calendar already says Aug 3.
  const SGT_PAST_MIDNIGHT = new Date('2026-08-02T17:00:00Z');

  it('counts a birthday from 00:00 SGT even while the UTC date lags behind', () => {
    // 21st birthday on 2026-08-03 (SGT): already 21 at 01:00 SGT.
    expect(sgtAgeFromDob('2005-08-03', SGT_PAST_MIDNIGHT)).toBe(21);
    // The pre-fix local-calendar math on a UTC host said 20 here — the exact
    // 00:00–08:00 SGT rejection window the review flagged.
    const utcLocal = new Date('2026-08-02T17:00:00Z');
    let preFixAge = utcLocal.getUTCFullYear() - 2005;
    const m = utcLocal.getUTCMonth() - (8 - 1);
    if (m < 0 || (m === 0 && utcLocal.getUTCDate() < 3)) preFixAge--;
    expect(preFixAge).toBe(20); // documents the divergence this fix removes
  });

  it('is not yet a birthday the SGT day before', () => {
    const beforeMidnightSgt = new Date('2026-08-02T15:00:00Z'); // 23:00 SGT Aug 2
    expect(sgtAgeFromDob('2005-08-03', beforeMidnightSgt)).toBe(20);
  });

  it('handles ordinary mid-year dates', () => {
    expect(sgtAgeFromDob('1990-06-15', new Date('2026-08-02T12:00:00Z'))).toBe(36);
    expect(sgtAgeFromDob('1990-12-31', new Date('2026-08-02T12:00:00Z'))).toBe(35);
  });

  it('rejects garbage, TZ-bearing strings, and impossible calendar dates', () => {
    expect(sgtAgeFromDob('15/06/1990')).toBeNull();
    expect(sgtAgeFromDob('1990-06-15T23:00:00-11:00')).toBeNull();
    expect(sgtAgeFromDob('2012-02-31')).toBeNull();
    expect(sgtAgeFromDob(19900615)).toBeNull();
  });
});
