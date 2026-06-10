/**
 * @file MktrLeadsAdapter — implements PlatformAdapter for the mktr-leads
 * Supabase project (a second agent source alongside Lyfe).
 *
 * Thin wrapper around mktrLeadsClient.js — same split as the Lyfe adapter so
 * the wire layer (REST + breaker + cache) stays testable independently of the
 * adapter contract.
 *
 * @see ../../PlatformAdapter.js for the interface.
 */

import * as mktrLeadsClient from './mktrLeadsClient.js';

/** @type {import('../../PlatformAdapter.js').PlatformAdapter} */
export const MktrLeadsAdapter = {
  id: 'mktr_leads',

  /**
   * MKTR's local `users` table stores the mktr-leads upstream id (the
   * `agents.mktr_user_id` text key) in the `mktrLeadsId` column. A DB CHECK
   * keeps it mutually exclusive with `lyfeId` — one external source per user.
   */
  localIdField: 'mktrLeadsId',

  /**
   * listAgents returns ACTIVE AND INACTIVE rows; runSync mirrors each row's
   * is_active locally instead of treating "not in the fetched set" as gone.
   * Without this, deactivating an agent in mktr-leads would look like deletion
   * → two-phase hard-delete → CASCADE wipes their lead-package assignments.
   */
  mirrorsIsActive: true,

  /**
   * mktr-leads is the source of truth for agent profile fields: runSync
   * OVERWRITES fullName/email/companyName(agency) on its rows (vs the Lyfe
   * fill-only-when-null behaviour), so edits made in mktr-leads — including via
   * the admin write-back endpoints — propagate and self-heal.
   */
  authoritativeProfile: true,

  async listAgents(filters) {
    return mktrLeadsClient.fetchAgents(filters);
  },

  async getAgent(externalId) {
    return mktrLeadsClient.fetchAgentById(externalId);
  },

  invalidateCache() {
    mktrLeadsClient.invalidateCache();
  },

  /**
   * Outbound webhook URL for the mktr-leads receive-mktr-lead edge function.
   * Read from env each call so tests can override without re-importing.
   */
  outboundWebhookUrl() {
    return process.env.MKTR_LEADS_WEBHOOK_URL || null;
  },

  /**
   * HMAC-SHA256 secret for signing the outbound webhook body. Returns null if
   * not configured; bootstrap treats null as "subscriber not configured, skip".
   */
  outboundWebhookSecret() {
    return process.env.MKTR_LEADS_WEBHOOK_SECRET || null;
  },
};
