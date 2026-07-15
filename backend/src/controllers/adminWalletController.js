/**
 * @file adminWalletController — admin reads of agent wallets + manual adjustment.
 * Thin over walletService; the roster is EXTERNAL agents only in v1
 * (users.mktrLeadsId non-null — internal agents have no wallets yet).
 */
import * as walletService from '../services/walletService.js';

export async function listWallets(req, res) {
  const wallets = await walletService.listWallets();
  res.json({ success: true, data: { wallets } });
}

export async function getAgentLedger(req, res) {
  const { agentId } = req.params;
  const { page, limit } = req.query;
  const data = await walletService.getLedger(agentId, { page, limit });
  res.json({ success: true, data });
}

export async function adjust(req, res) {
  const { agentId } = req.params;
  const { amountCents, note, requestId } = req.body || {};
  const result = await walletService.adminAdjust(agentId, amountCents, note, req.user?.id ?? null, {
    requestId: typeof requestId === 'string' && requestId.trim() ? requestId.trim() : undefined,
  });
  res.status(result.replayed ? 200 : 201).json({ success: true, data: result });
}
