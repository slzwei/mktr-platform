import { sequelize, ProspectActivity } from '../models/index.js';
import IdempotencyKey from '../models/IdempotencyKey.js';
import { sendEmail } from './mailer.js';
import { logger } from '../utils/logger.js';

/**
 * screeningAlerts — loud-failure surfacing for the undeliverable-hold state
 * (docs/plans/draw-launch-integrity-scope.md §2.2, Codex R1 CX-fold).
 *
 * The state it alarms: a lead PASSED the AI screening call but release keeps
 * failing (`no_intended_agent` / `no_subscriber`) because the campaign has no
 * funded, provenance-carrying agent. Before PR-1 this looped as one warn line
 * per 5-min sweep pass, forever, visible only in Render logs — the exact
 * silent state the 07-24 prod incident sat in for hours.
 *
 * Two channels, both idempotent:
 *  - ONE ProspectActivity per lead ("fund a package"), so the admin drawer
 *    shows WHY the lead is stuck without log access.
 *  - ONE ops email per campaign per 24h. Both are gated by ONE atomic
 *    idempotency claim (INSERT … ON CONFLICT DO UPDATE WHERE expired …
 *    RETURNING) — exactly one concurrent sweep call wins the window (M6).
 *
 * Only alarms holds older than MIN_HOLD_ALERT_MS: a capture-time transient
 * (subscriber briefly disabled, race with funding) must not page anyone —
 * the 5-min sweep retries reach here again once the hold is genuinely stale.
 */

const MIN_HOLD_ALERT_MS = 30 * 60 * 1000; // 30 min held-and-qualified before alarming
const EMAIL_THROTTLE_MS = 24 * 60 * 60 * 1000; // one ops email per campaign per day
const ACTIVITY_ALERT_TAG = 'screening_undeliverable';
const THROTTLE_SCOPE = 'screening:undeliverable-alert';
// Effectively-forever claim for the once-per-lead activity: the hourly
// idempotency cleanup only purges expiresAt < now, so this row never dies.
const ACTIVITY_CLAIM_TTL_MS = 100 * 365 * 24 * 60 * 60 * 1000;

/**
 * Atomically claim (scope, key) for ttlMs — exactly ONE concurrent caller
 * wins. The INSERT takes a fresh row; when the stored claim has EXPIRED the
 * conditional DO UPDATE revives it for a single winner; a live claim returns
 * no row. (M6: the old select-then-insert/update raced — concurrent sweep
 * calls both saw no throttle row, the loser's caught unique error was
 * DISCARDED and both continued to sendEmail; an expired row was update-raced
 * by both callers the same way.)
 */
async function claimIdempotencyWindow(d, { scope, key, ttlMs, meta = null }) {
  const [rows] = await d.sequelize.query(
    `INSERT INTO idempotency_keys
       (scope, key, "responseBody", "responseCode", "expiresAt", "createdAt", "updatedAt")
     VALUES (:scope, :key, CAST(:body AS json), 200, :expiresAt, now(), now())
     ON CONFLICT (scope, key) DO UPDATE
       SET "expiresAt" = EXCLUDED."expiresAt", "updatedAt" = now()
       WHERE idempotency_keys."expiresAt" <= now()
     RETURNING key`,
    {
      replacements: {
        scope,
        key,
        body: meta ? JSON.stringify(meta) : null,
        expiresAt: new Date(d.now() + ttlMs),
      },
    }
  );
  return Array.isArray(rows) && rows.length > 0;
}

function alertRecipient() {
  return process.env.SCREENING_ALERT_EMAIL || process.env.SMS_ALERT_EMAIL || null;
}

const defaultDeps = {
  sequelize,
  ProspectActivity,
  IdempotencyKey,
  sendEmail,
  logger,
  now: () => Date.now(),
};

/**
 * Fire-and-forget alarm for one undeliverable qualified hold. Never throws.
 * Returns a status object for tests/logs.
 */
