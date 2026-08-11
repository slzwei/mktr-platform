import { Op } from 'sequelize';
import {
  OutreachEmail, OutreachAccount, OutreachPersona, OutreachTask,
  OutreachCadence, OutreachCadenceEnrollment, PartnerOrganisation, sequelize,
} from '../../models/index.js';
import { AppError } from '../../middleware/appError.js';
import { logger } from '../../utils/logger.js';
import { makeSecretBox } from '../../utils/secretBox.js';
import { makeRedeemOpsAuditService } from './auditService.js';
import { makeCadenceService } from './cadenceService.js';
import { makePartnerService } from './partnerService.js';
import { canActOnPartnerRow } from './permissions.js';
import { makeWorkspaceClient, parseServiceAccountKey, WORKSPACE_SCOPES } from '../google/workspaceService.js';

/**
 * The auto-send worker — Phase B (docs/plans/redeem-ops-cadence-email-autosend.md §4).
 *
 * Non-negotiables, each from a verified review finding:
 * - NEVER sends while the reply loop is dark: every tick requires the
 *   account's `lastSuccessfulPollAt` to be fresh (P1 — Phase B alone is
 *   inert; Phase C lights the poller). No env override exists on purpose.
 * - Everything is RELOADED and revalidated per attempt; the body/subject
 *   that send are read FROM THE TASK after the atomic claim (C3/M3).
 * - A completion race after a real 2xx send falls back to an honest
 *   orphaned-send record — a sent email never vanishes (C1).
 * - Caps are enforced with atomic conditional increments (m5); a cap hit
 *   reschedules, never drops.
 */

const outreachBox = makeSecretBox('OUTREACH_MAILBOX_ENCRYPTION_KEY', 'outreach mailbox');
const SCOPES = [
  WORKSPACE_SCOPES.gmailSend, WORKSPACE_SCOPES.gmailReadonly,
  WORKSPACE_SCOPES.gmailSettingsBasic, WORKSPACE_SCOPES.directoryReadonly,
];

const MAX_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = [2 * 60_000, 10 * 60_000, 30 * 60_000];
const STALE_SENDING_MS = 10 * 60_000;
const POLL_FRESHNESS_MS = 10 * 60_000;
const CLAIM_BATCH = 5;
const FOOTER = 'MKTR PTE. LTD. · reply "unsubscribe" to opt out';
const SGT_OFFSET_MS = 8 * 3600_000;

function sgtDateStr(at) {
  return new Date(at.getTime() + SGT_OFFSET_MS).toISOString().slice(0, 10);
}
function sgtHour(at) {
  return new Date(at.getTime() + SGT_OFFSET_MS).getUTCHours();
}
/** Next 09:00 SGT strictly after `at`. */
function nextSgtMorning(at) {
  const sgt = new Date(at.getTime() + SGT_OFFSET_MS);
  const base = Date.UTC(sgt.getUTCFullYear(), sgt.getUTCMonth(), sgt.getUTCDate(), 9, 0, 0);
  const candidate = base - SGT_OFFSET_MS;
  return new Date(candidate > at.getTime() ? candidate : candidate + 24 * 3600_000);
}

