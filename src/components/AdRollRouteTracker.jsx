import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import {
  initAdRoll,
  isAdRollCampaignSurface,
  shouldTrackAdRoll,
  trackAdRollPageView,
} from '@/lib/adroll';

/**
 * Fires AdRoll's pageView on the public browse surfaces as the SPA navigates.
 *
 * Renders nothing and mounts once inside the router (see pages/index.jsx). The
 * campaign funnel pages are deliberately skipped here: their gate needs the
 * loaded `campaign` to apply the test-data exclusion, so each of LeadCapture /
 * MarketplaceOffer / MarketplaceFlow fires its own pageView alongside the Meta,
 * TikTok and Google view events.
 *
 * Everything not on adroll.js's allow-list — admin, redeem-ops, auth, and the
 * token-bearing reward/callback links — never reaches initAdRoll at all.
 */
export default function AdRollRouteTracker() {
  const { pathname, search } = useLocation();

  useEffect(() => {
    if (isAdRollCampaignSurface(pathname)) return;
    if (!shouldTrackAdRoll({ pathname, search })) return;
    initAdRoll();
    trackAdRollPageView();
  }, [pathname, search]);

  return null;
}
