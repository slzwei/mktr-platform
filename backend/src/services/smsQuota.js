import { logger } from '../utils/logger.js';
import { sendEmail } from './mailer.js';
import { bump, unbump, blindPhone, sgtDayKey, nextSgtMidnight } from './rateCounter.js';

/**
 * SMS abuse controls for the `MKTR` SSIR-registered Sender ID.
 *
 * Why this exists: POST /api/verify/send is unauthenticated and public, and it
 * causes an SMS bearing our registered SID to be delivered to any caller-supplied
 * +65 number. Without a per-number ceiling that endpoint can be driven as an SMS
 * bomber — the messages would read as coming from "MKTR", and under the SSIR User
 * Agreement (cl. 8A.1.2) a regulator complaint can get the SID suspended outright.
 * Losing the SID stops OTP, and campaignReadinessService already treats a dead OTP
 * channel as a total lead-capture blocker — so this is uptime, not just paperwork.
 *
 * Two independent ceilings:
 *   - per phone/day  — anti-harassment. Counts BOTH channels: a WhatsApp-first
 *     campaign still falls back to SMS, and bombing someone over WhatsApp is no
 *     more acceptable than over SMS.
 *   - global/day     — blast radius. Counts only messages actually published to
 *     SNS, so it measures real SMS spend and nothing else.
 *
 * Defaults are sized off real traffic (60-day window to 2026-07-21): busiest day
 * ever = 16 leads, mean 5.7 per active day. OTP sends run ~2-3x leads once
 * drop-off and resends are counted, so the worst real day was ≈50 SMS. 500 leaves
 * ~10x headroom for a campaign spike; the 250 alert fires at ~5x peak, well before
 * the hard stop. Both are env-tunable — raise them for a big launch rather than
 * letting an alert be ignored.
 */

const num = (envVal, fallback) => {
  const n = Number.parseInt(envVal, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const perPhoneCap = () => num(process.env.SMS_DAILY_CAP_PER_PHONE, 7);
export const globalCap = () => num(process.env.SMS_DAILY_GLOBAL_CAP, 500);
export const alertThreshold = () => num(process.env.SMS_DAILY_ALERT_THRESHOLD, 250);

const phoneKey = (phone, day) => `otp:phone:${blindPhone(phone)}:${day}`;
const globalKey = (day) => `sms:global:${day}`;
const alertKey = (day, kind) => `sms:alert:${kind}:${day}`;

export const defaultDeps = { sendEmail, logger };

/**
 * Claim one OTP send against the per-number daily allowance.
 *
 * Counts the attempt before dispatch (fail-closed): a caller that keeps hammering
 * past the cap just pushes the counter higher, which is harmless because we only
 * compare against it. Release it with releasePhoneOtpQuota() if the send fails for
 * an infrastructure reason so a genuine user isn't billed for our outage.
 */
export async function reservePhoneOtpQuota(phone, now = new Date()) {
  const cap = perPhoneCap();
  const day = sgtDayKey(now);
  const { count, expiresAt } = await bump(phoneKey(phone, day), nextSgtMidnight(now));
  return { ok: count <= cap, count, cap, retryAt: expiresAt };
}

export async function releasePhoneOtpQuota(phone, now = new Date()) {
  await unbump(phoneKey(phone, sgtDayKey(now)));
}

/**
 * Claim one message against the global daily SMS ceiling. Call this immediately
 * before publishing to SNS — including the WhatsApp→SMS fallback path, which is a
 * real SMS and must be counted.
 */
export async function reserveGlobalSmsQuota(deps = {}, now = new Date()) {
  const d = { ...defaultDeps, ...deps };
  const cap = globalCap();
  const day = sgtDayKey(now);
  const { count } = await bump(globalKey(day), nextSgtMidnight(now));

  if (count > cap) {
    await raiseAlert(d, 'ceiling', { count, cap, day });
    return { ok: false, count, cap };
  }
  if (count >= alertThreshold()) {
    await raiseAlert(d, 'spike', { count, cap, day });
  }
  return { ok: true, count, cap };
}

export async function releaseGlobalSmsQuota(now = new Date()) {
  await unbump(globalKey(sgtDayKey(now)));
}

/**
 * Emit a volume alert at most once per kind per day. The once-per-day claim is
 * itself an atomic counter bump — the first bump returns 1 and wins, so parallel
 * instances can't double-send. Never throws: an alert failure must not take the
 * OTP path down with it.
 */
async function raiseAlert(d, kind, { count, cap, day }) {
  try {
    const { count: claim } = await bump(alertKey(day, kind), nextSgtMidnight());
    if (claim !== 1) return; // already alerted today

    const subject = kind === 'ceiling'
      ? `[MKTR] SMS DAILY CEILING HIT — sending halted (${count}/${cap})`
      : `[MKTR] SMS volume spike — ${count}/${cap} today`;

    const body = [
      kind === 'ceiling'
        ? 'The global daily SMS ceiling has been reached. Further OTP SMS are being REFUSED until Singapore midnight.'
        : 'SMS volume today has crossed the alert threshold. This is a warning only — sending continues.',
      '',
      `Singapore day : ${day}`,
      `Sent today    : ${count}`,
      `Daily ceiling : ${cap}`,
      `Alert at      : ${alertThreshold()}`,
      '',
      'If this is a genuine campaign spike, raise SMS_DAILY_GLOBAL_CAP on the backend.',
      'If it is not, the public OTP endpoint is being abused: our SSIR Sender ID "MKTR"',
      'is on every one of these messages. Check /api/verify/send traffic before it',
      'becomes an SGNIC complaint.',
    ].join('\n');

    // Counts only — never the numbers that were messaged.
    d.logger.error({ kind, count, cap, day }, 'sms_quota.alert');

    const to = process.env.SMS_ALERT_EMAIL;
    if (to) {
      await d.sendEmail({ to, subject, text: body });
      d.logger.info({ to, kind }, 'sms_quota.alert_email_sent');
    }
  } catch (err) {
    d.logger.warn({ err: err.message, kind }, 'sms_quota.alert_failed');
  }
}
