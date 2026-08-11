/**
 * Outreach personas — email auto-send Phase A
 * (docs/plans/redeem-ops-cadence-email-autosend.md §8-A).
 *
 * Google is DI-mocked at the service factory (makeClient override) — no
 * network. Route-level tests cover only the gates + validation that fail
 * BEFORE any Google call; every Google-flow behavior is service-level.
 */
process.env.REDEEM_OPS_ENABLED = 'true';
process.env.REDEEM_OPS_EMAIL_AUTOSEND_ENABLED = 'true';
process.env.OUTREACH_MAILBOX_ENCRYPTION_KEY = 'test-outreach-encryption-key-32chars!';

import request from 'supertest';
import { jest } from '@jest/globals';
import { getApp, closeDb, createTestUser } from './helpers.js';
import { OutreachAccount, OutreachPersona, RedeemOpsAuditEvent } from '../src/models/index.js';
import { makeOutreachPersonaService } from '../src/services/redeemOps/outreachPersonaService.js';
import { encodeMimeHeader } from '../src/services/google/workspaceService.js';
import { makeSecretBox } from '../src/utils/secretBox.js';

let app;
let admin, exec;

const KEY_JSON = JSON.stringify({
  type: 'service_account',
  client_email: 'outreach@mktr-platform.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\nnot-a-real-key\n-----END PRIVATE KEY-----\n',
});

/** Mutable Google fixture each test can shape. */
const google = {
  // Includes a Google test-domain twin — the picker must never offer it.
  aliases: ['emily@redeem.sg', 'jeremy@redeem.sg', 'emily@mktr.sg.test-google-a.com'],
  sendAs: [
    { sendAsEmail: 'business@mktr.sg', isPrimary: true, verificationStatus: 'accepted' },
    // Same-account aliases come back with NO verificationStatus — Gmail never
    // required verification for them. Note the capitalized local part too:
    // matching must be case-insensitive (real tenant data does this).
    { sendAsEmail: 'Emily@redeem.sg' },
    { sendAsEmail: 'jeremy@redeem.sg', verificationStatus: 'pending' },
  ],
  users: [
    { primaryEmail: 'business@mktr.sg', name: { fullName: 'MKTR Business' }, aliases: ['emily@redeem.sg', 'jeremy@redeem.sg'] },
    { primaryEmail: 'tyler@redeem.sg', name: { fullName: 'Tyler Lim' }, aliases: [] },
  ],
  sendRaw: jest.fn(async () => ({ id: 'gm-1', threadId: 'th-1' })),
  wireMessageId: null, // null = echo the minted one back
};

const mockClient = () => ({
  listUsers: async () => google.users,
  listUserAliases: async () => google.aliases,
  getProfile: async () => ({ emailAddress: 'business@mktr.sg' }),
  listSendAs: async () => google.sendAs,
  sendRaw: google.sendRaw,
  getMessageHeaders: async () => ({
    payload: {
      headers: [{
        name: 'Message-ID',
        value: google.wireMessageId ?? google.sendRaw.mock.calls.at(-1)?.[0]?.match(/Message-ID: (<[^>]+>)/)?.[1] ?? null,
      }],
    },
  }),
});

const svc = makeOutreachPersonaService({ makeClient: mockClient });

beforeAll(async () => {
  app = await getApp();
  admin = await createTestUser({ role: 'admin' });
  exec = await createTestUser({ role: 'redeem_ops', redeemOpsRole: 'outreach_exec' });
});

afterAll(async () => {
  await closeDb();
});

beforeEach(async () => {
  google.sendRaw.mockClear();
  google.wireMessageId = null;
  await OutreachPersona.destroy({ where: {} });
  await OutreachAccount.destroy({ where: {} });
});

const auth = (t) => ({ Authorization: `Bearer ${t}` });

async function connectedAccount() {
  const { account } = await svc.setupAccount(
    { accountEmail: 'business@mktr.sg', serviceAccountJson: KEY_JSON }, admin.user
  );
  return account;
}

