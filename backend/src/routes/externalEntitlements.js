import express from 'express';
import { Op } from 'sequelize';
import { asyncHandler } from '../middleware/errorHandler.js';
import { requireExternalHmac } from '../controllers/externalBillingController.js';
import {
  User, RewardEntitlement, RewardOffer, Prospect, Activation, Campaign, Redemption,
} from '../models/index.js';
import { hashToken } from '../services/redeemOps/tokens.js';
import { canEmailProspect } from '../services/redeemOps/fulfilmentNotify.js';
import { canWhatsAppProspect, waEnabled } from '../services/redeemOps/whatsappService.js';
import { makeWiredEntitlementService } from '../services/redeemOps/entitlementWiring.js';

/**
 * mktr-leads consultant surface for reward entitlements
 * (docs/redeem-ops/MKTR_INTEGRATION.md §2). Same posture as the other
 * /api/external/* surfaces: HMAC over the raw body with EXTERNAL_APP_SECRET +
 * signed in-body timestamp (requireExternalHmac); POST-only so the body can
 * carry that timestamp. Callers are the Supabase brokers, never the device.
 *
 *   POST /unlock  { timestamp, agentMktrUserId, presentationToken? | prospectId? }
 *     unlockedVia is server-derived: presentationToken ⇒ agent_scan,
 *     prospectId ⇒ agent_button (a client-sent `via` is ignored). The resolved
 *     mirror user must be the lead's assigned consultant — enforced in the
 *     service BEFORE replay/pause responses. The six legacy response fields are
 *     frozen (ops + Lyfe consumers); everything after them is additive
 *     enrichment for the app's success screen.
 *   POST /lookup  { timestamp, agentMktrUserId, token }
 *     Scan preview for the confirm sheet. Resolves EITHER token hash (the pass
 *     or the minted voucher — `kind` says which, so the app can name a voucher
 *     mis-scan). Assignment is checked before ANY payload: a wrong consultant
 *     gets a bare 403 with zero holder identity.
 *   POST /summary { timestamp, agentMktrUserId, prospectId }
 *     Lead-detail CLIENT GIFT card. Entitlement selection matches the manual
 *     unlock path (latest live first, then latest terminal); `state:'none'`
 *     when the prospect holds no entitlement at all.
 *
 * Error bodies here are route-local `{ success:false, error, code }` — never
 * routed through the global AppError handler (different shape, no code field).
 */
export const meta = {
  path: '/api/external/entitlements',
  flag: 'REDEEM_OPS_ENTITLEMENTS_ENABLED',
  flagDefault: 'false',
};

const router = express.Router();

/** Minted tokens are 32-byte base64url (43 chars); rewardClaim accepts 16..128. */
const TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// prospect MUST carry email + sourceMetadata — canEmailProspect/canWhatsAppProspect
// read them; dropping either silently kills the channels computation.
const ENTITLEMENT_INCLUDE = [
  { model: RewardOffer, as: 'rewardOffer', attributes: ['id', 'title', 'publicTitle', 'fulfilmentMethod'] },
  {
    model: Prospect,
    as: 'prospect',
    attributes: ['id', 'firstName', 'phone', 'email', 'sourceMetadata', 'assignedAgentId'],
  },
  {
    model: Activation,
    as: 'activation',
    attributes: ['id', 'status', 'campaignNameSnapshot'],
    include: [{ model: Campaign, as: 'campaign', attributes: ['name'] }],
  },
];

async function resolveAgent(agentMktrUserId) {
  return User.findOne({ where: { mktrLeadsId: String(agentMktrUserId), isActive: true } });
}

/** Admin override mirrors the unlock service; prospect may be null (lead deleted). */
function isAssigned(entitlement, agentUser) {
  if (agentUser.role === 'admin') return true;
  const prospect = entitlement.prospect;
  return Boolean(prospect && prospect.assignedAgentId === agentUser.id);
}

/**
 * Presentation state. `<=` (not `<`) so presentation can never say "valid" for
 * an instant the unlock transaction's `expiresAt > now` predicate would reject.
 * The status column itself can hold 'expired' (sweep) — passed through.
 */
function presentState(entitlement) {
  const expired = entitlement.expiresAt && new Date(entitlement.expiresAt) <= new Date();
  if (entitlement.status === 'eligible') return expired ? 'expired' : 'reserved';
  if (entitlement.status === 'issued') return expired ? 'expired' : 'unlocked';
  return entitlement.status; // redeemed | expired | cancelled | blocked
}

