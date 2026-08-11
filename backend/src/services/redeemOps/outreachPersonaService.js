import { OutreachAccount, OutreachPersona, User, sequelize } from '../../models/index.js';
import { AppError } from '../../middleware/appError.js';
import { logger } from '../../utils/logger.js';
import { makeSecretBox } from '../../utils/secretBox.js';
import { makeRedeemOpsAuditService } from './auditService.js';
import {
  makeWorkspaceClient, parseServiceAccountKey, WORKSPACE_SCOPES,
} from '../google/workspaceService.js';

/**
 * Outreach sending identities — Phase A of cadence email auto-send
 * (docs/plans/redeem-ops-cadence-email-autosend.md §2/§2a/§3/§8-A).
 *
 * What lives here: the impersonated account (encrypted service-account key),
 * the persona↔rep mapping, the plan-F2 PARENTAGE pre-flight (an address must
 * be an alias OF THE ACCOUNT or its replies land in someone else's mailbox),
 * send-as verification health (plan F1: registration itself is a manual
 * Gmail tick — the platform only VERIFIES via sendAs.list), and the test-send
 * that doubles as the plan-F4 empirical Message-ID probe.
 *
 * NO engine integration in Phase A — nothing here touches cadences.
 */

const outreachBox = makeSecretBox('OUTREACH_MAILBOX_ENCRYPTION_KEY', 'outreach mailbox');

const ACCOUNT_SCOPES = [
  WORKSPACE_SCOPES.gmailSend,
  WORKSPACE_SCOPES.gmailReadonly,
  WORKSPACE_SCOPES.gmailSettingsBasic,
  WORKSPACE_SCOPES.directoryReadonly,
];

