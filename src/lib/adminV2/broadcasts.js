/**
 * Email-broadcast UI vocabulary (tracker "emailpush") — status/reason
 * language shared by the list, composer and detail screens. Sender-side skip
 * reasons extend the cohort REASON_META (consent-gate codes render through
 * the same vocabulary so the WHY language never forks).
 */
import { REASON_META, reasonLabel as cohortReasonLabel } from './cohorts.js';

export const BROADCAST_STATUS_META = {
  draft: { label: 'Draft', tone: '' },
  preparing: { label: 'Preparing', tone: 'warn' },
  sending: { label: 'Sending', tone: 'warn' },
  cancelling: { label: 'Cancelling', tone: 'warn' },
  completed: { label: 'Completed', tone: 'ok' },
  interrupted: { label: 'Interrupted', tone: 'warn' },
  failed: { label: 'Failed', tone: 'bad' },
  cancelled: { label: 'Cancelled', tone: '' },
};

export const RECIPIENT_STATUS_META = {
  pending: { label: 'Pending', tone: '' },
  attempting: { label: 'Attempting', tone: 'warn' },
  sent: { label: 'Sent', tone: 'ok' },
  skipped: { label: 'Skipped', tone: 'hold' },
  failed: { label: 'Failed', tone: 'bad' },
};

/** Sender-side codes on top of the consent-gate vocabulary. */
const SENDER_REASON_META = {
  duplicate_email: { label: 'Duplicate address', tone: 'hold', hint: 'Another person in this push already received this exact address — one copy per inbox.' },
  address_suppressed: { label: 'Address unsubscribed', tone: 'bad', hint: 'This address unsubscribed through another signup — it wins across all of them.' },
  unsub_token_error: { label: 'Unsubscribe link broken', tone: 'bad', hint: 'The unsubscribe link could not be verified — marketing mail is never sent without a working one.' },
  send_error: { label: 'Send failed', tone: 'bad', hint: 'The mail server rejected or failed the send.' },
  ambiguous_crash: { label: 'Crash — not retried', tone: 'warn', hint: 'The send was interrupted mid-attempt; it may or may not have gone out, so it is never retried.' },
  cancelled: { label: 'Cancelled', tone: '', hint: 'The push was cancelled before this person was reached.' },
};

export function broadcastReasonMeta(reason) {
  return SENDER_REASON_META[reason] || REASON_META[reason] || null;
}

export function broadcastReasonLabel(reason) {
  return SENDER_REASON_META[reason]?.label || cohortReasonLabel(reason);
}

/** The send gate scope: the cohort definition re-aimed at the push campaign
 * (what the backend freezes at preparing — mirrored for the live estimate). */
export function definitionWithCampaignScope(definition, campaignId) {
  if (!definition || typeof definition !== 'object') return definition;
  return {
    ...definition,
    marketingContext: { ...(definition.marketingContext || {}), campaignId: campaignId || null },
  };
}

/** Statuses where the worker is (or should be) alive and the UI polls. */
export const ACTIVE_BROADCAST_STATUSES = ['preparing', 'sending', 'cancelling'];