/**
 * Display mask, computed server-side so the app never sees more than last-4.
 * The +65 prefix is shown only when it is actually the number's country code —
 * prospect phones are general E.164.
 */
function maskProspectPhone(phone) {
  const raw = String(phone || '');
  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;
  const last4 = digits.slice(-4);
  return raw.startsWith('+65') ? `+65 ···· ${last4}` : `···· ${last4}`;
}

/** Deliverability CAPABILITY (never delivery confirmation). WA needs the feature flag too. */
function channelsFor(prospect) {
  const channels = [];
  if (waEnabled() && canWhatsAppProspect(prospect)) channels.push('whatsapp');
  if (canEmailProspect(prospect)) channels.push('email');
  return channels;
}

/** Shared projection for lookup/summary (+ reused by unlock enrichment). */
function giftPayload(entitlement) {
  const offer = entitlement.rewardOffer;
  const activation = entitlement.activation;
  const prospect = entitlement.prospect;
  const state = presentState(entitlement);
  return {
    state,
    rewardName: offer?.publicTitle || offer?.title || 'Reward',
    fulfilmentMethod: offer?.fulfilmentMethod || null,
    holderFirstName: prospect?.firstName || null,
    holderPhoneMasked: maskProspectPhone(prospect?.phone),
    campaignName: activation?.campaign?.name ?? activation?.campaignNameSnapshot ?? null,
    paused: activation?.status === 'paused',
    channels: channelsFor(prospect),
    expiresAt: entitlement.expiresAt,
    unlockedAt: entitlement.unlockedAt,
    // Token hint only once the voucher exists AND the state still warrants it.
    ...(state === 'unlocked' || state === 'redeemed' ? { tokenHint: entitlement.tokenHint } : {}),
  };
}

/** Route-local error codes (AppError has no code facility; messages are this repo's). */
function unlockErrorCode(status, message) {
  if (status === 403) return 'not_assigned';
  if (status === 404) return 'not_found';
  if (status === 409) {
    const m = String(message || '');
    if (/paused/i.test(m)) return 'paused';
    if (/is expired/i.test(m)) return 'expired';
    if (/is blocked/i.test(m)) return 'blocked';
    if (/is cancelled/i.test(m) || /no longer be unlocked/i.test(m)) return 'cancelled';
    return 'conflict'; // transactional race: expiry/pause hit at commit time
  }
  return 'error';
}

router.post('/lookup', requireExternalHmac, asyncHandler(async (req, res) => {
  const { agentMktrUserId, token } = req.body || {};
  if (!agentMktrUserId || typeof token !== 'string') {
    return res.status(400).json({ success: false, error: 'agentMktrUserId and token are required' });
  }
  const raw = token.trim();
  if (!TOKEN_RE.test(raw)) {
    return res.status(400).json({ success: false, error: 'Invalid token', code: 'invalid_token' });
  }
  const agent = await resolveAgent(agentMktrUserId);
  if (!agent) {
    return res.status(404).json({ success: false, error: 'Unknown agent', code: 'agent_not_found' });
  }

  const hash = hashToken(raw);
  const entitlement = await RewardEntitlement.findOne({
    where: { [Op.or]: [{ presentationTokenHash: hash }, { tokenHash: hash }] },
    include: ENTITLEMENT_INCLUDE,
  });
  if (!entitlement) {
    return res.status(404).json({ success: false, error: 'Not found', code: 'not_found' });
  }
  // Bare 403 BEFORE any payload is assembled — a wrong consultant's scan must
  // leak no reward, holder, state, or pause signal.
  if (!isAssigned(entitlement, agent)) {
    return res.status(403).json({
      success: false, error: 'Only the assigned consultant can view this pass', code: 'not_assigned',
    });
  }

  return res.json({
    success: true,
    kind: entitlement.presentationTokenHash === hash ? 'pass' : 'voucher',
    prospectId: entitlement.prospectId,
    ...giftPayload(entitlement),
  });
}));