export function makeOutreachPersonaService(overrides = {}) {
  const d = {
    OutreachAccount, OutreachPersona, User, sequelize, logger,
    audit: makeRedeemOpsAuditService(),
    secretBox: outreachBox,
    makeClient: makeWorkspaceClient,
    now: () => new Date(),
    ...overrides,
  };

  async function accountRowTx(t, { withCredentials = false } = {}) {
    const scope = withCredentials ? d.OutreachAccount.scope('withCredentials') : d.OutreachAccount;
    return scope.findOne({ order: [['createdAt', 'ASC']], ...(t ? { transaction: t } : {}) });
  }

  function clientFor(account, credentialsJson) {
    const credentials = parseServiceAccountKey(credentialsJson);
    return d.makeClient({ credentials, subject: account.accountEmail, scopes: ACCOUNT_SCOPES });
  }

  /**
   * The account's sendable alias set: editable alternates + domain-alias
   * twins, minus Google's `*.test-google-a.com` noise (every tenant carries
   * those; nobody sends as them).
   */
  async function usableAliases(client, accountEmail) {
    const all = await client.listUserAliases(accountEmail);
    return all.filter((a) => !a.toLowerCase().endsWith('.test-google-a.com'));
  }

  async function decryptedClient(account) {
    if (!account?.encryptedCredentials) {
      throw new AppError('Connect the Workspace account first — paste the service-account key in Settings.', 409);
    }
    return clientFor(account, d.secretBox.decrypt(account.encryptedCredentials));
  }

  // ── Account setup & health ────────────────────────────────────────────────

  /**
   * Store (or replace) the impersonated account + its encrypted key, then run
   * the health probe immediately so a bad DWD grant fails HERE, loudly, not
   * at first send.
   */
  async function setupAccount({ accountEmail, serviceAccountJson }, user, requestId = null) {
    const email = String(accountEmail || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new AppError('A valid account email is required', 400);
    let credentials;
    try {
      credentials = parseServiceAccountKey(serviceAccountJson);
    } catch (err) {
      throw new AppError(err.message, 400);
    }

    const encrypted = d.secretBox.encrypt(JSON.stringify({
      type: 'service_account', client_email: credentials.clientEmail, private_key: credentials.privateKey,
    }));

    const account = await d.sequelize.transaction(async (t) => {
      const existing = await accountRowTx(t, { withCredentials: true });
      if (existing && existing.accountEmail !== email) {
        // One account row in Phase A — replacing the address is explicit.
        await existing.update({ accountEmail: email, encryptedCredentials: encrypted, lastError: null }, { transaction: t });
        return existing;
      }
      if (existing) {
        await existing.update({ encryptedCredentials: encrypted, lastError: null }, { transaction: t });
        return existing;
      }
      return d.OutreachAccount.create({
        accountEmail: email, encryptedCredentials: encrypted, createdBy: user.id,
      }, { transaction: t });
    });

    await d.audit.recordAuditEvent({
      actorUser: user, action: 'outreach.account_configured', entityType: 'outreach_account',
      entityId: account.id, after: { accountEmail: email, keyClient: credentials.clientEmail }, requestId,
    });

    // Probe immediately; failures are stored on the row AND thrown to the caller.
    const health = await refreshHealth(user, requestId).catch((err) => ({ error: err.message }));
    return { account: await getAccountStatus(), health };
  }

  /**
   * Live health: token exchange works, mailbox reachable, send-as list +
   * parentage per persona. Persists per-persona sendAs/parentage flags so the
   * UI reads truth even between probes.
   */
  async function refreshHealth(user = null, requestId = null) {
    const account = await d.OutreachAccount.scope('withCredentials').findOne({ order: [['createdAt', 'ASC']] });
    if (!account) throw new AppError('No Workspace account configured yet', 404);
    const client = await decryptedClient(account);

    let profile;
    let sendAs;
    let aliases;
    try {
      profile = await client.getProfile();
      sendAs = await client.listSendAs();
      aliases = await usableAliases(client, account.accountEmail);
      await account.update({ lastHealthCheckAt: d.now(), lastError: null });
    } catch (err) {
      await account.update({ lastHealthCheckAt: d.now(), lastError: String(err.message).slice(0, 500) });
      throw new AppError(`Workspace health check failed: ${err.message}`, 502);
    }

    const aliasSet = new Set(aliases.map((a) => a.toLowerCase()));
    const sendAsByEmail = new Map(sendAs.map((s) => [String(s.sendAsEmail || '').toLowerCase(), s]));

    const personas = await d.OutreachPersona.findAll({ where: { accountId: account.id } });
    for (const p of personas) {
      const addr = p.address.toLowerCase();
      const s = sendAsByEmail.get(addr);
      await p.update({
        isAccountAlias: aliasSet.has(addr),
        sendAsRegistered: Boolean(s),
        sendAsVerified: Boolean(s && (s.verificationStatus === 'accepted' || s.isPrimary)),
      });
    }

    return {
      accountEmail: account.accountEmail,
      mailboxOk: Boolean(profile?.emailAddress),
      aliasCount: aliases.length,
      sendAsCount: sendAs.length,
      checkedAt: account.lastHealthCheckAt,
    };
  }

  async function getAccountStatus() {
    const account = await accountRowTx(null);
    if (!account) return { configured: false };
    const json = account.toJSON();
    return {
      configured: true,
      hasCredentials: Boolean(
        (await d.OutreachAccount.scope('withCredentials').findByPk(account.id))?.encryptedCredentials
      ),
      encryptionReady: d.secretBox.isReady(),
      ...json,
    };
  }

  // ── Workspace address listing (§2a — the reusable read) ──────────────────

  /**
   * The live tenant address book, parentage-aware: every user with their
   * aliases, plus which addresses are aliases OF THE CONFIGURED ACCOUNT
   * (only those can be personas — plan F2).
   */
  async function listWorkspaceAddresses() {
    const account = await d.OutreachAccount.scope('withCredentials').findOne({ order: [['createdAt', 'ASC']] });
    if (!account) throw new AppError('No Workspace account configured yet', 404);
    const client = await decryptedClient(account);

    const [users, accountAliases] = await Promise.all([
      client.listUsers(),
      usableAliases(client, account.accountEmail),
    ]);
    const aliasSet = new Set(accountAliases.map((a) => a.toLowerCase()));
    const existing = await d.OutreachPersona.findAll({ attributes: ['address'] });
    const taken = new Set(existing.map((p) => p.address.toLowerCase()));

    return {
      accountEmail: account.accountEmail,
      users: users.map((u) => ({
        primaryEmail: u.primaryEmail,
        fullName: u.name?.fullName || u.primaryEmail,
        aliases: u.aliases || [],
      })),
      accountAliases: accountAliases.map((a) => ({
        address: a,
        importable: !taken.has(a.toLowerCase()),
      })),
    };
  }

  // ── Personas ─────────────────────────────────────────────────────────────

  async function listPersonas() {
    return d.OutreachPersona.findAll({
      include: [{ model: d.User, as: 'assignedUser', attributes: ['id', 'fullName', 'email'] }],
      order: [['createdAt', 'ASC']],
    });
  }

  /**
   * Import addresses as personas. Parentage-enforced at the door: only
   * aliases of the configured account are accepted (plan F2) — anything else
   * is returned under `rejected`, never silently dropped.
   */
  async function importPersonas({ addresses }, user, requestId = null) {
    const account = await d.OutreachAccount.scope('withCredentials').findOne({ order: [['createdAt', 'ASC']] });
    if (!account) throw new AppError('No Workspace account configured yet', 404);
    const client = await decryptedClient(account);
    const aliasSet = new Set((await usableAliases(client, account.accountEmail)).map((a) => a.toLowerCase()));

    const wanted = [...new Set((addresses || []).map((a) => String(a).trim().toLowerCase()).filter(Boolean))];
    if (wanted.length === 0) throw new AppError('Pick at least one address to import', 400);

    const created = [];
    const rejected = [];
    for (const address of wanted) {
      if (!aliasSet.has(address)) {
        rejected.push({ address, reason: 'not_account_alias' });
        continue;
      }
      const [row, wasCreated] = await d.OutreachPersona.findOrCreate({
        where: { address },
        defaults: {
          accountId: account.id,
          address,
          // Default display name from the local part — replaced by the rep's
          // full CRM name at assignment time.
          displayName: address.split('@')[0].replace(/^./, (c) => c.toUpperCase()),
          isAccountAlias: true,
          createdBy: user.id,
        },
      });
      if (wasCreated) created.push(row);
      else rejected.push({ address, reason: 'already_imported' });
    }

    if (created.length > 0) {
      await d.audit.recordAuditEvent({
        actorUser: user, action: 'outreach.personas_imported', entityType: 'outreach_account',
        entityId: account.id, after: { addresses: created.map((c) => c.address) }, requestId,
      });
    }
    return { created, rejected };
  }

  async function updatePersona(personaId, body, user, requestId = null) {
    return d.sequelize.transaction(async (t) => {
      const persona = await d.OutreachPersona.findByPk(personaId, { transaction: t, lock: t.LOCK.UPDATE });
      if (!persona) throw new AppError('Persona not found', 404);

      const patch = {};
      if (body.assignedUserId !== undefined) {
        if (body.assignedUserId === null) {
          patch.assignedUserId = null;
        } else {
          const rep = await d.User.findByPk(body.assignedUserId, { transaction: t });
          if (!rep) throw new AppError('Rep not found', 404);
          const clash = await d.OutreachPersona.findOne({
            where: { assignedUserId: rep.id }, transaction: t,
          });
          if (clash && clash.id !== persona.id) {
            throw new AppError(`${rep.fullName || 'That rep'} already sends as ${clash.address} — unassign it first`, 409);
          }
          patch.assignedUserId = rep.id;
          // Default the From display name to the rep's full CRM name unless
          // the caller sets one explicitly (plan §9.2).
          if (body.displayName === undefined && rep.fullName) patch.displayName = rep.fullName;
        }
      }
      if (body.displayName !== undefined) {
        const name = String(body.displayName).trim();
        if (!name || name.length > 120) throw new AppError('Display name must be 1–120 characters', 400);
        patch.displayName = name;
      }
      if (body.dailySendCap !== undefined) {
        const cap = Number.parseInt(body.dailySendCap, 10);
        if (!Number.isInteger(cap) || cap < 1 || cap > 200) throw new AppError('Daily cap must be 1–200', 400);
        patch.dailySendCap = cap;
      }
      if (body.isActive !== undefined) patch.isActive = Boolean(body.isActive);

      const before = { assignedUserId: persona.assignedUserId, displayName: persona.displayName, dailySendCap: persona.dailySendCap, isActive: persona.isActive };
      await persona.update(patch, { transaction: t });
      await d.audit.recordAuditEvent({
        actorUser: user, action: 'outreach.persona_updated', entityType: 'outreach_persona',
        entityId: persona.id, before, after: patch, requestId, transaction: t,
      });
      return persona;
    });
  }

  // ── Test send (also the plan-F4 Message-ID probe) ────────────────────────

  /**
   * Send a test email FROM the persona TO the account's own inbox — no
   * external mail. Returns whether Gmail preserved our minted Message-ID
   * (plan F4: the Phase-B idempotency design must know, and the answer is
   * undocumented — this settles it empirically per environment).
   */
  async function testSend(personaId, user, requestId = null) {
    const persona = await d.OutreachPersona.findByPk(personaId);
    if (!persona) throw new AppError('Persona not found', 404);
    const account = await d.OutreachAccount.scope('withCredentials').findByPk(persona.accountId);
    const client = await decryptedClient(account);

    if (!persona.isAccountAlias) {
      throw new AppError(`${persona.address} is not an alias of ${account.accountEmail} — replies would land in another mailbox. Fix the alias in Admin console first.`, 409);
    }
    if (!persona.sendAsVerified) {
      throw new AppError(`${persona.address} is not a verified "Send mail as" identity on ${account.accountEmail} yet — tick it once in Gmail settings, then Refresh health.`, 409);
    }

    const minted = `<outreach-test-${persona.id}-${Date.now()}@mktr.sg>`;
    const rfc822 = [
      `From: "${persona.displayName.replace(/"/g, '')}" <${persona.address}>`,
      `To: <${account.accountEmail}>`,
      `Subject: Redeem Ops test send — ${persona.address}`,
      `Message-ID: ${minted}`,
      'Content-Type: text/plain; charset=utf-8',
      '',
      `This is a test from the Redeem Ops outreach setup (${persona.displayName} / ${persona.address}).`,
      'If you can read this, sending works. No prospect was contacted.',
    ].join('\r\n');

    const sent = await client.sendRaw(rfc822);
    let wireMessageId = null;
    try {
      const meta = await client.getMessageHeaders(sent.id, ['Message-ID']);
      wireMessageId = meta?.payload?.headers?.find((h) => h.name?.toLowerCase() === 'message-id')?.value || null;
    } catch (err) {
      d.logger.warn({ err: err?.message }, '[outreach] test-send header fetch failed');
    }

    await d.audit.recordAuditEvent({
      actorUser: user, action: 'outreach.test_send', entityType: 'outreach_persona',
      entityId: persona.id,
      after: { gmailId: sent.id, threadId: sent.threadId, mintedPreserved: wireMessageId === minted },
      requestId,
    });

    return {
      gmailId: sent.id,
      threadId: sent.threadId,
      mintedMessageId: minted,
      wireMessageId,
      mintedPreserved: wireMessageId ? wireMessageId === minted : null,
    };
  }

  return {
    setupAccount, getAccountStatus, refreshHealth,
    listWorkspaceAddresses, listPersonas, importPersonas, updatePersona, testSend,
  };
}

const _default = makeOutreachPersonaService();
export default _default;
