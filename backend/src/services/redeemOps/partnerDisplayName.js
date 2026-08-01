/**
 * THE partner display-name rule (P4-1): tradingName → brandName → legalName,
 * then the caller's fallback. Seven call sites carried hand-rolled copies and
 * one (analyticsService) had drifted to trading→legal — a partner with only a
 * brand name rendered null in analytics. Query helpers should select
 * PARTNER_NAME_ATTRS so the chain always has its inputs loaded.
 */
export const PARTNER_NAME_ATTRS = ['tradingName', 'brandName', 'legalName'];

export function partnerDisplayName(partner, fallback = null) {
  return partner?.tradingName || partner?.brandName || partner?.legalName || fallback;
}
