import jwt from 'jsonwebtoken';
import { logger } from '../../utils/logger.js';

/**
 * SHARED Google Workspace client (docs/plans/redeem-ops-cadence-email-autosend.md
 * §2a) — generic, redeemOps-agnostic. Auth is a service account with
 * domain-wide delegation impersonating a Workspace user; calls are plain REST
 * via fetch (no googleapis dependency — jsonwebtoken signs the RS256
 * assertion, the repo already carries it).
 *
 * Consumers today: outreach personas (Phase A: directory + send-as health,
 * test-send). Future features import this same module and at most add a scope
 * to the one DWD grant. Read-only against the directory BY DESIGN — no
 * users/aliases writes live here (plan §2a).
 */

export const WORKSPACE_SCOPES = {
  gmailSend: 'https://www.googleapis.com/auth/gmail.send',
  gmailReadonly: 'https://www.googleapis.com/auth/gmail.readonly',
  gmailSettingsBasic: 'https://www.googleapis.com/auth/gmail.settings.basic',
  directoryReadonly: 'https://www.googleapis.com/auth/admin.directory.user.readonly',
};

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const TOKEN_TTL_SLACK_MS = 60_000;

/** Parse + sanity-check a pasted service-account JSON key. Throws plain Error. */
export function parseServiceAccountKey(raw) {
  let parsed;
  try {
    parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    throw new Error('Not valid JSON — paste the full service-account key file.');
  }
  if (parsed?.type !== 'service_account' || !parsed.client_email || !parsed.private_key) {
    throw new Error('The JSON is not a service-account key (needs type, client_email, private_key).');
  }
  return { clientEmail: parsed.client_email, privateKey: parsed.private_key };
}

/**
 * @param {object} opts
 * @param {{clientEmail: string, privateKey: string}} opts.credentials
 * @param {string} opts.subject   Workspace user to impersonate (must be the
 *                                mailbox owner; admin-capable for directory calls)
 * @param {string[]} opts.scopes
 */