export async function notifyUndeliverableHold({ prospect, reason, campaign = null }, overrides = {}) {
  const d = { ...defaultDeps, ...overrides };
  try {
    const heldAt = prospect?.quarantinedAt ? new Date(prospect.quarantinedAt).getTime() : NaN;
    if (!Number.isFinite(heldAt) || d.now() - heldAt < MIN_HOLD_ALERT_MS) {
      return { alerted: false, reason: 'too_fresh' };
    }

    // Once-per-lead activity. The atomic claim is the RACE gate (exactly one
    // concurrent sweep call wins); the probe keeps claim-era calls from
    // double-writing next to historical rows created before the claim existed.
    const activityClaimed = await claimIdempotencyWindow(d, {
      scope: THROTTLE_SCOPE,
      key: `${ACTIVITY_ALERT_TAG}:${prospect.id}`,
      ttlMs: ACTIVITY_CLAIM_TTL_MS,
      meta: { prospectId: prospect.id },
    });
    const [rows] = await d.sequelize.query(
      `SELECT 1 FROM prospect_activities
        WHERE "prospectId" = :id AND metadata->>'alert' = :tag LIMIT 1`,
      { replacements: { id: prospect.id, tag: ACTIVITY_ALERT_TAG } }
    );
    const activityExists = Array.isArray(rows) && rows.length > 0;
    const activityCreated = activityClaimed && !activityExists;
    if (activityCreated) {
      await d.ProspectActivity.create({
        prospectId: prospect.id,
        type: 'updated',
        actorUserId: null,
        description:
          'Held — passed AI screening but has no deliverable agent. Fund a lead package for this campaign; the sweep auto-delivers within ~5 minutes once funded.',
        metadata: { alert: ACTIVITY_ALERT_TAG, reason },
      });
    }

    // Per-campaign 24h email throttle — the SAME atomic claim: absent row →
    // insert wins; expired row → one winner revives it; live row → throttled.
    // Send ONLY when the claim returned a row (M6).
    const to = alertRecipient();
    if (!to) return { alerted: activityCreated, email: 'unconfigured' };

    const throttleKey = `${THROTTLE_SCOPE}:${prospect.campaignId || 'none'}`;
    const nowMs = d.now();
    const emailClaimed = await claimIdempotencyWindow(d, {
      scope: THROTTLE_SCOPE,
      key: throttleKey,
      ttlMs: EMAIL_THROTTLE_MS,
      meta: { campaignId: prospect.campaignId || null },
    });
    if (!emailClaimed) {
      return { alerted: activityCreated, email: 'throttled' };
    }

    const campaignName = campaign?.name || prospect.campaignId || 'unknown campaign';
    const heldMins = Math.round((nowMs - heldAt) / 60000);
    await d.sendEmail({
      to,
      subject: `[MKTR] Qualified lead stuck ${heldMins}m — no deliverable agent (${campaignName})`,
      text: [
        `A lead passed the AI screening call but cannot be delivered (${reason}).`,
        '',
        `Campaign: ${campaignName} (${prospect.campaignId || '-'})`,
        `Lead: ${prospect.id} — held since ${new Date(heldAt).toISOString()} (${heldMins} min)`,
        '',
        'Action: assign a funded lead package to this campaign (mktr.sg admin → Packages).',
        'The screening sweep retries every 5 minutes and will deliver automatically once a funded agent exists.',
        'Further leads on this campaign will hit the same wall until then; this alert is throttled to one per campaign per 24h.',
      ].join('\n'),
    });
    d.logger.info('[Screening] undeliverable-hold alert emailed', { prospectId: prospect.id, campaignId: prospect.campaignId, to });
    return { alerted: true, email: 'sent' };
  } catch (err) {
    d.logger.warn('[Screening] undeliverable-hold alert failed (non-blocking)', {
      prospectId: prospect?.id,
      error: err?.message || String(err),
    });
    return { alerted: false, error: err?.message };
  }
}

export default { notifyUndeliverableHold };
