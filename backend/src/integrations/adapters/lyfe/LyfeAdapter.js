/**
 * @file LyfeAdapter — implements PlatformAdapter for the Lyfe Supabase project.
 *
 * Thin wrapper around lyfeClient.js. The split exists so the wire layer
 * (REST + breaker + cache) stays testable independently of the adapter
 * contract.
 *
 * @see ../../PlatformAdapter.js for the interface.
 */

import * as lyfeClient from './lyfeClient.js';

/** @type {import('../../PlatformAdapter.js').PlatformAdapter} */
export const LyfeAdapter = {
  id: 'lyfe',

  /**
   * Phase 1: MKTR's local `users` table stores the Lyfe upstream id in the
   * `lyfeId` column. Phase 3 will replace this with a generic
   * (platform_id, external_id) pair on a new `external_agents` table; at
   * that point this field becomes irrelevant.
   */
  localIdField: 'lyfeId',

  async listAgents(filters) {
    return lyfeClient.fetchAgents(filters);
  },

  async getAgent(externalId) {
    return lyfeClient.fetchAgentById(externalId);
  },

  invalidateCache() {
    lyfeClient.invalidateCache();
  },

  /**
   * Outbound webhook URL for receive-mktr-lead edge function. Read from env
   * each call so tests can override without re-importing.
   */
  outboundWebhookUrl() {
    return process.env.LYFE_WEBHOOK_URL || null;
  },

  /**
   * HMAC-SHA256 secret for signing the outbound webhook body. Returns null
   * if not configured; bootstrap caller treats null as "subscriber not
   * configured, skip silently".
   */
  outboundWebhookSecret() {
    return process.env.LYFE_WEBHOOK_SECRET || null;
  },

  /**
   * Lyfe doesn't expose a push API today (no Supabase Realtime channel for
   * cross-project consumers). Adapters without push omit this method;
   * orchestrator falls back to its periodic sync.
   */
  // subscribeToChanges: undefined,
};