describe('routes: gates & validation (no Google touched)', () => {
  test('settings.manage gate: exec 403, admin 200; bad setup body 400', async () => {
    expect((await request(app).get('/api/redeem-ops/outreach/account').set(auth(exec.token))).status).toBe(403);
    const ok = await request(app).get('/api/redeem-ops/outreach/account').set(auth(admin.token));
    expect(ok.status).toBe(200);
    expect(ok.body.data.configured).toBe(false);

    const bad = await request(app).put('/api/redeem-ops/outreach/account')
      .set(auth(admin.token)).send({ accountEmail: 'not-an-email', serviceAccountJson: 'x' });
    expect(bad.status).toBe(400);
  });
});

describe('account setup & status', () => {
  test('stores the key encrypted, masks it on read, and probes health immediately', async () => {
    const { health } = await svc.setupAccount(
      { accountEmail: 'Business@MKTR.sg', serviceAccountJson: KEY_JSON }, admin.user
    );
    expect(health.mailboxOk).toBe(true);
    expect(health.aliasCount).toBe(2);

    const raw = await OutreachAccount.scope('withCredentials').findOne({});
    expect(raw.accountEmail).toBe('business@mktr.sg'); // lowercased
    expect(raw.encryptedCredentials).toMatch(/^v1:/); // never plaintext
    // round-trips with the box, and contains no raw key in the row
    const box = makeSecretBox('OUTREACH_MAILBOX_ENCRYPTION_KEY', 'outreach mailbox');
    expect(JSON.parse(box.decrypt(raw.encryptedCredentials)).client_email)
      .toBe('outreach@mktr-platform.iam.gserviceaccount.com');

    const status = await svc.getAccountStatus();
    expect(status.configured).toBe(true);
    expect(status.hasCredentials).toBe(true);
    expect(status.encryptedCredentials).toBeUndefined(); // defaultScope masks
  });

  test('a garbage key is refused before anything is stored', async () => {
    await expect(svc.setupAccount(
      { accountEmail: 'business@mktr.sg', serviceAccountJson: '{"type":"user"}' }, admin.user
    )).rejects.toMatchObject({ statusCode: 400 });
    expect(await OutreachAccount.count()).toBe(0);
  });
});

describe('workspace addresses & parentage (plan F2)', () => {
  test('lists the account aliases with importable flags and the tenant users', async () => {
    await connectedAccount();
    const out = await svc.listWorkspaceAddresses();
    expect(out.accountEmail).toBe('business@mktr.sg');
    expect(out.accountAliases).toEqual([
      { address: 'emily@redeem.sg', importable: true },
      { address: 'jeremy@redeem.sg', importable: true },
    ]);
    // tyler is a USER in the tenant, not an alias of business@ — visible in
    // users[], absent from accountAliases: the F2 distinction.
    expect(out.users.map((u) => u.primaryEmail)).toContain('tyler@redeem.sg');
  });

  test('import enforces parentage: non-aliases are rejected loudly, never silently dropped', async () => {
    await connectedAccount();
    const result = await svc.importPersonas(
      { addresses: ['emily@redeem.sg', 'tyler@redeem.sg'] }, admin.user
    );
    expect(result.created.map((c) => c.address)).toEqual(['emily@redeem.sg']);
    expect(result.rejected).toEqual([{ address: 'tyler@redeem.sg', reason: 'not_account_alias' }]);

    const again = await svc.importPersonas({ addresses: ['emily@redeem.sg'] }, admin.user);
    expect(again.rejected).toEqual([{ address: 'emily@redeem.sg', reason: 'already_imported' }]);
  });
});

