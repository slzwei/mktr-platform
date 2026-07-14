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
 * Backward corrections (isBackwardStageMove) are additionally open to anyone
 * who can act on the row, so a mis-dropped card is never stuck — same
 * required-reason audit trail as a forced move.
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

/**
 * A later working stage moving to an earlier one — the "fix a mis-drop"
 * direction. LOST stays outside this rule: it is terminal, and revival is
 * CONTACTED-only via STAGE_TRANSITIONS.
 */
const WORKING_STAGE_ORDER = PIPELINE_STAGES.filter((s) => s !== 'LOST');
export function isBackwardStageMove(fromStage, toStage) {
  const from = WORKING_STAGE_ORDER.indexOf(fromStage);
  const to = WORKING_STAGE_ORDER.indexOf(toStage);
  return from !== -1 && to !== -1 && to < from;
}

/** Activity types that count as real outreach (bump lastActivityAt / clear flags). */
export const MEANINGFUL_ACTIVITY_TYPES = [
  'call_attempt', 'call_connected', 'whatsapp_sent', 'whatsapp_reply', 'email_sent',
  'email_reply', 'instagram_dm', 'facebook_message', 'meeting_booked',
  'meeting_completed', 'proposal_sent', 'follow_up', 'visit',
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
  'visit',
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

// ── Cadences (docs/plans/redeem-ops-cadences.md §4.7) ───────────────────────

export const CADENCE_CHANNELS = ['call', 'whatsapp', 'email', 'instagram_dm', 'visit', 'custom'];
export const CADENCE_STEP_MODES = ['manual', 'auto']; // 'auto' reserved for P3 email
export const CADENCE_TIME_WINDOWS = ['any', 'morning', 'afternoon', 'off_peak'];
export const CADENCE_ENROLLMENT_STATES = ['active', 'paused', 'completed', 'exited'];
export const CADENCE_EXIT_REASONS = [
  'replied', 'stage_advanced', 'lost', 'not_interested', 'released',
  'archived', 'merged', 'manual_stop', 'finished',
];
/** Transitions may match a step's disposition exactly or fall back to this. */
export const CADENCE_WILDCARD_DISPOSITION = '*';

/**
 * Per-channel disposition matrix — there is deliberately NO global disposition
 * list (call+'sent' is nonsense). The completion endpoint validates against
 * the step's channel; the UI renders exactly these buttons.
 */
export const CHANNEL_DISPOSITIONS = {
  call: ['connected', 'no_answer', 'not_interested', 'replied'],
  whatsapp: ['sent', 'replied', 'not_interested'],
  email: ['sent', 'replied', 'not_interested'],
  instagram_dm: ['sent', 'replied', 'not_interested'],
  visit: ['met', 'closed', 'not_interested'],
  custom: ['done', 'not_interested'],
};

/** Dispositions that end the enrollment regardless of transition edges. */
export const CADENCE_TERMINAL_DISPOSITIONS = ['replied', 'not_interested'];

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
    cadenceChannels: CADENCE_CHANNELS,
    cadenceTimeWindows: CADENCE_TIME_WINDOWS,
    cadenceEnrollmentStates: CADENCE_ENROLLMENT_STATES,
    cadenceExitReasons: CADENCE_EXIT_REASONS,
    channelDispositions: CHANNEL_DISPOSITIONS,
  };
}
