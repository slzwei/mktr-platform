import { QueryTypes } from 'sequelize';
import {
  sequelize, EmailBroadcast, EmailBroadcastRecipient, Cohort, Campaign, Consumer,
} from '../models/index.js';
import { AppError } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';
import { sendEmail, getTransporter } from './mailer.js';
import { ensureUnsubToken, findConsumerByUnsubToken } from './consentService.js';
import { canMarketToBatch, listCohortMembers, normalizeDefinition } from './cohortService.js';
import { emailNormKey } from './repeatSignup.js';
import { customerHostOrigin, normalizeCustomerHostChoice } from '../utils/customerHost.js';
import { renderBroadcastEmail } from './emailBroadcastTemplate.js';

/**
 * Email broadcast push (tracker "emailpush",
 * docs/plans/email-broadcast-push.md). Discharges the §5 sender obligations
 * of docs/plans/cohort-builder-backend.md for the email channel:
 *
 *   - EVERY recipient is re-gated at send time, per person, against the
 *     campaign the email is ACTUALLY about (canMarketToBatch — parity-proven
 *     === consentService.canMarketTo). Cohort membership never substitutes.
 *   - Marketing mail without a WORKING unsubscribe link is never sent: the
 *     minted PR-B token is verified via findConsumerByUnsubToken before the
 *     transport attempt.
 *   - At-most-once per recipient: the unique (broadcastId, consumerId) row is
 *     the claim, and the pending→attempting CAS lands durably BEFORE SMTP. A
 *     crash in the gap surfaces as `ambiguous_crash`, never a resend — for
 *     marketing, a missed mail is recoverable and a double send is not.
 *   - One broadcast in flight globally (draft→preparing CAS carries a
 *     NOT EXISTS over active statuses), which also makes the throttle a real
 *     global cap on the single-instance deployment.
 *
 * DNC note: Singapore's DNC registry covers voice/SMS/fax — not email — so
 * the §9.5-2 send-time DNC scrub obligation binds the future voice/SMS/
 * WhatsApp senders ("wapush"), not this one. The consent gate above is the
 * email-channel requirement and it is enforced per send.
 */

export const STALE_WORKER_MS = 120_000;

const RATE_DEFAULT = 2;
const MAX_RECIPIENTS_DEFAULT = 5000;

function ratePerSec() {
  const raw = Number.parseFloat(process.env.EMAIL_BROADCAST_RATE_PER_SEC || '');
  const rate = Number.isFinite(raw) ? raw : RATE_DEFAULT;
  return Math.min(10, Math.max(0.2, rate));
}

function maxRecipients() {
  const raw = Number.parseInt(process.env.EMAIL_BROADCAST_MAX_RECIPIENTS || '', 10);
  const cap = Number.isFinite(raw) ? raw : MAX_RECIPIENTS_DEFAULT;
  return Math.min(20_000, Math.max(1, cap));
}

function apiPublicOrigin() {
  return process.env.API_PUBLIC_ORIGIN || 'https://api.mktr.sg';
}

/** Brand strings for the template, from the clamped host choice. */
function brandForHost(hostChoice) {
  return hostChoice === 'mktr'
    ? { brandName: 'MKTR', emailContext: 'mktr' }
    : { brandName: 'redeem.sg', emailContext: 'redeem' };
}

function buildCtaUrl({ origin, campaignId, broadcastId }) {
  const qs = new URLSearchParams({
    campaign_id: campaignId,
    utm_source: 'mktr',
    utm_medium: 'email',
    utm_campaign: `broadcast-${String(broadcastId).slice(0, 8)}`,
  });
  return `${origin}/LeadCapture?${qs.toString()}`;
}

