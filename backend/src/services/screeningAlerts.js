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
 *  - ONE ops email per campaign per 24h (throttled via idempotency_keys —
 *    `key` is the table's PRIMARY KEY, so the throttle key embeds the scope
 *    prefix and an expired row is refreshed in place, never insert-raced).
 *
 * Only alarms holds older than MIN_HOLD_ALERT_MS: a capture-time transient
 * (subscriber briefly disabled, race with funding) must not page anyone —
 * the 5-min sweep retries reach here again once the hold is genuinely stale.
 */

const MIN_HOLD_ALERT_MS = 30 * 60 * 1000; // 30 min held-and-qualified before alarming
const EMAIL_THROTTLE_MS = 24 * 60 * 60 * 1000; // one ops email per campaign per day
const ACTIVITY_ALERT_TAG = 'screening_undeliverable';
const THROTTLE_SCOPE = 'screening:undeliverable-alert';

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

    // Once-per-lead activity. metadata->>'alert' is the dedup tag — checked
    // with a raw indexed-enough probe (small per-prospect activity sets).
    const [rows] = await d.sequelize.query(
      `SELECT 1 FROM prospect_activities
        WHERE "prospectId" = :id AND metadata->>'alert' = :tag LIMIT 1`,
      { replacements: { id: prospect.id, tag: ACTIVITY_ALERT_TAG } }
    );
    const activityExists = Array.isArray(rows) && rows.length > 0;
    if (!activityExists) {
      await d.ProspectActivity.create({
        prospectId: prospect.id,
        type: 'updated',
        actorUserId: null,
        description:
          'Held — passed AI screening but has no deliverable agent. Fund a lead package for this campaign; the sweep auto-delivers within ~5 minutes once funded.',
        metadata: { alert: ACTIVITY_ALERT_TAG, reason },
      });
    }

    // Per-campaign 24h email throttle. `key` is the PK — no row expiry job
    // exists, so an expired throttle row is UPDATEd back to life rather than
    // re-created (insert would PK-collide forever after the first day).
    const to = alertRecipient();
    if (!to) return { alerted: !activityExists, email: 'unconfigured' };

    const throttleKey = `${THROTTLE_SCOPE}:${prospect.campaignId || 'none'}`;
    const nowMs = d.now();
    const existing = await d.IdempotencyKey.findOne({ where: { key: throttleKey } });
    if (existing && new Date(existing.expiresAt).getTime() > nowMs) {
      return { alerted: !activityExists, email: 'throttled' };
    }
    if (existing) {
      await existing.update({ expiresAt: new Date(nowMs + EMAIL_THROTTLE_MS) });
    } else {
      await d.IdempotencyKey.create({
        key: throttleKey,
        scope: THROTTLE_SCOPE,
        responseBody: { campaignId: prospect.campaignId || null },
        responseCode: 200,
        expiresAt: new Date(nowMs + EMAIL_THROTTLE_MS),
      }).catch((err) => {
        // Lost a same-instant race — the winner sends; treat as throttled.
        if (err?.name === 'SequelizeUniqueConstraintError') return null;
        throw err;
      });
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
