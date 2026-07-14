/**
 * Per-campaign ViewContent session guard (Analytics Event Taxonomy §02).
 *
 * ViewContent fires ONCE per campaign per session, at the FIRST public content
 * surface (offer detail for marketplace traffic; the flow/LeadCapture page for
 * direct links). The guard stores the client-generated event_id plus
 * per-platform fired flags under sessionStorage `vc:{campaignId}` so
 * detail → flow navigation (and back) reuses the SAME id and never re-fires —
 * while Meta and TikTok still fire independently (one platform being
 * unconfigured must not suppress the other).
 *
 * sessionStorage-unavailable environments (some private modes) fall back to an
 * in-memory map — worst case matches today's per-mount behaviour.
 */

import { generateEventId } from './metaPixel';

const memoryStore = new Map();

function storageKey(campaignId) {
  return `vc:${campaignId}`;
}

function readState(campaignId) {
  const key = storageKey(campaignId);
  try {
    const raw = window.sessionStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.eventId === 'string') return parsed;
    }
  } catch {
    /* sessionStorage unavailable/corrupt — fall through to memory */
  }
  return memoryStore.get(key) || null;
}

function writeState(campaignId, state) {
  const key = storageKey(campaignId);
  memoryStore.set(key, state);
  try {
    window.sessionStorage.setItem(key, JSON.stringify(state));
  } catch {
    /* memory fallback already holds it */
  }
}

/** Get (or mint) the campaign's ViewContent state for this session. */
export function getOrCreateVcState(campaignId) {
  if (!campaignId) return { eventId: generateEventId(), firedMeta: false, firedTiktok: false };
  const existing = readState(campaignId);
  if (existing) {
    return {
      eventId: existing.eventId,
      firedMeta: existing.firedMeta === true,
      firedTiktok: existing.firedTiktok === true,
    };
  }
  const fresh = { eventId: generateEventId(), firedMeta: false, firedTiktok: false };
  writeState(campaignId, fresh);
  return fresh;
}

/** Record that a platform's ViewContent fired for this campaign this session. */
export function markVcFired(campaignId, platform) {
  if (!campaignId) return;
  const state = getOrCreateVcState(campaignId);
  if (platform === 'meta') state.firedMeta = true;
  if (platform === 'tiktok') state.firedTiktok = true;
  writeState(campaignId, state);
}
