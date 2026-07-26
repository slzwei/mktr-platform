import express from 'express';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import { resolveConsentCopy } from '../services/consentCopyRegistry.js';

/**
 * Admin click-through from a lead's "Raw consent versions" row to the exact
 * wording that version stamped (docs/plans/admin-lead-profile-page.md).
 * Read-only registry/table lookup; admin-gated like the profile enrichment
 * it accompanies.
 */
export const meta = { path: '/api/consent-copy' };

const router = express.Router();

router.get('/:version', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const out = await resolveConsentCopy(req.params.version);
    if (!out) {
      return res.status(404).json({ success: false, message: 'No stored wording for this version' });
    }
    return res.json({ success: true, data: out });
  } catch (err) {
    return res.status(500).json({ success: false, message: err?.message || 'lookup failed' });
  }
});

export default router;
