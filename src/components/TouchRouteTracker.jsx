import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { isAdRollCampaignSurface, isAdRollSurface } from '@/lib/adroll';
import { beaconTouch } from '@/lib/touch';

/**
 * Fires a durable touchpoint beacon on the public browse surfaces as the SPA
 * navigates (ads-centralisation §4.4). Renders nothing; mounts once beside
 * AdRollRouteTracker (pages/index.jsx, never on the ops surface).
 *
 * The allow-list IS adroll.js's — campaign funnel ∪ public browse; everything
 * else (admin, redeem-ops, auth, token-bearing reward/callback links) never
 * beacons (change one list, check the other — the AdRoll header notes this
 * cross-reference too). The campaign funnel pages are skipped HERE for the
 * same reason AdRoll skips them: each fires its own beacon after its campaign
 * loads, with the campaign id and the test-data suppression gate applied.
 */
export default function TouchRouteTracker() {
  const { pathname, search } = useLocation();

  useEffect(() => {
    if (isAdRollCampaignSurface(pathname)) return;
    if (!isAdRollSurface(pathname)) return;
    beaconTouch({ surface: 'browse' });
  }, [pathname, search]);

  return null;
}
