/**
 * Redeem Ops domain constants (docs/redeem-ops/ERD.md §5–6). STRING columns +
 * app-level constant lists are the house style for evolving states (not DB enums).
 * Served to the SPA via GET /api/redeem-ops/meta/constants so UI and API can't drift.
 */
import { REDEEM_OPS_SUB_ROLES, CAPABILITIES, ROLE_CAPABILITIES } from './permissions.js';

export const PIPELINE_STAGES = [
  'UNCLAIMED',
  'CLAIMED',
  'RESEARCHING',
  'CONTACTED',
  'REPLIED',
  'MEETING_BOOKED',
  'MEETING_COMPLETED',
  'PROPOSAL_SENT',
  'NEGOTIATING',
  'PARTNERED',
  'FOLLOW_UP_LATER',
  'NO_RESPONSE',
  'NOT_INTERESTED',
  'DISQUALIFIED',
];

export const PARTNER_AVAILABILITY = ['available', 'owned', 'follow_up_later', 'restricted', 'disqualified'];

/**
 * Allowed pipeline transitions (docs/redeem-ops/ERD.md §6). Server-enforced in
 * partnerService.changeStage — drag-and-drop or API, same rules. super_admin /
 * ops_admin may force any transition (audited with a required reason).
 */
export const STAGE_TRANSITIONS = {
  UNCLAIMED: ['CLAIMED'],
  CLAIMED: ['RESEARCHING', 'CONTACTED', 'FOLLOW_UP_LATER', 'NO_RESPONSE', 'NOT_INTERESTED', 'DISQUALIFIED'],
  RESEARCHING: ['CONTACTED', 'FOLLOW_UP_LATER', 'NOT_INTERESTED', 'DISQUALIFIED'],
  CONTACTED: ['REPLIED', 'NO_RESPONSE', 'FOLLOW_UP_LATER', 'NOT_INTERESTED', 'DISQUALIFIED'],
  REPLIED: ['MEETING_BOOKED', 'PROPOSAL_SENT', 'FOLLOW_UP_LATER', 'NOT_INTERESTED', 'DISQUALIFIED'],
  MEETING_BOOKED: ['MEETING_COMPLETED', 'NO_RESPONSE', 'FOLLOW_UP_LATER', 'NOT_INTERESTED'],
  MEETING_COMPLETED: ['PROPOSAL_SENT', 'NEGOTIATING', 'PARTNERED', 'FOLLOW_UP_LATER', 'NOT_INTERESTED'],
  PROPOSAL_SENT: ['NEGOTIATING', 'PARTNERED', 'NO_RESPONSE', 'FOLLOW_UP_LATER', 'NOT_INTERESTED'],
  NEGOTIATING: ['PARTNERED', 'PROPOSAL_SENT', 'FOLLOW_UP_LATER', 'NOT_INTERESTED'],
  PARTNERED: ['FOLLOW_UP_LATER'],
  FOLLOW_UP_LATER: ['CONTACTED', 'REPLIED', 'MEETING_BOOKED', 'PROPOSAL_SENT', 'NEGOTIATING', 'NOT_INTERESTED', 'DISQUALIFIED'],
  NO_RESPONSE: ['CONTACTED', 'FOLLOW_UP_LATER', 'NOT_INTERESTED', 'DISQUALIFIED'],
  NOT_INTERESTED: ['FOLLOW_UP_LATER', 'CONTACTED'],
  DISQUALIFIED: [],
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