router.post('/summary', requireExternalHmac, asyncHandler(async (req, res) => {
  const { agentMktrUserId, prospectId } = req.body || {};
  if (!agentMktrUserId || typeof prospectId !== 'string' || !UUID_RE.test(prospectId)) {
    return res.status(400).json({ success: false, error: 'agentMktrUserId and prospectId (uuid) are required' });
  }
  const agent = await resolveAgent(agentMktrUserId);
  if (!agent) {
    return res.status(404).json({ success: false, error: 'Unknown agent', code: 'agent_not_found' });
  }

  // Selection matches the manual-unlock target: the latest LIVE entitlement
  // wins; only when none exists does the latest terminal row surface (so the
  // card can show redeemed/expired/cancelled history instead of vanishing).
  let entitlement = await RewardEntitlement.findOne({
    where: { prospectId, status: { [Op.in]: ['eligible', 'issued'] } },
    order: [['createdAt', 'DESC']],
    include: ENTITLEMENT_INCLUDE,
  });
  if (!entitlement) {
    entitlement = await RewardEntitlement.findOne({
      where: { prospectId },
      order: [['createdAt', 'DESC']],
      include: ENTITLEMENT_INCLUDE,
    });
  }
  if (!entitlement) return res.json({ success: true, state: 'none' });
  if (!isAssigned(entitlement, agent)) {
    return res.status(403).json({
      success: false, error: 'Only the assigned consultant can view this reward', code: 'not_assigned',
    });
  }

  // No reverse assoc from entitlement → redemption; the real redeemedAt lives
  // on the (unique-per-entitlement) redemptions row.
  let redeemedAt = null;
  if (entitlement.status === 'redeemed') {
    const redemption = await Redemption.findOne({ where: { entitlementId: entitlement.id } });
    redeemedAt = redemption?.redeemedAt ?? null;
  }

  return res.json({ success: true, ...giftPayload(entitlement), redeemedAt });
}));

router.post('/unlock', requireExternalHmac, asyncHandler(async (req, res) => {
  const { agentMktrUserId, presentationToken, prospectId } = req.body || {};
  if (!agentMktrUserId || (!presentationToken && !prospectId)) {
    return res.status(400).json({ success: false, error: 'agentMktrUserId and presentationToken or prospectId are required' });
  }

  const agent = await resolveAgent(agentMktrUserId);
  if (!agent) {
    return res.status(404).json({ success: false, error: 'Unknown agent', code: 'agent_not_found' });
  }

  try {
    // `via` is SERVER-derived from the identifier, never trusted from the body:
    // only a presentation token (the customer's QR pass, presented live) counts
    // as scan evidence; a bare prospectId is always the button path. Draw
    // weighting treats the two differently (docs/plans/lucky-draw-10x.md §4.4).
    const result = await makeWiredEntitlementService().unlockEntitlement(
      presentationToken ? { presentationToken } : { prospectId },
      agent,
      presentationToken ? 'agent_scan' : 'agent_button'
    );

    // Enrichment re-read. The service's return shape is deliberately untouched
    // (ops console + Lyfe route consume it); the richer payload is safe on both
    // fresh and replay paths because the service now authorizes BEFORE replying.
    const full = await RewardEntitlement.findByPk(result.entitlement.id, { include: ENTITLEMENT_INCLUDE });
    const p = full ? giftPayload(full) : null;

    return res.json({
      success: true,
      already: result.already,
      // Whether a voucher email was scheduled by THIS unlock — false on
      // replay and for no-email leads (client should tell the consultant).
      emailQueued: result.emailQueued === true,
      entitlementId: result.entitlement.id,
      status: result.entitlement.status,
      tokenHint: result.entitlement.tokenHint,
      // ── additive enrichment (mktr-leads app success screen) ──
      ...(p
        ? {
            rewardName: p.rewardName,
            holderFirstName: p.holderFirstName,
            holderPhoneMasked: p.holderPhoneMasked,
            campaignName: p.campaignName,
            channels: p.channels,
            expiresAt: p.expiresAt,
            unlockedAt: p.unlockedAt,
            prospectId: full.prospectId,
            unlockedByYou: full.unlockedByUserId === agent.id,
            // "Scheduled", never "sent" — WA delivery is fire-and-forget.
            waScheduled: result.already !== true && waEnabled() && canWhatsAppProspect(full.prospect),
          }
        : {}),
    });
  } catch (err) {
    const code = err.statusCode || 500;
    if (code >= 500) throw err;
    return res.status(code).json({ success: false, error: err.message, code: unlockErrorCode(code, err.message) });
  }
}));

export default router;