export function makeOutreachSenderService(overrides = {}) {
  const d = {
    OutreachEmail, OutreachAccount, OutreachPersona, OutreachTask,
    OutreachCadence, OutreachCadenceEnrollment, PartnerOrganisation, sequelize, logger,
    audit: makeRedeemOpsAuditService(),
    cadences: makeCadenceService(),
    partners: makePartnerService(),
    secretBox: outreachBox,
    makeClient: makeWorkspaceClient,
    now: () => new Date(),
    ...overrides,
  };

  async function clientFor(account) {
    const withCreds = await d.OutreachAccount.scope('withCredentials').findByPk(account.id);
    if (!withCreds?.encryptedCredentials) throw new AppError('Workspace account has no credentials', 409);
    const credentials = parseServiceAccountKey(d.secretBox.decrypt(withCreds.encryptedCredentials));
    return d.makeClient({ credentials, subject: account.accountEmail, scopes: SCOPES });
  }

  async function cancelRow(row, reason) {
    await row.update({ status: 'cancelled', lastError: reason });
    d.logger.info({ outboxId: row.id, reason }, '[autosend] cancelled to manual');
  }

  /** Atomic cap increment (SGT rollover + bound in ONE statement). True = allowed. */
  async function tryIncrementCap(table, id, at) {
    const today = sgtDateStr(at);
    const [rows] = await d.sequelize.query(
      `UPDATE ${table}
          SET "sentToday" = CASE WHEN "sentTodayDate" = :today THEN "sentToday" + 1 ELSE 1 END,
              "sentTodayDate" = :today
        WHERE id = :id
          AND ("sentTodayDate" IS DISTINCT FROM :today OR "sentToday" < "dailySendCap")
        RETURNING id`,
      { replacements: { id, today } }
    );
    return rows.length > 0;
  }

  /**
   * The plan-P1 gate: sends are refused while the reply loop is dark or
   * stale. Phase C stamps lastSuccessfulPollAt on every clean poll.
   */
  function replyLoopHealthy(account, at) {
    return Boolean(
      account.lastSuccessfulPollAt
      && at.getTime() - new Date(account.lastSuccessfulPollAt).getTime() < POLL_FRESHNESS_MS
    );
  }

  async function claimDue(limit = CLAIM_BATCH) {
    const [rows] = await d.sequelize.query(
      `UPDATE outreach_emails SET status = 'sending', attempts = attempts + 1, "updatedAt" = NOW()
        WHERE id IN (
          SELECT id FROM outreach_emails
           WHERE status = 'queued' AND "nextAttemptAt" <= NOW()
           ORDER BY "nextAttemptAt" ASC
           LIMIT :limit
           FOR UPDATE SKIP LOCKED)
        RETURNING id`,
      { replacements: { limit } }
    );
    if (rows.length === 0) return [];
    return d.OutreachEmail.findAll({ where: { id: rows.map((r) => r.id) } });
  }

  /**
   * Send-time revalidation (§4) — reload EVERYTHING; any mismatch cancels to
   * manual (the task survives, loudly badged via the joined row).
   */
  async function revalidate(row, at) {
    const task = await d.OutreachTask.findByPk(row.taskId);
    if (!task || !['open', 'in_progress'].includes(task.status)) return { fail: 'task_not_open' };
    const enrollment = await d.OutreachCadenceEnrollment.findByPk(row.cadenceEnrollmentId);
    if (!enrollment || enrollment.state !== 'active') return { fail: 'enrollment_not_active' };
    if (enrollment.currentStepId !== task.cadenceStepId) return { fail: 'not_current_step' };
    const partner = await d.PartnerOrganisation.findByPk(row.partnerOrganisationId);
    if (!partner || partner.mergedIntoId || partner.archivedAt) return { fail: 'partner_gone' };
    if (partner.autoEmailOptOut) return { fail: 'partner_opted_out' };
    if (!partner.ownerUserId) return { fail: 'partner_unowned' };

    // Recipient RE-RESOLVED (P5): a fixed typo or a removed address must
    // change the outcome, never silently mail the old destination.
    const resolved = await d.sequelize.transaction((t) => d.cadences.resolveRecipientTx(partner, 'email', t));
    if (!resolved.ok) return { fail: 'no_email' };
    if (resolved.recipient.toLowerCase() !== String(row.toAddress).toLowerCase()) return { fail: 'recipient_changed' };

    const persona = row.personaId ? await d.OutreachPersona.findByPk(row.personaId) : null;
    if (!persona || !persona.isActive || !persona.sendAsVerified) return { fail: 'persona_unavailable' };
    if (persona.assignedUserId !== task.assigneeUserId) return { fail: 'persona_reassigned' };
    const account = await d.OutreachAccount.findByPk(persona.accountId);
    if (!account || !account.isActive) return { fail: 'account_unavailable' };

    const suppressed = await d.sequelize.transaction((t) => d.cadences.isSuppressedTx('email', row.toAddress, t));
    if (suppressed) return { fail: 'suppressed' };

    // Send-window sanity: outside 07:00–21:00 SGT reschedule, don't cancel —
    // unless the rep explicitly hit Send now (plan P15: deliberate override).
    const hour = sgtHour(at);
    if ((hour < 7 || hour >= 21) && !row.windowOverride) return { reschedule: nextSgtMorning(at) };

    // The reply-loop gate re-checked against THIS ROW's own account (M-1):
    // the day a second account row exists (plan F2, Tyler), its rows must not
    // ride the first account's poll freshness.
    if (!replyLoopHealthy(account, at)) return { reschedule: new Date(at.getTime() + 5 * 60_000) };

    return { task, enrollment, partner, persona, account };
  }

  // Every header value is CR/LF-stripped — service-level partner writers
  // (CSV import, Discovery) bypass the API's Joi email format, so header
  // hygiene cannot be delegated upstream (m-9).
  const headerSafe = (v) => String(v).replace(/[\r\n]+/g, ' ');

  function buildRfc822({ persona, row, task, enrollment, references }) {
    const threaded = Boolean(enrollment.gmailThreadId);
    const baseSubject = threaded
      ? (enrollment.gmailThreadSubject || task.emailSubject || task.title)
      : (task.emailSubject || task.title);
    const subject = headerSafe(threaded && !/^re:/i.test(baseSubject) ? `Re: ${baseSubject}` : baseSubject)
      .slice(0, 220);
    const body = `${task.description || ''}\n\n--\n${FOOTER}\n`;
    const headers = [
      `From: "${headerSafe(persona.displayName).replace(/"/g, '')}" <${headerSafe(persona.address)}>`,
      `To: <${headerSafe(row.toAddress)}>`,
      `Subject: ${subject}`,
      'Content-Type: text/plain; charset=utf-8',
    ];
    if (threaded && references) {
      headers.push(`In-Reply-To: ${headerSafe(references)}`);
      headers.push(`References: ${headerSafe(references)}`);
    }
    return { rfc822: `${headers.join('\r\n')}\r\n\r\n${body}`, subject, body };
  }

  async function processRow(row) {
    const at = d.now();
    const checked = await revalidate(row, at);
    if (checked.fail === 'no_email') {
      // The address vanished since enqueue — cancel AND park the enrollment
      // (plan P5): the contact-info hook then rescues it like any other park,
      // instead of an active enrollment pointing at a dead address forever.
      await cancelRow(row, 'no_email');
      await d.cadences.parkActiveEnrollment(row.cadenceEnrollmentId, 'no_email').catch((err) => {
        d.logger.warn({ outboxId: row.id, err: err?.message }, '[autosend] no_email park failed (task stays manual)');
      });
      return {};
    }
    if (checked.fail) return cancelRow(row, checked.fail);
    if (checked.reschedule) {
      return row.update({ status: 'queued', nextAttemptAt: checked.reschedule, attempts: row.attempts - 1 });
    }
    const { task, enrollment, partner, persona, account } = checked;

    const client = await clientFor(account);

    // Threaded sends abort if the prospect already spoke and the poll hasn't
    // caught up (P8): any thread message NOT labelled SENT is inbound. A
    // failed thread fetch RESCHEDULES — the guard must fail closed (m-4).
    let references = null;
    if (enrollment.gmailThreadId) {
      let thread;
      try {
        thread = await client.getThread(enrollment.gmailThreadId);
      } catch {
        return row.update({
          status: 'queued', nextAttemptAt: new Date(at.getTime() + 5 * 60_000),
          attempts: row.attempts - 1, lastError: 'thread_check_unavailable',
        });
      }
      const foreign = thread?.messages?.some((m) => !(m.labelIds || []).includes('SENT'));
      if (foreign) return cancelRow(row, 'reply_in_thread');
      const lastSent = await d.OutreachEmail.findOne({
        where: { cadenceEnrollmentId: enrollment.id, status: 'sent', wireMessageId: { [Op.ne]: null } },
        order: [['sentAt', 'DESC']],
      });
      references = lastSent?.wireMessageId || null;
    }

    // Caps LAST, atomically — nothing after this point may back out silently.
    if (!(await tryIncrementCap('outreach_personas', persona.id, at))) {
      return row.update({ status: 'queued', nextAttemptAt: nextSgtMorning(at), attempts: row.attempts - 1, lastError: 'persona_cap' });
    }
    if (!(await tryIncrementCap('outreach_accounts', account.id, at))) {
      await d.sequelize.query(
        'UPDATE outreach_personas SET "sentToday" = GREATEST("sentToday" - 1, 0) WHERE id = :id',
        { replacements: { id: persona.id } }
      );
      return row.update({ status: 'queued', nextAttemptAt: nextSgtMorning(at), attempts: row.attempts - 1, lastError: 'account_cap' });
    }

    const { rfc822, subject, body } = buildRfc822({ persona, row, task, enrollment, references });
    let sent;
    try {
      sent = await client.sendRaw(rfc822, { threadId: enrollment.gmailThreadId || null });
    } catch (err) {
      return handleSendFailure(row, persona, err);
    }

    // ── The email is REAL from here (C-1): NOTHING below may route the row
    // back to `queued` — a post-send hiccup must degrade to a stranded
    // `sending` row (the reclaim probe finds the wire message), never to a
    // retry that mails the prospect twice. ──────────────────────────────────
    await finalizeSentRow({ row, task, enrollment, partner, persona, client, sent, subject, body });
    return { sent: true };
  }

  /**
   * Everything after a 2xx wire send — each step individually contained.
   * Also the M-3 recovery path: reclaimStranded calls this when the crash
   * probe finds the message actually left, so the task completes (or records
   * an orphan) instead of staying open for a manual duplicate.
   */
  async function finalizeSentRow({ row, task, enrollment, partner, persona, client, sent, subject, body }) {
    let wireMessageId = null;
    try {
      const meta = await client.getMessageHeaders(sent.id, ['Message-ID']);
      wireMessageId = meta?.payload?.headers?.find((h) => h.name?.toLowerCase() === 'message-id')?.value || null;
    } catch { /* non-fatal — References falls back to skipping */ }

    try {
      await row.update({
        status: 'sent', sentAt: d.now(), gmailMessageId: sent.id, gmailThreadId: sent.threadId || null,
        wireMessageId, sentSubject: (subject || '').slice(0, 220), sentBody: body || null, lastError: null,
      });
    } catch (err) {
      // Leave the row `sending` — the stale reclaim + wire probe recover it.
      d.logger.error({ outboxId: row.id, err: err?.message }, '[autosend] post-send record write failed — leaving row for reclaim');
      return;
    }
    try {
      if (enrollment && !enrollment.gmailThreadId && sent.threadId) {
        await enrollment.update({ gmailThreadId: sent.threadId, gmailThreadSubject: (subject || '').slice(0, 220) });
      }
      if (persona?.id) {
        await d.OutreachPersona.update({ consecutiveFailures: 0 }, { where: { id: persona.id } });
      }
    } catch (err) {
      d.logger.warn({ outboxId: row.id, err: err?.message }, '[autosend] post-send bookkeeping failed (non-fatal)');
    }

    try {
      await d.cadences.completeCadenceTask(
        task.id,
        { disposition: 'sent', autoSentAs: persona.address },
        { id: task.assigneeUserId },
        `autosend:${row.id}`
      );
    } catch (err) {
      // C1: the world moved during the SMTP call (pause/stop/skip mid-send).
      // The send happened — record it honestly instead of losing it.
      d.logger.warn({ outboxId: row.id, err: err?.message }, '[autosend] completion raced — recording orphaned send');
      try {
        // Actor = the partner's CURRENT owner (m-7: an owner change mid-send
        // would fail the stale assignee's row rules and lose the timeline entry).
        const freshPartner = await d.PartnerOrganisation.findByPk(partner.id);
        await d.partners.logActivity(partner.id, {
          type: 'email_sent', direction: 'outbound',
          summary: `${task.title} — sent (auto-sent as ${persona.address}; recorded after a race)`,
          contactId: task.contactId || null,
        }, { id: freshPartner?.ownerUserId || task.assigneeUserId });
      } catch (logErr) {
        d.logger.error({ outboxId: row.id, err: logErr?.message }, '[autosend] orphaned-send activity failed');
      }
      try {
        await d.audit.recordAuditEvent({
          actorUser: null, actorType: 'system', action: 'cadence.email_sent_orphaned',
          entityType: 'outreach_email', entityId: row.id,
          after: { taskId: task.id, gmailId: sent.id, personaAddress: persona.address },
          requestId: `autosend:${row.id}`,
        });
      } catch (auditErr) {
        d.logger.error({ outboxId: row.id, err: auditErr?.message }, '[autosend] orphaned-send audit failed');
      }
    }
  }

  async function handleSendFailure(row, persona, err) {
    const status = err?.status || 0;
    const retryable = status === 429 || status >= 500 || status === 0;
    if (retryable && row.attempts < MAX_ATTEMPTS) {
      const backoff = RETRY_BACKOFF_MS[Math.min(row.attempts - 1, RETRY_BACKOFF_MS.length - 1)];
      return row.update({
        status: 'queued', nextAttemptAt: new Date(d.now().getTime() + backoff),
        lastError: String(err.message).slice(0, 500),
      });
    }
    await row.update({ status: 'failed', lastError: String(err.message).slice(0, 500) });
    // Persona failure streak → auto-disable (plan §7b) so one broken identity
    // can't burn the account's reputation quietly.
    const [rows] = await d.sequelize.query(
      `UPDATE outreach_personas
          SET "consecutiveFailures" = "consecutiveFailures" + 1,
              "isActive" = CASE WHEN "consecutiveFailures" + 1 >= 10 THEN false ELSE "isActive" END,
              "lastError" = :err
        WHERE id = :id RETURNING "isActive", "consecutiveFailures"`,
      { replacements: { id: persona.id, err: String(err.message).slice(0, 300) } }
    );
    if (rows[0] && rows[0].isActive === false) {
      d.logger.error({ personaId: persona.id }, '[autosend] persona auto-disabled after repeated failures');
    }
    return { failed: true };
  }

  /** Crash recovery: rows stranded in `sending` past the stale window. */
  async function reclaimStranded() {
    const stranded = await d.OutreachEmail.findAll({
      where: { status: 'sending', updatedAt: { [Op.lt]: new Date(d.now().getTime() - STALE_SENDING_MS) } },
      limit: 20,
    });
    for (const row of stranded) {
      // Dedupe WITHOUT trusting minted Message-IDs (F4): did anything leave
      // this mailbox for this recipient (narrowed by subject) since enqueue?
      let hits = [];
      let persona = null;
      let client = null;
      const task = await d.OutreachTask.findByPk(row.taskId);
      try {
        persona = row.personaId ? await d.OutreachPersona.findByPk(row.personaId) : null;
        const account = persona ? await d.OutreachAccount.findByPk(persona.accountId) : null;
        if (account) {
          client = await clientFor(account);
          const afterEpoch = Math.floor(new Date(row.createdAt).getTime() / 1000);
          const subjectWord = String(row.sentSubject || task?.emailSubject || '')
            .split(/\s+/).filter((w) => /^[\w-]{3,}$/.test(w)).slice(0, 3).join(' ');
          const q = `in:sent to:${row.toAddress} after:${afterEpoch}${subjectWord ? ` subject:(${subjectWord})` : ''}`;
          hits = await client.listMessages(q);
        }
      } catch (err) {
        d.logger.warn({ outboxId: row.id, err: err?.message }, '[autosend] stranded-row dedupe probe failed');
        continue; // leave for the next pass rather than risk a double-send
      }
      if (hits.length > 0 && client && task) {
        // The wire message exists — FINISH the job (M-3): flipping the row
        // alone leaves an open task beside a sent email, which a rep then
        // sends again by hand.
        const enrollment = await d.OutreachCadenceEnrollment.findByPk(row.cadenceEnrollmentId);
        const partner = await d.PartnerOrganisation.findByPk(row.partnerOrganisationId);
        await finalizeSentRow({
          row, task, enrollment, partner, persona, client,
          sent: { id: hits[0].id, threadId: hits[0].threadId || null },
          subject: row.sentSubject || task.emailSubject || task.title || '',
          body: row.sentBody || task.description || null,
        });
        await row.update({ lastError: 'recovered_after_crash' }).catch(() => {});
      } else if (row.attempts >= MAX_ATTEMPTS) {
        await row.update({ status: 'failed', lastError: 'crashed_mid_send' });
      } else {
        await row.update({ status: 'queued', nextAttemptAt: d.now(), lastError: null });
      }
    }
    return stranded.length;
  }

  /**
   * Flag-off reaper (P6): when auto-send is disabled, queued rows convert to
   * visible manual work instead of lying "scheduled" forever.
   */
  async function reapDisabled() {
    const [count] = await d.OutreachEmail.update(
      { status: 'cancelled', lastError: 'autosend_disabled' },
      { where: { status: { [Op.in]: ['queued', 'needs_approval'] } } }
    );
    if (count > 0) d.logger.info({ count }, '[autosend] flag off — queued sends converted to manual');
    return count;
  }

  /** One worker pass. Returns counts for logs/tests. */
  let ticking = false;
  async function tick() {
    if (ticking) return { skipped: 'tick_in_progress' };
    ticking = true;
    try {
      const at = d.now();
      // Reclaim runs even while the reply loop is dark — a crashed `sending`
      // row must not stay frozen (409-blocking edits) until the loop recovers.
      await reclaimStranded();
      const account = await d.OutreachAccount.findOne({ where: { isActive: true }, order: [['createdAt', 'ASC']] });
      if (!account) return { skipped: 'no_account' };
      if (!replyLoopHealthy(account, at)) {
        // P1 — never send reply-blind. Loud once per tick, not per row.
        // (Revalidate re-checks per row against ITS OWN account.)
        d.logger.warn({ lastPoll: account.lastSuccessfulPollAt }, '[autosend] reply loop dark/stale — refusing to send');
        return { skipped: 'reply_loop_dark' };
      }
      const claimed = await claimDue();
      let sent = 0;
      let notSent = 0;
      for (const row of claimed) {
        const outcome = await processRow(row).catch(async (err) => {
          d.logger.error({ outboxId: row.id, err: err?.message }, '[autosend] row processing crashed');
          await handleSendFailure(row, { id: row.personaId }, err);
          return {};
        });
        if (outcome?.sent) sent += 1; else notSent += 1;
      }
      if (claimed.length > 0) d.logger.info({ claimed: claimed.length, sent, notSent }, '[autosend] tick done');
      return { claimed: claimed.length, sent, notSent };
    } finally {
      ticking = false;
    }
  }

  // ── Rep-facing operations (routes) ────────────────────────────────────────

  async function rowForAction(emailId, user) {
    const row = await d.OutreachEmail.findByPk(emailId);
    if (!row) throw new AppError('Scheduled email not found', 404);
    const partner = await d.PartnerOrganisation.findByPk(row.partnerOrganisationId);
    if (!partner || !canActOnPartnerRow(user, partner)) {
      throw new AppError('You can only manage scheduled emails on businesses you own', 403);
    }
    return { row, partner };
  }

  /** Approve a held send (ramp/lint). Counts toward the version's ramp. */
  async function approve(emailId, user, requestId = null) {
    const { row } = await rowForAction(emailId, user);
    if (row.status !== 'needs_approval') throw new AppError('This email is not waiting for approval', 409);
    return d.sequelize.transaction(async (t) => {
      const fresh = await d.OutreachEmail.findByPk(emailId, { transaction: t, lock: t.LOCK.UPDATE });
      if (fresh.status !== 'needs_approval') throw new AppError('This email is not waiting for approval', 409);
      await fresh.update({ status: 'queued', approvedBy: user.id, approvedAt: d.now() }, { transaction: t });
      const enrollment = await d.OutreachCadenceEnrollment.findByPk(fresh.cadenceEnrollmentId, { transaction: t });
      if (enrollment) {
        await d.OutreachCadence.increment('autoSendApprovals', { where: { id: enrollment.cadenceId }, transaction: t });
      }
      await d.audit.recordAuditEvent({
        actorUser: user, action: 'outreach.email_approved', entityType: 'outreach_email',
        entityId: fresh.id, after: { holdReason: fresh.holdReason }, requestId, transaction: t,
      });
      return fresh;
    });
  }

  /** "Send now" — same outbox row, same claim path; window override is deliberate. */
  async function sendNow(emailId, user, requestId = null) {
    const { row } = await rowForAction(emailId, user);
    if (!['queued', 'needs_approval'].includes(row.status)) {
      throw new AppError('This email already left the queue', 409);
    }
    if (row.status === 'needs_approval') await approve(emailId, user, requestId);
    // windowOverride: rep-initiated Send now may cross the SGT window (P15) —
    // clicking at 21:30 means 21:30, not a silent 9am reschedule.
    await d.OutreachEmail.update(
      { nextAttemptAt: d.now(), windowOverride: true },
      { where: { id: emailId, status: 'queued' } }
    );
    await d.audit.recordAuditEvent({
      actorUser: user, action: 'outreach.email_send_now', entityType: 'outreach_email',
      entityId: emailId, requestId,
    });
    // Best-effort immediate pass — the 60s interval is the guarantee.
    tick().catch(() => {});
    return d.OutreachEmail.findByPk(emailId);
  }

  /** "Don't send" — the step stays a manual task; only the machine send dies. */
  async function convertToManual(emailId, user, requestId = null) {
    const { row } = await rowForAction(emailId, user);
    // CONDITIONAL cancel (C-2): a blind instance-update could acknowledge
    // "Won't send" while the worker's claim already committed — the exact
    // silent-action class this feature bans. 0 rows = the send left the
    // queue between the read and this write; say so.
    const [n] = await d.OutreachEmail.update(
      { status: 'cancelled', lastError: 'converted_to_manual' },
      { where: { id: row.id, status: { [Op.in]: ['queued', 'needs_approval'] } } }
    );
    if (n === 0) {
      throw new AppError('Too late — this email is already sending. Check the task in a minute.', 409);
    }
    await d.audit.recordAuditEvent({
      actorUser: user, action: 'outreach.email_converted_manual', entityType: 'outreach_email',
      entityId: row.id, requestId,
    });
    return d.OutreachEmail.findByPk(row.id);
  }

  return {
    tick, reclaimStranded, reapDisabled,
    approve, sendNow, convertToManual,
    // exported for tests
    replyLoopHealthy, buildRfc822, nextSgtMorning,
  };
}

const _default = makeOutreachSenderService();
export default _default;
