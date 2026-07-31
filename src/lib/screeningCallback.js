/**
 * The success-page heads-up for campaigns whose AI screening call fires right
 * after signup: "an automated call from +65 6277 3210 will ring you in about a
 * minute". Deliberately server-fed — the shape comes from the public campaign
 * payload (`campaign.screeningCallback`, built by backend
 * utils/screeningEnv.js) rather than being derived here, so:
 *
 *  - the number printed is always the number the dialer actually calls FROM
 *    (one env var, no frontend copy to drift);
 *  - the promise is only made when the deployment can really keep it — the
 *    field is absent when the feature is off, dry-run, or misconfigured, and
 *    absent means render nothing.
 *
 * Shape: { number, etaMinutes, callWindow, windowOpen }.
 */

/** '+6562773210' → '+65 6277 3210'. Non-SG / odd lengths pass through as-is. */
export function formatCallerId(e164) {
  const raw = String(e164 || '').trim();
  const m = /^\+65(\d{4})(\d{4})$/.exec(raw);
  return m ? `+65 ${m[1]} ${m[2]}` : raw;
}

/** '10:00-20:00' → '10am'; the half-hour case → '10.30am'. */
export function formatWindowOpensLabel(callWindow) {
  const m = /^(\d{1,2}):(\d{2})-/.exec(String(callWindow || '').trim());
  if (!m) return null;
  const hour24 = Number(m[1]);
  const minutes = Number(m[2]);
  if (!Number.isFinite(hour24) || hour24 > 23) return null;
  const suffix = hour24 >= 12 ? 'pm' : 'am';
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}${minutes ? `.${String(minutes).padStart(2, '0')}` : ''}${suffix}`;
}

/**
 * The one sentence, or null when there is nothing honest to say. Two timings:
 * inside the calling window it is "in about a minute"; outside it, the dialer
 * defers to the next window open, so the copy promises that instead of a
 * minute it cannot deliver at 2am.
 */
export function screeningCallbackLine(cb) {
  if (!cb || typeof cb !== 'object') return null;
  const caller = cb.number ? formatCallerId(cb.number) : null;
  const from = caller ? `An automated call from ${caller}` : 'An automated call';

  if (cb.windowOpen === false) {
    const opens = formatWindowOpensLabel(cb.callWindow);
    return `${from} will ring you ${opens ? `after ${opens}` : 'once our lines open'} to confirm a few details — it takes about a minute.`;
  }

  const mins = Number(cb.etaMinutes);
  const when = Number.isFinite(mins) && mins > 1 ? `in about ${Math.round(mins)} minutes` : 'in about a minute';
  return `${from} will ring you ${when} to confirm a few details — please pick up.`;
}
