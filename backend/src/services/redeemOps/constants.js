/**
 * Redeem Ops domain constants (docs/redeem-ops/ERD.md §5–6). STRING columns +
 * app-level constant lists are the house style for evolving states (not DB enums).
 * Served to the SPA via GET /api/redeem-ops/meta/constants so UI and API can't drift.
 */
import { REDEEM_OPS_SUB_ROLES, CAPABILITIES, ROLE_CAPABILITIES } from './permissions.js';

/**
 * Five working stages + one terminal outcome (2026-07-10 redesign, migration
 * 051). Industry-standard shape (Pipedrive 5 / HubSpot 5-7): each stage is a
 * verifiable commitment milestone. Everything the old 14-stage model encoded
 * elsewhere now lives where it belongs:
 *   ownership   → ownerUserId (claiming never touches the stage)
 *   researching → a task
 *   replied     → the activity log (inbound activities)
 *   no response → staleFlag / atRiskFlag
 *   snooze      → availability='follow_up_later' + snoozedUntil (wake sweep)
 *   two dead stages → LOST + lostReason
 * Historical stage events keep the old names; the UI still renders them.
 */
export const PIPELINE_STAGES = [
  'NEW',
  'CONTACTED',
  'MEETING',
  'PROPOSAL',
  'PARTNERED',
  'LOST',
];

export const LOST_REASONS = ['not_interested', 'disqualified', 'no_response', 'other'];

export const PARTNER_AVAILABILITY = ['available', 'owned', 'follow_up_later', 'restricted', 'disqualified'];

/**
 * Allowed pipeline transitions (docs/redeem-ops/ERD.md §6). Server-enforced in
 * partnerService.changeStage — drag-and-drop or API, same rules. super_admin /
 * ops_admin may force any transition (audited with a required reason).
 */
export const STAGE_TRANSITIONS = {
  NEW: ['CONTACTED', 'LOST'],
  CONTACTED: ['MEETING', 'PROPOSAL', 'LOST'],
  MEETING: ['PROPOSAL', 'PARTNERED', 'LOST'],
  PROPOSAL: ['PARTNERED', 'MEETING', 'LOST'],
  PARTNERED: [],
  // Revival: a lost business can re-enter the conversation.
  LOST: ['CONTACTED'],
};

/** Activity types that count as real outreach (bump lastActivityAt / clear flags). */
export const MEANINGFUL_ACTIVITY_TYPES = [
  'call_attempt', 'call_connected', 'whatsapp_sent', 'whatsapp_reply', 'email_sent',
  'email_reply', 'instagram_dm', 'facebook_message', 'meeting_booked',
  'meeting_completed', 'proposal_sent', 'follow_up',
];

export const ACTIVITY_TYPES = [
  'call_attempt',
  'call_connected',
  'whatsapp_sent',
  'whatsapp_reply',
  'email_sent',
  'email_reply',
  'instagram_dm',
  'facebook_message',
  'meeting_booked',
  'meeting_completed',
  'proposal_sent',
  'follow_up',
  'internal_note',
  'other',
];

export const REWARD_TYPES = [
  'free_service',
  'free_product',
  'free_trial',
  'voucher',
  'credit',
  'discount',
  'experience',
  'other',
];

export const TASK_STATUSES = ['open', 'in_progress', 'completed', 'cancelled'];
export const TASK_PRIORITIES = ['low', 'medium', 'high'];

export const SUB_ROLE_LABELS = {
  super_admin: 'Super Admin',
  ops_admin: 'Ops Admin',
  bdm: 'Business Development Manager',
  outreach_exec: 'Outreach Executive',
  campaign_ops: 'Campaign Ops',
  redemption_ops: 'Redemption Ops',
  analyst: 'Analyst',
};

/** Payload for GET /api/redeem-ops/meta/constants. */
export function publicConstants() {
  return {
    pipelineStages: PIPELINE_STAGES,
    stageTransitions: STAGE_TRANSITIONS,
    lostReasons: LOST_REASONS,
    partnerAvailability: PARTNER_AVAILABILITY,
    activityTypes: ACTIVITY_TYPES,
    rewardTypes: REWARD_TYPES,
    taskStatuses: TASK_STATUSES,
    taskPriorities: TASK_PRIORITIES,
    subRoles: REDEEM_OPS_SUB_ROLES,
    subRoleLabels: SUB_ROLE_LABELS,
    capabilities: CAPABILITIES,
    roleCapabilities: ROLE_CAPABILITIES,
  };
}
