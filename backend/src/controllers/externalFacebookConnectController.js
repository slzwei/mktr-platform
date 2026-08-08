import {
  startConnect, getConnectionStatus, selectPage, disconnect,
} from '../services/metaConnectService.js';
import { logger } from '../utils/logger.js';

export { requireExternalHmac } from './externalBillingController.js';

/**
 * mktr-leads broker → Connect-Facebook actions
 * (docs/plans/facebook-connect-self-serve.md §2.1/§2.4).
 *
 * HMAC-gated (shared requireExternalHmac). The EF injects agentMktrUserId
 * after its own JWT + live-row gate — the app body NEVER controls it.
 * Error contract: `agent_sync_pending` is 503 (mirror lag — retryable),
 * never conflated with the EF-side 403 `not_linked`.
 */

function fail(res, err, op) {
  if (err?.code) {
    const status = err.statusCode || err.status || 500;
    return res.status(status).json({ success: false, error: err.code });
  }
  logger.error(`[external-fb-connect] ${op} failed`, { error: err?.message || String(err) });
  return res.status(500).json({ success: false, error: 'Internal server error' });
}

export async function facebookConnect(req, res) {
  const { action, agentMktrUserId, pageId } = req.body || {};
  if (!agentMktrUserId || typeof agentMktrUserId !== 'string') {
    return res.status(400).json({ success: false, error: 'agentMktrUserId is required' });
  }
  try {
    switch (action) {
      case 'start': {
        const r = await startConnect({ agentMktrUserId });
        return res.json({ success: true, startUrl: r.startUrl });
      }
      case 'status': {
        const r = await getConnectionStatus({ agentMktrUserId });
        return res.json({ success: true, connection: r });
      }
      case 'select_page': {
        if (!pageId) return res.status(400).json({ success: false, error: 'pageId is required' });
        await selectPage({ agentMktrUserId, pageId: String(pageId) });
        return res.json({ success: true });
      }
      case 'disconnect': {
        await disconnect({ agentMktrUserId });
        return res.json({ success: true });
      }
      default:
        return res.status(400).json({ success: false, error: 'unknown action' });
    }
  } catch (err) {
    return fail(res, err, action || 'unknown');
  }
}
