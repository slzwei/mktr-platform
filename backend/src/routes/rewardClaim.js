import express from 'express';
import rateLimit from 'express-rate-limit';
import { Op } from 'sequelize';
import QRCode from 'qrcode';
import { asyncHandler } from '../middleware/errorHandler.js';
import {
  RewardEntitlement, RewardOffer, PartnerOrganisation, PartnerLocation,
  RewardOfferLocation, RedemptionEvent,
} from '../models/index.js';
import { hashToken } from '../services/redeemOps/tokens.js';

/**
 * PUBLIC consumer reward view — backs redeem.sg/r/:token
 * (docs/redeem-ops/ROUTE_MAP.md: deliberately OUTSIDE /api/redeem-ops, which is
 * host-blocked from the consumer site).
 *
 * One stable link, two states: while locked it renders the reservation pass
 * (QR the consultant scans); once unlocked the SAME link renders the voucher
 * (QR the merchant scans). Token-authenticated: the URL token IS the credential;
 * responses carry only reward/partner info + the holder's first name — never
 * full lead PII (docs/redeem-ops/USER_SURFACES… §4).
 */
export const meta = {
  path: '/api/reward-claim',
  flag: 'REDEEM_OPS_ENTITLEMENTS_ENABLED',
  flagDefault: 'false',
};

const claimLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60, // generous for a human, hostile to token scanning
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests — try again later.' },
});

const router = express.Router();

router.get('/:token', claimLimiter, asyncHandler(async (req, res) => {
  const raw = String(req.params.token || '').trim();
  if (raw.length < 16 || raw.length > 128) {
    return res.status(404).json({ success: false, message: 'Not found' });
  }
  const hash = hashToken(raw);

  // The link carries the PRESENTATION token for its whole life; after unlock the
  // same page shows the voucher. A voucher token pasted here also resolves.
  const entitlement = await RewardEntitlement.findOne({
    where: { [Op.or]: [{ presentationTokenHash: hash }, { tokenHash: hash }] },
    include: [
      {
        model: RewardOffer,
        as: 'rewardOffer',
        attributes: ['id', 'title', 'publicTitle', 'description', 'fulfilmentMethod', 'externalBookingUrl', 'currentTermsVersion'],
        include: [{ model: PartnerOrganisation, as: 'partner', attributes: ['tradingName', 'brandName', 'legalName'] }],
      },
      { association: 'prospect', attributes: ['firstName'] },
    ],
  });
  if (!entitlement) {
    return res.status(404).json({ success: false, message: 'Not found' });
  }

  RedemptionEvent.create({
    entitlementId: entitlement.id,
    type: 'claim_viewed',
    actorType: 'consumer',
  }).catch(() => {});

  const offer = entitlement.rewardOffer;
  const partner = offer?.partner;
  const locations = await RewardOfferLocation.findAll({
    where: { rewardOfferId: entitlement.rewardOfferId },
    include: [{ model: PartnerLocation, as: 'location', attributes: ['name', 'addressLine', 'postalCode'] }],
  });

  const expired = entitlement.expiresAt && new Date(entitlement.expiresAt) < new Date();
  const base = {
    firstName: entitlement.prospect?.firstName || null,
    reward: {
      title: offer?.publicTitle || offer?.title,
      description: offer?.description || null,
      partnerName: partner?.tradingName || partner?.brandName || partner?.legalName || null,
      locations: locations.map((l) => ({
        name: l.location?.name, addressLine: l.location?.addressLine, postalCode: l.location?.postalCode,
      })),
    },
    expiresAt: entitlement.expiresAt,
  };

  // Locked reservation → the meeting pass (only when the link used the presentation token)
  if (entitlement.status === 'eligible' && entitlement.presentationTokenHash === hash && !expired) {
    const qrDataUrl = await QRCode.toDataURL(raw, { width: 280, margin: 1 });
    return res.json({
      success: true,
      data: { ...base, state: 'reserved', pass: { qrDataUrl } },
    });
  }

  // Unlocked voucher — the SAME stable link now renders a scannable QR. The QR
  // encodes the bearer's own raw token (voucher or post-unlock presentation);
  // redemptionService accepts either once status='issued' — the STATE MACHINE is
  // the gate, so extra copies of either code change nothing.
  if (entitlement.status === 'issued' && !expired) {
    const qrDataUrl = await QRCode.toDataURL(raw, { width: 280, margin: 1 });
    return res.json({
      success: true,
      data: {
        ...base,
        state: 'unlocked',
        voucher: { tokenHint: entitlement.tokenHint, qrDataUrl },
      },
    });
  }

  const state = expired && ['eligible', 'issued'].includes(entitlement.status) ? 'expired' : entitlement.status;
  return res.json({ success: true, data: { ...base, state } });
}));

export default router;
