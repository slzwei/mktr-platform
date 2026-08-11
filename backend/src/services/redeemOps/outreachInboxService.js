import { Op } from 'sequelize';
import {
  OutreachAccount, OutreachPersona, OutreachEmail, OutreachTask,
  OutreachSuppression, OutreachCadenceEnrollment, PartnerOrganisation, User,
  IdempotencyKey, sequelize,
} from '../../models/index.js';
import { logger } from '../../utils/logger.js';
import { makeSecretBox } from '../../utils/secretBox.js';
import { makeRedeemOpsAuditService } from './auditService.js';
import { makePartnerService } from './partnerService.js';
import { makeWorkspaceClient, parseServiceAccountKey, encodeMimeHeader, WORKSPACE_SCOPES } from '../google/workspaceService.js';

/**
 * The inbox loop — Phase C (docs/plans/redeem-ops-cadence-email-autosend.md §5).
 *
 * Every clean pass stamps `lastSuccessfulPollAt`, which is the ONLY thing
 * that unlocks the Phase-B sender (plan P1). What a pass does:
 * - Gmail history since the persisted cursor (404 ⇒ full re-sync re-baseline,
 *   Google's documented contract — plan F8).
 * - A message in a TRACKED thread: bounce ⇒ suppression(bounced) + outbox
 *   failed; human reply ⇒ `email_reply` inbound activity under the partner
 *   lock (the existing onInboundActivity hook exits the cadence and cancels
 *   its tasks) + auto-FORWARD to the owning rep's real mailbox (plan P7) +
 *   unsubscribe keywords ⇒ suppression(opt_out).
 * - Replies to a MERGED partner chase `mergedIntoId` to the survivor (M4).
 * - Unmatched human mail TO A PERSONA address bumps the health-card counter;
 *   ordinary business@ mail is ignored entirely.
 */

const outreachBox = makeSecretBox('OUTREACH_MAILBOX_ENCRYPTION_KEY', 'outreach mailbox');
const SCOPES = [
  WORKSPACE_SCOPES.gmailSend, WORKSPACE_SCOPES.gmailReadonly,
  WORKSPACE_SCOPES.gmailSettingsBasic, WORKSPACE_SCOPES.directoryReadonly,
];