const defaultDeps = {
  sequelize,
  EmailBroadcast,
  EmailBroadcastRecipient,
  Cohort,
  Campaign,
  Consumer,
  sendEmail,
  getTransporter,
  ensureUnsubToken,
  findConsumerByUnsubToken,
  canMarketToBatch,
  listCohortMembers,
  normalizeDefinition,
  logger,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export function makeEmailBroadcastService(overrides = {}) {
  const d = { ...defaultDeps, ...overrides };

  // Local short-circuit only — the FENCE is the DB CAS. Two processes racing
  // still serialize on conditional UPDATEs; this set just stops one process
  // from spawning two loops for the same broadcast.
  const activeSends = new Set();

  async function transition(id, from, to, extra = {}) {
    const [count] = await d.EmailBroadcast.update(
      { status: to, ...extra },
      { where: { id, status: from } }
    );
    return count === 1;
  }

  /** Live per-status row counts (the UI's real-time truth while sending). */
  async function liveCounts(broadcastId) {
    const rows = await d.sequelize.query(
      'SELECT status, COUNT(*)::int AS n FROM email_broadcast_recipients WHERE "broadcastId" = :broadcastId GROUP BY status',
      { type: QueryTypes.SELECT, replacements: { broadcastId } }
    );
    const counts = { pending: 0, attempting: 0, sent: 0, skipped: 0, failed: 0 };
    for (const r of rows) counts[r.status] = r.n;
    return counts;
  }

  /**
   * draft → preparing → sending, then the worker runs post-return.
   * Resume: interrupted (or stale `sending`) → sending over remaining
   * `pending` rows only — never re-resolves the audience (§3.3). Returns
   * { broadcast, workerPromise }; callers fire-and-forget, tests await.
   */
  async function startBroadcastSend(broadcastId, { resume = false } = {}) {
    if (activeSends.has(broadcastId)) {
      throw new AppError('This broadcast is already sending in this process', 409);
    }
    const broadcast = await d.EmailBroadcast.findByPk(broadcastId);
    if (!broadcast) throw new AppError('Broadcast not found', 404);

    if (!resume) {
      // Atomic: win draft→preparing AND assert no other broadcast in flight.
      const [rows] = await d.sequelize.query(
        `UPDATE email_broadcasts
            SET status = 'preparing', "startedAt" = now(), "workerHeartbeatAt" = now(), "lastError" = NULL, "updatedAt" = now()
          WHERE id = :id AND status = 'draft'
            AND NOT EXISTS (
              SELECT 1 FROM email_broadcasts b2
               WHERE b2.status IN ('preparing','sending','cancelling') AND b2.id <> :id
            )
          RETURNING id`,
        { replacements: { id: broadcastId } }
      );
      if (rows.length === 0) {
        const inFlight = await d.EmailBroadcast.count({ where: { status: ['preparing', 'sending', 'cancelling'] } });
        if (broadcast.status !== 'draft') throw new AppError(`Broadcast is ${broadcast.status}, not draft`, 409);
        if (inFlight > 0) throw new AppError('Another broadcast is in flight — one at a time', 409);
        throw new AppError('Broadcast could not start', 409);
      }
      try {
        await prepare(broadcast);
      } catch (err) {
        // All-or-back-to-draft: nothing was sent; surface the reason on the row.
        const [reverted] = await d.EmailBroadcast.update(
          { status: 'draft', lastError: err.message || 'prepare failed' },
          { where: { id: broadcastId, status: 'preparing' } }
        );
        if (reverted === 0) await landCancelledIfCancelling(broadcastId);
        throw err;
      }
      const won = await transition(broadcastId, 'preparing', 'sending', { workerHeartbeatAt: new Date() });
      if (!won) {
        // Cancel raced us mid-prepare — land the terminal state ourselves
        // (there is no worker yet to notice `cancelling`).
        await landCancelledIfCancelling(broadcastId);
        throw new AppError('Broadcast was cancelled during preparation', 409);
      }
    } else {
      const fresh = await d.EmailBroadcast.findByPk(broadcastId);
      if (!fresh.definitionSnapshot || !fresh.campaignId) {
        throw new AppError('Broadcast has no frozen send context to resume from — cancel it and create a new push', 422);
      }
      // interrupted → sending, or self-heal a `sending` row whose worker died
      // (stale heartbeat) without waiting for a boot sweep. Same one-in-flight
      // fence as the draft path.
      const [rows] = await d.sequelize.query(
        `UPDATE email_broadcasts
            SET status = 'sending', "workerHeartbeatAt" = now(), "updatedAt" = now()
          WHERE id = :id
            AND (status = 'interrupted'
                 OR (status = 'sending' AND ("workerHeartbeatAt" IS NULL OR "workerHeartbeatAt" < now() - interval '120 seconds')))
            AND NOT EXISTS (
              SELECT 1 FROM email_broadcasts b2
               WHERE b2.status IN ('preparing','sending','cancelling') AND b2.id <> :id
            )
          RETURNING id`,
        { replacements: { id: broadcastId } }
      );
      if (rows.length === 0) throw new AppError('Broadcast is not resumable (not interrupted/stale, or another broadcast is in flight)', 409);
      // Crash-ambiguous rows are terminal: the mail may or may not have gone
      // out, so they are NEVER retried (at-most-once).
      await d.EmailBroadcastRecipient.update(
        { status: 'failed', reason: 'ambiguous_crash' },
        { where: { broadcastId, status: 'attempting' } }
      );
    }

    activeSends.add(broadcastId);
    const workerPromise = runWorker(broadcastId)
      .catch(async (err) => {
        d.logger.error('email broadcast worker crashed', { broadcastId, error: err.message });
        await d.EmailBroadcast.update(
          { status: 'failed', lastError: err.message || 'worker crashed', completedAt: new Date() },
          { where: { id: broadcastId, status: ['sending', 'cancelling'] } }
        ).catch(() => {});
      })
      .finally(() => activeSends.delete(broadcastId));

    const started = await d.EmailBroadcast.findByPk(broadcastId);
    return { broadcast: started, workerPromise };
  }

  /** Preflight + freeze the send context + materialize claims (§3.2). */
  async function prepare(broadcast) {
    if (!d.getTransporter()) {
      throw new AppError('Email transport is not configured — set EMAIL_HOST/EMAIL_USER/EMAIL_PASSWORD', 422);
    }
    const campaign = broadcast.campaignId ? await d.Campaign.findByPk(broadcast.campaignId) : null;
    if (!campaign) throw new AppError('Broadcast campaign no longer exists', 422);
    // The public surface's own gate: recipients land on this campaign's page.
    if (campaign.status !== 'active' || campaign.is_active !== true) {
      throw new AppError('Campaign must be active (status + is_active) before pushing people to it', 422);
    }
    const cohort = await d.Cohort.findByPk(broadcast.cohortId);
    if (!cohort || cohort.archivedAt) throw new AppError('Broadcast cohort no longer exists', 422);

    const hostChoice = normalizeCustomerHostChoice(campaign.design_config?.customerHost);
    const origin = customerHostOrigin(hostChoice);
    if (process.env.NODE_ENV === 'production' && !/^https:\/\//.test(origin)) {
      // A missing PUBLIC_BASE_URL must never leak a localhost CTA into real mail.
      throw new AppError('Customer origin is not https — check PUBLIC_BASE_URL/MKTR_FRONTEND_URL', 422);
    }

    // §5 scope rule: the SEND is gated on the campaign the email is actually
    // about — override the cohort's advisory gate scope in the FROZEN snapshot.
    const definition = d.normalizeDefinition(cohort.definition);
    definition.marketingContext = { ...definition.marketingContext, campaignId: broadcast.campaignId };

    const cap = maxRecipients();
    const members = new Map(); // consumerId → member (page-shift dedupe)
    let offset = 0;
    for (;;) {
      const page = await d.listCohortMembers(definition, {
        channel: 'email', status: 'reachable', limit: 200, offset,
      });
      for (const m of page.members) members.set(m.consumerId, m);
      if (members.size > cap) {
        throw new AppError(`Audience exceeds EMAIL_BROADCAST_MAX_RECIPIENTS (${cap})`, 422);
      }
      if (page.members.length < 200) break;
      offset += 200;
    }
    if (members.size === 0) {
      throw new AppError('Cohort has no reachable email recipients for this campaign scope', 422);
    }

    const { emailContext } = brandForHost(hostChoice);
    const ctaUrl = buildCtaUrl({ origin, campaignId: broadcast.campaignId, broadcastId: broadcast.id });

    await d.sequelize.transaction(async (t) => {
      await d.EmailBroadcastRecipient.bulkCreate(
        [...members.values()].map((m) => ({
          broadcastId: broadcast.id,
          consumerId: m.consumerId,
          email: m.email || null,
          status: 'pending',
        })),
        { ignoreDuplicates: true, transaction: t }
      );
      const total = await d.EmailBroadcastRecipient.count({ where: { broadcastId: broadcast.id }, transaction: t });
      await d.EmailBroadcast.update(
        { definitionSnapshot: definition, hostChoice, emailContext, ctaUrl, totalRecipients: total },
        { where: { id: broadcast.id }, transaction: t }
      );
    });
  }

  /** The throttled per-recipient loop (§3.3). Reads ONLY the frozen row. */
  async function runWorker(broadcastId) {
    const broadcast = await d.EmailBroadcast.findByPk(broadcastId);
    if (!broadcast || broadcast.status !== 'sending') return;

    const { brandName } = brandForHost(broadcast.hostChoice);
    const brandOrigin = (broadcast.ctaUrl || '').replace(/^https?:\/\//, '').split('/')[0] || null;
    const intervalMs = Math.round(1000 / ratePerSec());

    // One copy per normalized address per broadcast — on resume, rebuild the
    // attempted set from every row that reached (or ambiguously reached)
    // transport. Conservative on purpose: an address on a failed row gets no
    // second copy through a duplicate consumer id either.
    const attempted = new Set();
    const prior = await d.EmailBroadcastRecipient.findAll({
      where: { broadcastId, status: ['sent', 'failed'] }, attributes: ['email'],
    });
    for (const row of prior) {
      const key = emailNormKey(row.email);
      if (key) attempted.add(key);
    }

    for (;;) {
      // Heartbeat + cancellation in one conditional write: losing it means an
      // admin cancelled or a sweep/other process took ownership — stop here.
      const [hb] = await d.sequelize.query(
        `UPDATE email_broadcasts SET "workerHeartbeatAt" = now(), "updatedAt" = now()
          WHERE id = :id AND status = 'sending' RETURNING id`,
        { replacements: { id: broadcastId } }
      );
      if (hb.length === 0) {
        const current = await d.EmailBroadcast.findByPk(broadcastId);
        if (current?.status === 'cancelling') await finalize(broadcastId, 'cancelled');
        return;
      }

      const row = await d.EmailBroadcastRecipient.findOne({
        where: { broadcastId, status: 'pending' },
        order: [['createdAt', 'ASC'], ['id', 'ASC']],
      });
      if (!row) {
        await finalize(broadcastId, 'completed');
        return;
      }

      // The at-most-once fence: attempting lands durably before any transport.
      const [claimed] = await d.EmailBroadcastRecipient.update(
        { status: 'attempting' },
        { where: { id: row.id, status: 'pending' } }
      );
      if (claimed === 0) continue; // another worker took it

      try {
        await processRecipient(broadcast, row, { attempted, brandName, brandOrigin });
      } catch (err) {
        await row.update({ status: 'failed', reason: 'send_error', error: err.message || 'send failed' });
        d.logger.warn('broadcast recipient failed', { broadcastId, recipientId: row.id, error: err.message });
      }

      await d.sleep(intervalMs);
    }
  }

  async function processRecipient(broadcast, row, { attempted, brandName, brandOrigin }) {
    const skip = (reason) => row.update({ status: 'skipped', reason });

    // Destination refresh: the claim-time address is a hint, the CURRENT
    // consumer row is the truth (erasure nulls it; newer signups replace it).
    const consumer = await d.Consumer.findByPk(row.consumerId);
    if (!consumer) return skip('not_found');
    const normKey = emailNormKey(consumer.email);
    if (!normKey) return skip('missing_email');
    if (attempted.has(normKey)) return skip('duplicate_email');

    // Address-level suppression: consumers are phone-keyed, so a person who
    // unsubscribed THIS address through another consumer id must still win.
    const shared = await d.sequelize.query(
      `SELECT 1 FROM consumer_suppressions cs
         JOIN consumers c2 ON c2.id = cs."consumerId"
        WHERE c2.id <> :consumerId AND cs.channel IN ('all','email')
          AND lower(trim(c2.email)) = :normKey
        LIMIT 1`,
      { type: QueryTypes.SELECT, replacements: { consumerId: row.consumerId, normKey } }
    );
    if (shared.length > 0) return skip('address_suppressed');

    // THE send-time consent gate (§5): per person, scoped to the campaign the
    // email is actually about. Absent from the Map ⇒ fail closed.
    const gate = await d.canMarketToBatch([row.consumerId], {
      channel: 'email',
      campaignId: broadcast.campaignId,
    });
    const verdict = gate.get(row.consumerId);
    if (!verdict) return skip('not_found');
    if (!verdict.ok) return skip(verdict.reasons?.[0] || 'not_consented');

    // Mint AND VERIFY the unsubscribe token — a dead link (e.g. after a secret
    // rotation) means the mail is not sent at all.
    let token;
    try {
      token = await d.ensureUnsubToken(row.consumerId);
      const owner = await d.findConsumerByUnsubToken(token);
      if (!owner || owner.id !== row.consumerId) return skip('unsub_token_error');
    } catch {
      return skip('unsub_token_error');
    }
    const unsubscribeUrl = `${apiPublicOrigin()}/api/unsubscribe?t=${token}`;

    const { html, text } = renderBroadcastEmail({
      subject: broadcast.subject,
      bodyText: broadcast.bodyText,
      ctaLabel: broadcast.ctaLabel,
      ctaUrl: broadcast.ctaUrl,
      brandName,
      brandOrigin,
      unsubscribeUrl,
      recipientFirstName: consumer.firstName,
    });

    const to = String(consumer.email).trim();
    attempted.add(normKey);
    const result = await d.sendEmail({
      to,
      subject: broadcast.subject,
      html,
      text,
      context: broadcast.emailContext,
      // Byte-for-byte the PR-B header pair (mailer.js confirmation-email rail).
      headers: {
        'List-Unsubscribe': `<${unsubscribeUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    });
    if (result?.success === true) {
      await row.update({ status: 'sent', email: to, sentAt: new Date(), reason: null });
    } else {
      // Transporter vanished mid-run — no transport attempt was made. The
      // address stays in `attempted` anyway (under-send over double-send).
      await row.update({ status: 'failed', reason: 'send_error', error: result?.message || 'mailer not configured' });
    }
  }

  /** A cancel that raced the prepare phase has no worker to land it — do it here. */
  async function landCancelledIfCancelling(broadcastId) {
    if (await transition(broadcastId, 'cancelling', 'cancelled', { completedAt: new Date() })) {
      await d.EmailBroadcastRecipient.update(
        { status: 'skipped', reason: 'cancelled' },
        { where: { broadcastId, status: ['pending', 'attempting'] } }
      );
    }
  }

  /** Recount from rows (authoritative) and land the terminal state. */
  async function finalize(broadcastId, finalStatus) {
    if (finalStatus === 'cancelled') {
      await d.EmailBroadcastRecipient.update(
        { status: 'skipped', reason: 'cancelled' },
        { where: { broadcastId, status: 'pending' } }
      );
    }
    const counts = await liveCounts(broadcastId);
    await d.EmailBroadcast.update(
      {
        status: finalStatus,
        sentCount: counts.sent,
        skippedCount: counts.skipped,
        failedCount: counts.failed,
        completedAt: new Date(),
      },
      { where: { id: broadcastId, status: ['sending', 'cancelling'] } }
    );
  }

  /**
   * Emergency stop. preparing/sending → cancelling (the worker lands the
   * final state within one iteration); a dead broadcast (interrupted/failed)
   * → cancelled directly, remaining pending rows marked.
   */
  async function cancelBroadcast(broadcastId) {
    const broadcast = await d.EmailBroadcast.findByPk(broadcastId);
    if (!broadcast) throw new AppError('Broadcast not found', 404);
    if (await transition(broadcastId, ['preparing', 'sending'], 'cancelling')) {
      return d.EmailBroadcast.findByPk(broadcastId);
    }
    if (await transition(broadcastId, ['interrupted', 'failed'], 'cancelled', { completedAt: new Date() })) {
      await d.EmailBroadcastRecipient.update(
        { status: 'skipped', reason: 'cancelled' },
        { where: { broadcastId, status: ['pending', 'attempting'] } }
      );
      const counts = await liveCounts(broadcastId);
      await d.EmailBroadcast.update(
        { sentCount: counts.sent, skippedCount: counts.skipped, failedCount: counts.failed },
        { where: { id: broadcastId } }
      );
      return d.EmailBroadcast.findByPk(broadcastId);
    }
    throw new AppError(`Broadcast is ${broadcast.status} — nothing to cancel`, 409);
  }

  /**
   * Boot sweep (bootstrap.js): any in-flight broadcast whose worker heartbeat
   * is stale belongs to a dead process → `interrupted`, its crash-ambiguous
   * rows marked terminal. NO auto-resume — a human presses Resume; nothing
   * mass-sends just because a deploy restarted the box.
   */
  async function sweepStaleBroadcasts() {
    const [rows] = await d.sequelize.query(
      `UPDATE email_broadcasts
          SET status = 'interrupted', "updatedAt" = now(),
              "lastError" = COALESCE("lastError", 'worker lost (deploy/crash) — resume to continue')
        WHERE status IN ('preparing','sending','cancelling')
          AND ("workerHeartbeatAt" IS NULL OR "workerHeartbeatAt" < now() - interval '120 seconds')
        RETURNING id`
    );
    for (const r of rows) {
      await d.EmailBroadcastRecipient.update(
        { status: 'failed', reason: 'ambiguous_crash' },
        { where: { broadcastId: r.id, status: 'attempting' } }
      );
    }
    if (rows.length > 0) {
      d.logger.warn('swept stale email broadcasts to interrupted', { count: rows.length, ids: rows.map((r) => r.id) });
    }
    return rows.length;
  }

  /**
   * Test send: renders the real thing to the REQUESTING admin only (no
   * address parameter — an authenticated relay would be an abuse hole),
   * marked, inert unsubscribe, logged, never in the recipient log.
   */
  async function sendTestEmail(broadcastId, user) {
    const broadcast = await d.EmailBroadcast.findByPk(broadcastId);
    if (!broadcast) throw new AppError('Broadcast not found', 404);
    const to = String(user?.email || '').trim();
    if (!to) throw new AppError('Your admin account has no email address to test to', 422);

    const campaign = broadcast.campaignId ? await d.Campaign.findByPk(broadcast.campaignId) : null;
    const hostChoice = broadcast.hostChoice
      || normalizeCustomerHostChoice(campaign?.design_config?.customerHost);
    const { brandName, emailContext } = brandForHost(hostChoice);
    const ctaUrl = broadcast.ctaUrl || (campaign
      ? buildCtaUrl({ origin: customerHostOrigin(hostChoice), campaignId: campaign.id, broadcastId: broadcast.id })
      : null);

    const { html, text } = renderBroadcastEmail({
      subject: broadcast.subject,
      bodyText: broadcast.bodyText,
      ctaLabel: broadcast.ctaLabel,
      ctaUrl,
      brandName,
      brandOrigin: ctaUrl ? ctaUrl.replace(/^https?:\/\//, '').split('/')[0] : null,
      unsubscribeUrl: null,
      recipientFirstName: user?.firstName,
      testNotice: true,
    });
    const result = await d.sendEmail({
      to, subject: `[TEST] ${broadcast.subject}`, html, text, context: emailContext,
    });
    if (result?.success !== true) {
      throw new AppError(result?.message || 'Email transport is not configured', 422);
    }
    d.logger.info('broadcast test send', { broadcastId, actor: user?.id });
    return { to };
  }

  return {
    startBroadcastSend,
    cancelBroadcast,
    sweepStaleBroadcasts,
    sendTestEmail,
    liveCounts,
    buildCtaUrl,
    _activeSends: activeSends,
  };
}

const _default = makeEmailBroadcastService();
export const startBroadcastSend = _default.startBroadcastSend;
export const cancelBroadcast = _default.cancelBroadcast;
export const sweepStaleBroadcasts = _default.sweepStaleBroadcasts;
export const sendTestEmail = _default.sendTestEmail;
export const liveBroadcastCounts = _default.liveCounts;
export { buildCtaUrl };
