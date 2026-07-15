/**
 * @file externalWalletController — the MKTR Leads agent app's wallet surface.
 *
 * ── Endpoints (mounted at /api/external/wallet, gated by AGENT_WALLET_ENABLED) ──
 *   POST /summary  → { balanceCents, openCommitments }
 *   POST /ledger   → paginated wallet_ledger entries
 *   POST /catalog  → commit-able campaigns (active + priced; whitelisted fields)
 *   POST /commit   → { campaignId, quantity } → debit wallet + create commitment
 *
 * No cancel endpoint exists BY DESIGN (product decision: no self-cancel; the only
 * refund is the automatic campaign-takedown refund). Top-ups live on
 * /api/external/billing (kind:'wallet_topup') because they ride HitPay settlement.
 *
 * Auth: the same HMAC-SHA256-over-rawBody scheme as the other /api/external/
 * surfaces (EXTERNAL_APP_SECRET, signed body timestamp ±5 min) — reused from
 * externalBillingController.requireExternalHmac. The mktr-leads broker self-scopes
 * agentMktrUserId, so every action resolves the caller via mktrLeadsId.
 */
import { User } from '../models/index.js';
import { getSummary, getLedger, getCatalog, commit } from '../services/walletService.js';
import { logger } from '../utils/logger.js';

export { requireExternalHmac } from './externalBillingController.js';

/** Same self-scope guard as billingService.resolveAgent: mktrLeadsId + live agent. */
async function resolveAgent(agentMktrUserId) {
  if (!agentMktrUserId || typeof agentMktrUserId !== 'string') return null;
  return User.findOne({
    where: { mktrLeadsId: agentMktrUserId, role: 'agent', isActive: true },
    attributes: ['id'],
  });
}

function sendError(res, err, op) {
  // AppError carries a deliberate statusCode (404/409/400); anything else is a 500.
  const code = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
  if (code >= 500) {
    logger.error(`[external-wallet] ${op} failed`, { error: err?.message || String(err) });
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
  return res.status(code).json({ success: false, error: err.message });
}

export async function summary(req, res) {
  const { agentMktrUserId } = req.body || {};
  if (!agentMktrUserId) return res.status(400).json({ success: false, error: 'agentMktrUserId is required' });
  try {
    const agent = await resolveAgent(agentMktrUserId);
    if (!agent) return res.status(400).json({ success: false, error: 'invalid_agent' });
    const data = await getSummary(agent.id);
    return res.json({ success: true, ...data });
  } catch (err) {
    return sendError(res, err, 'summary');
  }
}

export async function ledger(req, res) {
  const { agentMktrUserId, page, limit } = req.body || {};
  if (!agentMktrUserId) return res.status(400).json({ success: false, error: 'agentMktrUserId is required' });
  try {
    const agent = await resolveAgent(agentMktrUserId);
    if (!agent) return res.status(400).json({ success: false, error: 'invalid_agent' });
    const data = await getLedger(agent.id, { page, limit });
    return res.json({ success: true, ...data });
  } catch (err) {
    return sendError(res, err, 'ledger');
  }
}

export async function catalog(req, res) {
  const { agentMktrUserId } = req.body || {};
  if (!agentMktrUserId) return res.status(400).json({ success: false, error: 'agentMktrUserId is required' });
  try {
    const agent = await resolveAgent(agentMktrUserId);
    if (!agent) return res.status(400).json({ success: false, error: 'invalid_agent' });
    const campaigns = await getCatalog();
    return res.json({ success: true, campaigns });
  } catch (err) {
    return sendError(res, err, 'catalog');
  }
}

export async function commitHandler(req, res) {
  const { agentMktrUserId, campaignId, quantity } = req.body || {};
  if (!agentMktrUserId || !campaignId) {
    return res.status(400).json({ success: false, error: 'agentMktrUserId and campaignId are required' });
  }
  try {
    const agent = await resolveAgent(agentMktrUserId);
    if (!agent) return res.status(400).json({ success: false, error: 'invalid_agent' });
    const result = await commit(agent.id, campaignId, quantity);
    return res.status(201).json({ success: true, ...result });
  } catch (err) {
    return sendError(res, err, 'commit');
  }
}
