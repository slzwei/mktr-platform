import { Op } from 'sequelize';
import {
  OutreachAccount, OutreachPersona, OutreachEmail, OutreachTask,
  OutreachSuppression, OutreachCadenceEnrollment, PartnerOrganisation, User, sequelize,
} from '../../models/index.js';
import { logger } from '../../utils/logger.js';
import { makeSecretBox } from '../../utils/secretBox.js';
import { makeRedeemOpsAuditService } from './auditService.js';
import { makePartnerService } from './partnerService.js';
import { makeWorkspaceClient, parseServiceAccountKey, WORKSPACE_SCOPES } from '../google/workspaceService.js';

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
    const link = `https://ops.redeem.sg/redeem-ops/partners/${partner.id}`;
    const rfc822 = [
      `From: "Redeem outreach" <${account.accountEmail}>`,
      `To: <${rep.email}>`,
      `Subject: Reply from ${String(partner.tradingName || partner.legalName || 'a prospect').replace(/[\r\n]+/g, ' ')} — answer them soon`,
      'Content-Type: text/plain; charset=utf-8',
      '',
      `They replied on the ${persona?.address || 'outreach'} thread (${String(subject).replace(/[\r\n]+/g, ' ')}):`,
      '',
      String(text || '(no text body — open the thread in the shared mailbox)').slice(0, 4000),
      '',
      `From: ${fromHeader}`,
      `Business page: ${link}`,
      '',
      'The cadence has been stopped automatically. Reply from the shared mailbox or call them.',
    ].join('\r\n');
    try {
      await client.sendRaw(rfc822);
      return true;
    } catch (err) {
      d.logger.warn({ partnerId: partner.id, err: err?.message }, '[inbox] reply forward failed (non-fatal)');
      return false;
    }
  }

  /** Handle ONE new inbox message. Returns a label for counters/tests. */
  async function handleMessage(account, client, personaAddresses, msgRef) {
    const msg = await client.getMessage(msgRef.id).catch(() => null);
    if (!msg) return 'fetch_failed';
    const payload = msg.payload || {};
    const from = headerOf(payload, 'From');
    const to = `${headerOf(payload, 'To')} ${headerOf(payload, 'Delivered-To')} ${headerOf(payload, 'Cc')}`.toLowerCase();
    const subject = headerOf(payload, 'Subject');
    const isBounce = BOUNCE_FROM_RE.test(from) || payload.mimeType === 'multipart/report';

    // Tracked thread?
    const row = msg.threadId
      ? await d.OutreachEmail.findOne({
        where: { gmailThreadId: msg.threadId, status: { [Op.in]: ['sent', 'sending', 'failed'] } },
        order: [['sentAt', 'DESC']],
      })
      : null;

    if (!row) {
      // Only persona-addressed HUMAN mail counts as "unmatched" — the shared
      // account's ordinary mail is none of our business.
      const toPersona = personaAddresses.some((a) => to.includes(a));
      if (toPersona && !isBounce) {
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
    try {
      await d.partners.logActivity(partner.id, {
        type: 'email_reply', direction: 'inbound',
        summary: `Replied by email: ${String(subject).slice(0, 120)}`,
      }, actor);
    } catch (err) {
      d.logger.error({ partnerId: partner.id, err: err?.message }, '[inbox] reply activity failed');
      return 'reply_log_failed';
    }

    if (UNSUB_RE.test(`${subject} ${text}`)) {
      await suppress(row.toAddress, 'opt_out');
    }
    await forwardReplyToRep({ client, account, partner, persona, task, fromHeader: from, subject, text });
    await d.audit.recordAuditEvent({
      actorUser: null, actorType: 'system', action: 'outreach.reply_received',
      entityType: 'outreach_email', entityId: row.id,
      after: { partnerId: partner.id, unsubscribe: UNSUB_RE.test(`${subject} ${text}`) },
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

    const counts = {};
    for (const msgRef of messages) {
      const label = await handleMessage(account, client, personaAddresses, msgRef)
        .catch((err) => {
          d.logger.error({ msgId: msgRef.id, err: err?.message }, '[inbox] message handling crashed');
          return 'crashed';
        });
      counts[label] = (counts[label] || 0) + 1;
    }

    // The stamp that unlocks the sender — written on EVERY clean pass,
    // including empty ones and re-baselines (the loop is demonstrably alive).
    await d.OutreachAccount.update(
      { historyCursor: cursor, lastSuccessfulPollAt: d.now(), lastError: null },
      { where: { id: account.id } }
    );
    if (messages.length > 0) d.logger.info({ accountId: account.id, ...counts }, '[inbox] poll done');
    return { processed: messages.length, counts };
  }

  /** Poll every active account. Failures are per-account, never cross-fatal. */
  async function poll() {
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
