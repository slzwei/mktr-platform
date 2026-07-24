import { Activation, Campaign } from '../../models/index.js';
import { getStoredLuckyDraw } from '../../utils/designConfigV2Clamp.js';
import { normalizeLuckyDraw } from '../../utils/luckyDraw.js';
import { sgtDayEndExclusiveMs } from '../../utils/sgtTime.js';

/**
 * drawLink — the ONE way every fulfilment surface answers "is this
 * entitlement/activation a lucky-draw boost rail, and what are its facts?"
 * (PR-4, draw-launch-integrity §5.2; Codex R1 CX22's root demand).
 *
 * Draw-linkage is derived from the ACTIVATION'S CAMPAIGN having an enabled
 * luckyDraw — never from offer naming or internalRef markers (the Phase-0
 * SQL-provisioned rails carry no marker). Consumers branch on it:
 *  - unlock: append boost evidence WITHOUT minting a redeemable voucher
 *  - issuance: clamp the pass expiry to the boost window
 *  - delivery: draw-voiced template/card/claim-page instead of trial voice
 *  - redemption: refuse partner verify/complete outright
 *
 * `boostCutoffMs` is the EXCLUSIVE window boundary (SGT day-end of
 * boostClosesAt, falling back to closesAt — the same rule the draw engine
 * and terms template use), so `now >= boostCutoffMs` ⇒ window closed.
 */

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** '2026-09-30' → '30 September 2026' (WA/email/card display). */
export function boostDeadlineLong(ymd) {
  const m = typeof ymd === 'string' ? ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/) : null;
  if (!m) return '';
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${Number(m[3])} ${month} ${m[1]}` : '';
}

export function makeDrawLink(overrides = {}) {
  // Drop undefined override VALUES: a caller forwarding a dep it doesn't have
  // (`{ Campaign: d.Campaign }` with no Campaign in its deps) must fall back
  // to the real model, not clobber it — that exact shape took down every
  // production unlock on 2026-07-25. Deliberate absence in a hermetic test
  // should use a throwing stub or null, never undefined.
  const definedOverrides = Object.fromEntries(
    Object.entries(overrides ?? {}).filter(([, value]) => value !== undefined)
  );
  const d = { Activation, Campaign, ...definedOverrides };

  /** @returns {Promise<null | {campaignId, drawName, multiplier, boostClosesAt, boostCutoffMs}>} */
  async function drawContextForActivation(activationOrId) {
    const activation = typeof activationOrId === 'object' && activationOrId !== null
      ? activationOrId
      : await d.Activation.findByPk(activationOrId, { attributes: ['id', 'campaignId'] });
    if (!activation?.campaignId) return null;
    const campaign = await d.Campaign.findByPk(activation.campaignId, {
      attributes: ['id', 'name', 'design_config'],
    });
    if (!campaign) return null;
    return drawContextForCampaign(campaign);
  }

  /** Same context from an already-loaded campaign row (issuance path). */
  function drawContextForCampaign(campaign) {
    const ld = normalizeLuckyDraw(getStoredLuckyDraw(campaign?.design_config));
    if (ld?.enabled !== true) return null;
    const anchor = ld.boostClosesAt || ld.closesAt || null;
    const boostCutoffMs = anchor ? sgtDayEndExclusiveMs(anchor) : null;
    return {
      campaignId: campaign.id,
      drawName: campaign.name || 'the lucky draw',
      multiplier: Number.isInteger(ld.multiplier) ? ld.multiplier : 10,
      boostClosesAt: anchor,
      boostCutoffMs,
    };
  }

  async function drawContextForEntitlement(entitlement) {
    if (!entitlement?.activationId) return null;
    return drawContextForActivation(entitlement.activationId);
  }

  return { drawContextForActivation, drawContextForCampaign, drawContextForEntitlement };
}

const _default = makeDrawLink();
export const drawContextForActivation = (...a) => _default.drawContextForActivation(...a);
export const drawContextForCampaign = (...a) => _default.drawContextForCampaign(...a);
export const drawContextForEntitlement = (...a) => _default.drawContextForEntitlement(...a);
export default _default;