const UNSUB_RE = /\b(unsubscribe|remove me|stop (emailing|contacting)|do ?n[o']t (email|contact))\b/i;
const BOUNCE_FROM_RE = /(mailer-daemon|postmaster)@/i;
// Foreign-MTA bounces that use neither a daemon From nor multipart/report
// (review F4) — subject heuristic as the third signal.
const BOUNCE_SUBJECT_RE = /(delivery status notification|undeliverable|delivery (has )?failed|mail delivery failed|returned mail|failure notice)/i;
// Gmail's "(Delay)" notices come from mailer-daemon while it is still
// RETRYING — suppressing on them blocks deliverable addresses (review F3).
const DELAY_SUBJECT_RE = /\(delay\)|delivery incomplete|will keep trying/i;
const MSG_IDEMPOTENCY_SCOPE = 'inbox:msg';
const MSG_IDEMPOTENCY_TTL_MS = 7 * 24 * 3600_000;
const POISON_SKIP_AFTER = 3;

function headerOf(payload, name) {
  return payload?.headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || '';
}

/** Best-effort text/plain extraction from a Gmail full payload. */
export function extractPlainText(payload, depth = 0) {
  if (!payload || depth > 4) return '';
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    try {
      return Buffer.from(payload.body.data, 'base64url').toString('utf8');
    } catch {
      return '';
    }
  }
  for (const part of payload.parts || []) {
    const text = extractPlainText(part, depth + 1);
    if (text) return text;
  }
  return '';
}

export function makeOutreachInboxService(overrides = {}) {
  const d = {
    OutreachAccount, OutreachPersona, OutreachEmail, OutreachTask,
    OutreachSuppression, OutreachCadenceEnrollment, PartnerOrganisation, User, sequelize, logger,
    audit: makeRedeemOpsAuditService(),
    partners: makePartnerService(),
    secretBox: outreachBox,
    makeClient: makeWorkspaceClient,
    now: () => new Date(),
    ...overrides,
  };

  // Consecutive per-message failure streaks (in-memory; resets on restart —
  // the bound is against a permanently-poisoned message, not bookkeeping).
  const failStreak = new Map();

  async function clientFor(account) {
    const withCreds = await d.OutreachAccount.scope('withCredentials').findByPk(account.id);
    if (!withCreds?.encryptedCredentials) throw new Error('account has no credentials');
    const credentials = parseServiceAccountKey(d.secretBox.decrypt(withCreds.encryptedCredentials));
    return d.makeClient({ credentials, subject: account.accountEmail, scopes: SCOPES });
  }

  /** Upsert into the suppression list — its FIRST real writers live here. */
  async function suppress(email, reason) {
    const value = String(email).toLowerCase();
    const [row, created] = await d.OutreachSuppression.findOrCreate({
      where: { channel: 'email', value },
      defaults: { channel: 'email', value, reason, source: 'inbox_loop' },
    });
    if (!created && row.reason !== reason && reason === 'opt_out') {
      // opt_out outranks bounced — an explicit "stop" is the stronger fact.
      await row.update({ reason });
    }
    return row;
  }

  /** The partner a tracked row belongs to, merge-chased to the survivor (M4). */
  async function livePartnerFor(row) {
    let partner = await d.PartnerOrganisation.findByPk(row.partnerOrganisationId);
    let hops = 0;
    while (partner?.mergedIntoId && hops < 5) {
      partner = await d.PartnerOrganisation.findByPk(partner.mergedIntoId);
      hops += 1;
    }
    return partner && !partner.mergedIntoId ? partner : null;
  }

  async function forwardReplyToRep({ client, account, partner, persona, task, fromHeader, subject, text }) {
    const repUserId = partner.ownerUserId || task?.assigneeUserId || persona?.assignedUserId;
    const rep = repUserId ? await d.User.findByPk(repUserId, { attributes: ['id', 'email', 'fullName'] }) : null;
    if (!rep?.email) return false;
    const headerSafe = (v) => String(v).replace(/[\r\n]+/g, ' ');
    const link = `https://ops.redeem.sg/redeem-ops/partners/${partner.id}`;
    const rfc822 = [
      `From: "Redeem outreach" <${headerSafe(account.accountEmail)}>`,
      `To: <${headerSafe(rep.email)}>`,
      `Subject: ${encodeMimeHeader(`Reply from ${headerSafe(partner.tradingName || partner.legalName || 'a prospect')} — answer them soon`)}`,
      'Content-Type: text/plain; charset=utf-8',
      '',
      `They replied on the ${persona?.address || 'outreach'} thread (${headerSafe(subject)}):`,
      '',
      String(text || '(no text body — open the thread in the shared mailbox)').slice(0, 4000),
      '',
      `From: ${fromHeader}`,
      `Business page: ${link}`,
      '',
      'The cadence has been stopped automatically. Reply from the shared mailbox or call them.',
    ].join('\r\n');
    // One immediate retry; a soft double failure is recorded on the
    // reply_received audit (forwarded:false) — queryable, never invisible.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await client.sendRaw(rfc822);
        return true;
      } catch (err) {
        if (attempt === 1) {
          d.logger.warn({ partnerId: partner.id, err: err?.message }, '[inbox] reply forward failed twice (reply still on the timeline)');
        }
      }
    }
    return false;
  }

  /**
   * Handle ONE new inbox message. Returns a label for counters/tests.
   * Throws on TRANSIENT failures — the caller must NOT advance the cursor
   * past an unprocessed message (review F1: a swallowed reply or opt-out
   * under a green health light is exactly the blindness P1 forbids).
   */
  async function handleMessage(account, client, personaAddresses, msgRef) {
    let msg;
    try {
      msg = await client.getMessage(msgRef.id);
    } catch (err) {
      if (err?.status === 404) return 'gone'; // deleted — documented-safe skip
      throw err; // transient: fail the PASS, not the message
    }
    if (!msg) return 'gone';

    // At-least-once processing needs at-most-once SIDE EFFECTS: replays
    // (crash-before-stamp, overlapping polls, Gmail's documented duplicate
    // history records) are deduped on a per-message idempotency key (F2).
    const [, fresh] = await IdempotencyKey.findOrCreate({
      where: { scope: MSG_IDEMPOTENCY_SCOPE, key: msgRef.id },
      defaults: { expiresAt: new Date(d.now().getTime() + MSG_IDEMPOTENCY_TTL_MS) },
    }).then(([row, created]) => [row, created]);
    if (!fresh) return 'duplicate';

    const payload = msg.payload || {};
    const from = headerOf(payload, 'From');
    const to = `${headerOf(payload, 'To')} ${headerOf(payload, 'Delivered-To')} ${headerOf(payload, 'Cc')}`.toLowerCase();
    const subject = headerOf(payload, 'Subject');
    const isBounce = BOUNCE_FROM_RE.test(from) || payload.mimeType === 'multipart/report'
      || BOUNCE_SUBJECT_RE.test(subject);
    // Gmail delay notices = still retrying, NOT a failure — ignore entirely.
    if (isBounce && DELAY_SUBJECT_RE.test(subject)) return 'delay_notice';
    // Vacation responders must not exit cadences as "replied" (review F4b).
    const autoSubmitted = headerOf(payload, 'Auto-Submitted');
    const isAutoReply = (autoSubmitted && !/^no$/i.test(autoSubmitted))
      || Boolean(headerOf(payload, 'X-Autoreply')) || Boolean(headerOf(payload, 'X-Autorespond'));

    // Tracked thread?
    const row = msg.threadId
      ? await d.OutreachEmail.findOne({
        where: { gmailThreadId: msg.threadId, status: { [Op.in]: ['sent', 'sending', 'failed'] } },
        order: [['sentAt', 'DESC NULLS LAST']],
      })
      : null;

    if (!row) {
      // Only persona-addressed HUMAN mail counts as "unmatched" — the shared
      // account's ordinary mail is none of our business. Bounded match, not
      // substring (notemily@ must not count as emily@ — review F10).
      const toTokens = to.split(/[\s,;<>"]+/).filter(Boolean);
      const toPersona = personaAddresses.some((a) => toTokens.includes(a));
      if (toPersona && !isBounce && !isAutoReply) {
        await d.OutreachAccount.increment('unmatchedInboxCount', { where: { id: account.id } });
        return 'unmatched_persona_mail';
      }
      return 'ignored';
    }

    if (isBounce) {
      await suppress(row.toAddress, 'bounced');
      await d.OutreachEmail.update(
        { status: 'failed', lastError: 'bounced' },
        { where: { id: row.id, status: { [Op.in]: ['sent', 'sending'] } } }
      );
      await d.audit.recordAuditEvent({
        actorUser: null, actorType: 'system', action: 'outreach.email_bounced',
        entityType: 'outreach_email', entityId: row.id, after: { toAddress: row.toAddress },
      });
      return 'bounce';
    }

    if (isAutoReply) {
      // Out-of-office: real mailbox, no human intent — never an exit, never
      // a "answer them soon" forward. Visible in the poll counters only.
      return 'auto_reply';
    }

    // ── Human reply on a tracked thread ──────────────────────────────────
    const partner = await livePartnerFor(row);
    if (!partner) return 'partner_gone';
    const persona = row.personaId ? await d.OutreachPersona.findByPk(row.personaId) : null;
    const task = await d.OutreachTask.findByPk(row.taskId);
    const text = extractPlainText(payload) || msg.snippet || '';

    // The honest inbound activity — the existing onInboundActivity hook exits
    // the live cadence and cancels its tasks in the same transaction. Actor =
    // the partner's CURRENT owner; an UNOWNED (released) partner logs under a
    // synthetic admin-shaped system context (actorUserId null on the row) —
    // a real reply is never dropped for lack of an owner (review M4).
    const actor = partner.ownerUserId
      ? { id: partner.ownerUserId }
      : { id: null, role: 'admin' };
    // Transient log failures THROW (F1): the pass must not advance past an
    // unrecorded reply. The idempotency key is deleted first so the retry
    // pass re-enters this message instead of skipping it as a duplicate.
    try {
      await d.partners.logActivity(partner.id, {
        type: 'email_reply', direction: 'inbound',
        summary: `Replied by email: ${String(subject).slice(0, 120)}`,
      }, actor);
    } catch (err) {
      await IdempotencyKey.destroy({ where: { scope: MSG_IDEMPOTENCY_SCOPE, key: msgRef.id } }).catch(() => {});
      throw err;
    }

    const unsubscribe = UNSUB_RE.test(`${subject} ${text}`);
    if (unsubscribe) {
      // Suppresses the address WE WERE MAILING (row.toAddress) — the human
      // may reply from a personal address; "stop emailing this address" is
      // about the destination, not the replier's From. Deliberate (P18).
      await suppress(row.toAddress, 'opt_out');
    }
    const forwarded = await forwardReplyToRep({
      client, account, partner, persona, task, fromHeader: from, subject, text,
    });
    await d.audit.recordAuditEvent({
      actorUser: null, actorType: 'system', action: 'outreach.reply_received',
      entityType: 'outreach_email', entityId: row.id,
      after: { partnerId: partner.id, unsubscribe, forwarded },
    });
    return 'reply';
  }

  /** One poll pass over one account. */
  async function pollAccount(account) {
    const client = await clientFor(account);
    const personas = await d.OutreachPersona.findAll({ where: { accountId: account.id }, attributes: ['address'] });
    const personaAddresses = personas.map((p) => p.address.toLowerCase());

    let cursor = account.historyCursor;
    let messages = [];
    if (!cursor) {
      // First run: baseline only — history starts NOW; old mail is not replayed.
      const profile = await client.getProfile();
      cursor = String(profile.historyId);
    } else {
      try {
        const out = await client.listInboxHistory(cursor);
        messages = out.messages;
        cursor = String(out.historyId || cursor);
      } catch (err) {
        if (err?.status === 404) {
          // Cursor expired (documented) — re-baseline and accept the gap, loudly.
          const profile = await client.getProfile();
          cursor = String(profile.historyId);
          d.logger.warn({ accountId: account.id }, '[inbox] history cursor expired — re-baselined (gap accepted)');
        } else {
          throw err;
        }
      }
    }

    // Gmail's sync guide: the same change may appear in multiple history
    // records — dedupe by message id before processing (F2).
    const seen = new Set();
    const unique = messages.filter((m) => (seen.has(m.id) ? false : seen.add(m.id)));

    const counts = {};
    for (const msgRef of unique) {
      let label;
      try {
        label = await handleMessage(account, client, personaAddresses, msgRef);
        failStreak.delete(msgRef.id);
      } catch (err) {
        // Transient failure: the PASS fails — cursor and stamp must not
        // advance past an unprocessed message (F1). A message that fails
        // POISON_SKIP_AFTER consecutive passes is skipped VISIBLY so one
        // malformed mail can't wedge the loop (and the sender) forever.
        const streak = (failStreak.get(msgRef.id) || 0) + 1;
        failStreak.set(msgRef.id, streak);
        if (streak >= POISON_SKIP_AFTER) {
          d.logger.error({ msgId: msgRef.id, streak, err: err?.message }, '[inbox] message poisoned — SKIPPING it (check the shared mailbox manually)');
          await d.OutreachAccount.update(
            { lastError: `poll: skipped poisoned message ${msgRef.id} (${String(err?.message).slice(0, 120)})` },
            { where: { id: account.id } }
          ).catch(() => {});
          failStreak.delete(msgRef.id);
          label = 'poisoned_skipped';
        } else {
          d.logger.warn({ msgId: msgRef.id, streak, err: err?.message }, '[inbox] message handling failed — pass aborted, will retry');
          throw err;
        }
      }
      counts[label] = (counts[label] || 0) + 1;
    }

    // The stamp that unlocks the sender — written on EVERY clean pass,
    // including empty ones and re-baselines (the loop is demonstrably
    // alive). It clears only errors the POLL wrote: the Phase-A health
    // check shares lastError and a clean poll must not mask a send-as or
    // directory failure it never tested (F5).
    await d.sequelize.query(
      `UPDATE outreach_accounts
          SET "historyCursor" = :cursor, "lastSuccessfulPollAt" = NOW(),
              "lastError" = CASE WHEN "lastError" LIKE 'poll:%' THEN NULL ELSE "lastError" END,
              "updatedAt" = NOW()
        WHERE id = :id`,
      { replacements: { cursor, id: account.id } }
    );
    if (unique.length > 0) d.logger.info({ accountId: account.id, ...counts }, '[inbox] poll done');
    return { processed: unique.length, counts };
  }

  /** Poll every active account. Failures are per-account, never cross-fatal. */
  let polling = false;
  async function poll() {
    // In-process mutual exclusion (F2): a fat batch must not overlap the
    // next interval. Cross-process overlap (deploys) is bounded by the
    // per-message idempotency keys.
    if (polling) return [{ skipped: 'poll_in_progress' }];
    polling = true;
    try {
      const accounts = await d.OutreachAccount.findAll({ where: { isActive: true }, order: [['createdAt', 'ASC']] });
      const results = [];
      for (const account of accounts) {
        try {
          results.push(await pollAccount(account));
        } catch (err) {
          d.logger.warn({ accountId: account.id, err: err?.message }, '[inbox] poll failed — sender stays gated');
          await d.OutreachAccount.update(
            { lastError: `poll: ${String(err?.message).slice(0, 300)}` },
            { where: { id: account.id } }
          ).catch(() => {});
          results.push({ error: err?.message });
        }
      }
      return results;
    } finally {
      polling = false;
    }
  }

  /** Manual opt-out (the Replied-card classification, plan P18). */
  async function optOutAddress(email, user, requestId = null) {
    const row = await suppress(email, 'opt_out');
    await d.audit.recordAuditEvent({
      actorUser: user, action: 'outreach.opt_out_recorded', entityType: 'outreach_suppression',
      entityId: row.id, after: { value: row.value }, requestId,
    });
    return row;
  }

  return { poll, pollAccount, optOutAddress, suppress };
}

const _default = makeOutreachInboxService();
export default _default;