describe('persona mapping (who-is-who)', () => {
  test('assigning a rep defaults the display name to their full CRM name; one persona per rep', async () => {
    await connectedAccount();
    const { created } = await svc.importPersonas(
      { addresses: ['emily@redeem.sg', 'jeremy@redeem.sg'] }, admin.user
    );
    const [emily, jeremy] = created;

    const updated = await svc.updatePersona(emily.id, { assignedUserId: exec.user.id }, admin.user);
    expect(updated.assignedUserId).toBe(exec.user.id);
    expect(updated.displayName).toBe(exec.user.fullName);

    // the same rep cannot hold a second persona
    await expect(svc.updatePersona(jeremy.id, { assignedUserId: exec.user.id }, admin.user))
      .rejects.toMatchObject({ statusCode: 409 });

    // a deactivated rep cannot receive a sending identity
    const departed = await createTestUser({ role: 'redeem_ops', redeemOpsRole: 'outreach_exec' });
    await departed.user.update({ isActive: false });
    await expect(svc.updatePersona(jeremy.id, { assignedUserId: departed.user.id }, admin.user))
      .rejects.toMatchObject({ statusCode: 409 });

    // cap bounds enforced
    await expect(svc.updatePersona(emily.id, { dailySendCap: 0 }, admin.user))
      .rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('health refresh persists per-persona truth', () => {
  test('sendAs verification and parentage flags land on the rows', async () => {
    await connectedAccount();
    await svc.importPersonas({ addresses: ['emily@redeem.sg', 'jeremy@redeem.sg'] }, admin.user);
    await svc.refreshHealth(admin.user);

    const emily = await OutreachPersona.findOne({ where: { address: 'emily@redeem.sg' } });
    const jeremy = await OutreachPersona.findOne({ where: { address: 'jeremy@redeem.sg' } });
    expect(emily.sendAsVerified).toBe(true);
    expect(emily.isAccountAlias).toBe(true);
    expect(jeremy.sendAsRegistered).toBe(true);
    expect(jeremy.sendAsVerified).toBe(false); // pending in the fixture
  });
});

describe('test send (and the plan-F4 Message-ID probe)', () => {
  test('refuses unverified send-as; sends From the persona to the shared inbox; reports the probe', async () => {
    await connectedAccount();
    const { created } = await svc.importPersonas(
      { addresses: ['emily@redeem.sg', 'jeremy@redeem.sg'] }, admin.user
    );
    await svc.refreshHealth(admin.user);

    const jeremy = created.find((p) => p.address === 'jeremy@redeem.sg');
    await expect(svc.testSend(jeremy.id, admin.user)).rejects.toMatchObject({ statusCode: 409 });

    const emily = created.find((p) => p.address === 'emily@redeem.sg');
    const result = await svc.testSend(emily.id, admin.user);
    const rfc = google.sendRaw.mock.calls[0][0];
    expect(rfc).toContain('From: "Emily" <emily@redeem.sg>');
    expect(rfc).toContain('To: <business@mktr.sg>'); // never a prospect
    // The em-dash subject must ride as an RFC-2047 encoded word — raw UTF-8
    // in a header renders as mojibake (seen live: "Ã¢Â€Â"").
    expect(rfc).toMatch(/Subject: =\?UTF-8\?B\?/);
    expect(rfc).not.toMatch(/Subject: [^\r\n]*—/);
    expect(result.mintedPreserved).toBe(true); // fixture echoes the minted id

    // The encoder itself: ASCII untouched; non-ASCII decodes back losslessly.
    expect(encodeMimeHeader('Plain subject')).toBe('Plain subject');
    const fancy = 'Idea for Café 北京 — trial 😀';
    const decoded = encodeMimeHeader(fancy).split(' ')
      .map((w) => Buffer.from(w.replace(/^=\?UTF-8\?B\?/, '').replace(/\?=$/, ''), 'base64').toString('utf8'))
      .join('');
    expect(decoded).toBe(fancy);

    const audit = await RedeemOpsAuditEvent.findOne({
      where: { action: 'outreach.test_send', entityId: emily.id },
    });
    expect(audit.after).toMatchObject({ gmailId: 'gm-1', mintedPreserved: true });
  });

  test('a rewritten Message-ID is detected, not assumed', async () => {
    await connectedAccount();
    const { created } = await svc.importPersonas({ addresses: ['emily@redeem.sg'] }, admin.user);
    await svc.refreshHealth(admin.user);
    google.wireMessageId = '<CAxyz-rewritten@mail.gmail.com>';
    const result = await svc.testSend(created[0].id, admin.user);
    expect(result.mintedPreserved).toBe(false);
    expect(result.wireMessageId).toBe('<CAxyz-rewritten@mail.gmail.com>');
  });
});