export function makeWorkspaceClient({ credentials, subject, scopes, fetchImpl = fetch, now = () => new Date() }) {
  let cached = null; // { token, expiresAt }

  async function accessToken() {
    if (cached && cached.expiresAt - TOKEN_TTL_SLACK_MS > now().getTime()) return cached.token;
    const iat = Math.floor(now().getTime() / 1000);
    const assertion = jwt.sign(
      {
        iss: credentials.clientEmail,
        sub: subject,
        aud: TOKEN_URL,
        scope: scopes.join(' '),
        iat,
        exp: iat + 3500,
      },
      credentials.privateKey,
      { algorithm: 'RS256' }
    );
    const res = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      // unauthorized_client = the DWD grant is missing/mismatched — the most
      // common setup failure; surface Google's own words.
      throw new Error(`Google token exchange failed (${res.status}): ${body.error || ''} ${body.error_description || ''}`.trim());
    }
    cached = { token: body.access_token, expiresAt: now().getTime() + (body.expires_in || 3600) * 1000 };
    return cached.token;
  }

  async function api(url, { method = 'GET', json } = {}) {
    const token = await accessToken();
    // Bounded per-call time is what makes the sender's stale-`sending`
    // reclaim threshold sound — an unbounded hang past it risks a re-send.
    const res = await fetchImpl(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(json ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(json ? { body: JSON.stringify(json) } : {}),
      signal: AbortSignal.timeout(15_000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(`Google API ${method} ${url.split('?')[0]} → ${res.status}: ${body?.error?.message || 'unknown error'}`);
      err.status = res.status;
      throw err;
    }
    return body;
  }

  return {
    // ── Directory (read-only) ────────────────────────────────────────────
    /** Every user in the tenant with primaryEmail + aliases[] + emails[]. */
    async listUsers() {
      const users = [];
      let pageToken = '';
      do {
        const page = await api(
          `https://admin.googleapis.com/admin/directory/v1/users?customer=my_customer&maxResults=200&projection=full${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`
        );
        users.push(...(page.users || []));
        pageToken = page.nextPageToken || '';
      } while (pageToken);
      return users;
    },
    /**
     * The aliases OF ONE user — the plan-F2 parentage source of truth.
     * Reads the USER resource, not the aliases collection: domain-alias
     * twins (redeem.sg as a user-alias domain of mktr.sg) live only in
     * `nonEditableAliases[]` and never appear in aliases.list — they are
     * real, deliver to this user, and must count as the user's own.
     */
    async listUserAliases(email) {
      const user = await api(`https://admin.googleapis.com/admin/directory/v1/users/${encodeURIComponent(email)}?projection=full`);
      return [...new Set([...(user.aliases || []), ...(user.nonEditableAliases || [])])];
    },

    // ── Gmail (impersonated subject's mailbox) ───────────────────────────
    async getProfile() {
      return api(`https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(subject)}/profile`);
    },
    /** Send-as identities incl. verification status — the health card's feed. */
    async listSendAs() {
      const body = await api(`https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(subject)}/settings/sendAs`);
      return body.sendAs || [];
    },
    /**
     * Raw RFC-2822 send. Passing threadId is REQUIRED to append to an
     * existing thread (Gmail needs threadId + RFC headers + matching subject
     * — all three). Returns Gmail's { id, threadId, labelIds }.
     */
    async sendRaw(rfc822, { threadId = null } = {}) {
      return api(`https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(subject)}/messages/send`, {
        method: 'POST',
        json: {
          raw: Buffer.from(rfc822, 'utf8').toString('base64url'),
          ...(threadId ? { threadId } : {}),
        },
      });
    },
    /** Thread metadata — the pre-send "did they already reply?" check. */
    async getThread(threadId) {
      return api(`https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(subject)}/threads/${encodeURIComponent(threadId)}?format=minimal`);
    },
    /** Search the mailbox (Gmail q syntax) — crash-window send dedupe. */
    async listMessages(q, { maxResults = 5 } = {}) {
      const body = await api(`https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(subject)}/messages?maxResults=${maxResults}&q=${encodeURIComponent(q)}`);
      return body.messages || [];
    },
    /**
     * INBOX history since a cursor (the documented incremental-sync pattern).
     * Throws err.status=404 when the cursor expired — callers MUST full-sync
     * re-baseline then (Google's stated contract, plan F8).
     */
    async listInboxHistory(startHistoryId) {
      const out = [];
      let pageToken = '';
      let latestHistoryId = startHistoryId;
      do {
        const body = await api(
          `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(subject)}/history?startHistoryId=${encodeURIComponent(startHistoryId)}&historyTypes=messageAdded&labelId=INBOX${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`
        );
        for (const h of body.history || []) {
          for (const added of h.messagesAdded || []) {
            if (added.message) out.push(added.message);
          }
        }
        latestHistoryId = body.historyId || latestHistoryId;
        pageToken = body.nextPageToken || '';
      } while (pageToken);
      return { messages: out, historyId: latestHistoryId };
    },
    /** One message, full payload (text extraction is the caller's job). */
    async getMessage(id, { format = 'full' } = {}) {
      return api(`https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(subject)}/messages/${encodeURIComponent(id)}?format=${format}`);
    },
    /** Metadata of one message — used to learn the REAL wire Message-ID (plan F4). */
    async getMessageHeaders(id, headerNames = ['Message-ID']) {
      const qs = headerNames.map((h) => `metadataHeaders=${encodeURIComponent(h)}`).join('&');
      return api(`https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(subject)}/messages/${encodeURIComponent(id)}?format=metadata&${qs}`);
    },
  };
}

/** Log-and-rethrow helper for boot-time health probes. */
export async function safeProbe(label, fn) {
  try {
    return await fn();
  } catch (err) {
    logger.warn({ err: err?.message }, `[workspace] ${label} failed`);
    throw err;
  }
}
