/**
 * Lead-quota decision layer.
 *
 * Given a resolved route (from resolveLeadRouting) and the campaign, decide whether a
 * lead is DELIVERED to an agent or QUARANTINED (held) — and, for hard-quota campaigns,
 * charge the agent a lead credit AUTHORITATIVELY before delivery.
 *
 * Decision (a), Codex-refined: only authenticated self / admin-explicit routes are
 * exempt. Every automated route — qr (owner / group / phone), the lead-package pool,
 * and the System-Agent fallback — is gated when the campaign enforces quota.
 *
 * This module is pure of any prospect write: it returns a directive the caller applies
 * to its create/update, and it never imports the DB. `charge` (chargeLeadCredit) is
 * injected so it runs inside the caller's transaction and is trivially testable.
 */

const EXEMPT_ROUTES = new Set(['self', 'admin']);

/**
 * @param {object}   args
 * @param {object}   args.campaign     - campaign row; reads `enforceLeadQuota`
 * @param {{agentId:string|null, via:string}} args.routing - resolveLeadRouting() result
 * @param {string}   args.campaignId   - campaign the credit must be charged against
 * @param {import('sequelize').Transaction|null} [args.transaction]
 * @param {(agentId:string, campaignId:string, tx:any)=>Promise<boolean>} args.charge
 *        - authoritative campaign-scoped charge (chargeLeadCredit)
 * @returns {Promise<{
 *   action: 'assign'|'quarantine',
 *   assignedAgentId?: string|null,
 *   quarantineReason?: string,
 *   charged: boolean,   // true ⇒ a credit was already charged; caller MUST NOT also best-effort deduct
 *   via: string
 * }>}
 */
export async function decideAssignment({ campaign, routing, campaignId, transaction = null, charge }) {
  const via = routing?.via ?? 'fallback';
  const agentId = routing?.agentId ?? null;
  // Priced campaigns (agent-wallet commitments, leadPriceCents set) are ALWAYS
  // quota-enforced: their leads are pre-sold, so a failed charge must hold the
  // lead, never deliver it free — independent of the admin's enforceLeadQuota
  // toggle (which stays the knob for unpriced/package campaigns). Exempt human
  // routes (self/admin) keep their deliberate-override semantics.
  const priced = Number.isInteger(campaign?.leadPriceCents) && campaign.leadPriceCents > 0;
  const quota = campaign?.enforceLeadQuota === true || priced;
  const exempt = EXEMPT_ROUTES.has(via);

  // Soft campaigns, or exempt human/explicit routes: deliver exactly as today. The
  // caller still does its best-effort deduct (charged:false signals that).
  if (!quota || exempt) {
    return { action: 'assign', assignedAgentId: agentId, charged: false, via };
  }

  // Gated route under quota with no real funded agent (the fallback fired, or no
  // agent at all) ⇒ hold the lead. Never hand a paid/metered lead out for free.
  if (!agentId || via === 'fallback') {
    return { action: 'quarantine', quarantineReason: 'no_funded_agent', via };
  }

  // Gated route with a candidate agent: the authoritative charge is the gate.
  const charged = await charge(agentId, campaignId, transaction);
  if (!charged) {
    return { action: 'quarantine', quarantineReason: 'no_funded_agent', via };
  }
  return { action: 'assign', assignedAgentId: agentId, charged: true, via };
}
