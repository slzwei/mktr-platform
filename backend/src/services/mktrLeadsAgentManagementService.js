/**
 * @file mktrLeadsAgentManagementService — admin management of mktr-leads agents
 * FROM the mktr-platform dashboard, with mktr-leads as the source of truth.
 *
 * Every action writes to mktr-leads FIRST (via mktrLeadsClient), then refreshes
 * the local mirror by re-running the mktr-leads sync under the BLOCKING
 * advisory-lock variant — serializing behind any in-flight cron sync so the
 * response reflects the write (a try-lock skip would leave the dashboard stale
 * for up to 10 minutes). The sync owns all matching/one-source-per-user rules,
 * so there is no bespoke local upsert here.
 *
 * Invite is the exception twice over: it calls mktr-leads' own
 * create-ext-agent-invite edge function (the single owner of invitation
 * semantics — canonical phone normalization, agent-exists guard, re-invite
 * dedup), and it does NOT refresh locally — no agents row exists until the
 * invitee's first OTP sign-up creates one (the cron mirrors it within ~10 min).
 */

import * as defaultClient from '../integrations/adapters/mktr-leads/mktrLeadsClient.js';
import { syncAgentsFromMktrLeads as defaultSync } from './agentSyncService.js';
import DefaultUser from '../models/User.js';
import { AppError } from '../middleware/errorHandler.js';
import { logger as defaultLogger } from '../utils/logger.js';

const MKTR_USER_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

export function makeMktrLeadsAgentManagementService(overrides = {}) {
  const d = {
    client: defaultClient,
    syncAgentsFromMktrLeads: defaultSync,
    User: DefaultUser,
    logger: defaultLogger,
    ...overrides,
  };

  function ensureConfigured() {
    if (!process.env.MKTR_LEADS_SUPABASE_URL || !process.env.MKTR_LEADS_SUPABASE_SERVICE_ROLE_KEY) {
      throw new AppError(
        'mktr-leads management is not configured (set MKTR_LEADS_SUPABASE_URL and MKTR_LEADS_SUPABASE_SERVICE_ROLE_KEY)',
        503
      );
    }
  }

  function assertMktrUserId(mktrUserId) {
    if (typeof mktrUserId !== 'string' || !MKTR_USER_ID_RE.test(mktrUserId)) {
      throw new AppError('Invalid mktr-leads agent id', 400);
    }
  }

  /**
   * The upstream write SUCCEEDED when this runs — so a refresh failure (e.g.
   * the 15s lock_timeout while a cron sync holds the lock, SQLSTATE 55P03)
   * must not read as a failed action. Surface 503 with the honest state: the
   * change is saved in mktr-leads and the cron will mirror it within ~10 min.
   */
  async function refreshAndLoad(mktrUserId) {
    try {
      await d.syncAgentsFromMktrLeads({ wait: true });
    } catch (err) {
      d.logger.warn(
        { event: 'mktr_leads_mgmt_refresh_failed', mktrUserId, error: err?.message },
        '[MktrLeadsMgmt] post-write sync refresh failed — cron will reconcile'
      );
      throw new AppError(
        'Saved in mktr-leads, but the local refresh timed out — the change will appear here within ~10 minutes',
        503
      );
    }
    return d.User.findOne({ where: { mktrLeadsId: mktrUserId } });
  }

  /**
   * Create a pending mktr-leads invitation. Status mapping is the contract with
   * the EF (see its 409 enrichment): agent_exists + is_active drives the
   * "reactivate instead" hint for deactivated agents.
   */
  async function inviteAgent({ phone, fullName, email, agency }, adminUser) {
    ensureConfigured();
    // The invite path additionally needs the dedicated EF secret (the EF's
    // MKTR_PLATFORM_INVITE_SECRET) — activate/edit go via PostgREST and don't.
    if (!process.env.MKTR_LEADS_INVITE_SECRET) {
      throw new AppError(
        'mktr-leads invites are not configured (set MKTR_LEADS_INVITE_SECRET to the value of the create-ext-agent-invite function secret MKTR_PLATFORM_INVITE_SECRET)',
        503
      );
    }
    const { status, body } = await d.client.createInvitation({ phone, fullName, email, agency });

    if (status === 200) {
      d.logger.info(
        {
          event: 'mktr_leads_agent_invited',
          adminId: adminUser?.id || null,
          invitationId: body.invitation_id || null,
          emailSent: body.email_sent === true,
        },
        '[MktrLeadsMgmt] invitation created'
      );
      return { invitationId: body.invitation_id || null, emailSent: body.email_sent === true };
    }

    if (status === 409) {
      if (body.agent_exists) {
        throw new AppError(
          body.is_active
            ? 'This phone already belongs to an active mktr-leads agent'
            : 'This phone belongs to a deactivated mktr-leads agent — reactivate them instead of re-inviting',
          409
        );
      }
      throw new AppError(body.error || 'An invitation for this phone is already pending', 409);
    }
    if (status === 400) {
      throw new AppError(body.error || 'mktr-leads rejected the phone number', 400);
    }
    if (status === 401 || status === 403) {
      // Old EF still deployed (no service-auth branch) or key mismatch.
      throw new AppError(
        'mktr-leads rejected the service credentials — is the updated create-ext-agent-invite deployed?',
        502
      );
    }
    throw new AppError('mktr-leads invite failed', 502);
  }

  /** Flip is_active in mktr-leads, then mirror locally. false = app lockout (OTP gate). */
  async function setAgentActive(mktrUserId, isActive, adminUser) {
    ensureConfigured();
    assertMktrUserId(mktrUserId);

    const row = await d.client.setAgentActive(mktrUserId, isActive === true);
    if (!row) {
      // Unknown id — or an admin row, which the client's role=eq.agent filter
      // refuses to touch by construction.
      throw new AppError('mktr-leads agent not found (admins cannot be managed from here)', 404);
    }

    d.logger.info(
      {
        event: 'mktr_leads_agent_managed',
        action: isActive ? 'activate' : 'deactivate',
        mktrUserId,
        adminId: adminUser?.id || null,
      },
      `[MktrLeadsMgmt] agent ${isActive ? 'activated' : 'deactivated'}`
    );

    return refreshAndLoad(mktrUserId);
  }

  /** Update profile fields (full_name/email/agency) in mktr-leads, then mirror locally. */
  async function updateAgentFields(mktrUserId, fields, adminUser) {
    ensureConfigured();
    assertMktrUserId(mktrUserId);

    const row = await d.client.updateAgentFields(mktrUserId, fields);
    if (!row) {
      throw new AppError('mktr-leads agent not found (admins cannot be managed from here)', 404);
    }

    d.logger.info(
      {
        event: 'mktr_leads_agent_managed',
        action: 'update',
        mktrUserId,
        fields: Object.keys(fields),
        adminId: adminUser?.id || null,
      },
      '[MktrLeadsMgmt] agent profile updated'
    );

    return refreshAndLoad(mktrUserId);
  }

  return { inviteAgent, setAgentActive, updateAgentFields };
}

// --- Backward-compatible named exports (house pattern) ---
const _default = makeMktrLeadsAgentManagementService();
export const inviteAgent = _default.inviteAgent;
export const setAgentActive = _default.setAgentActive;
export const updateAgentFields = _default.updateAgentFields;
