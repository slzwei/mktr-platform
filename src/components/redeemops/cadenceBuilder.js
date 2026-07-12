/**
 * Shared builder vocabulary + mapping helpers for the cadence editor
 * (docs/plans/redeem-ops-cadences.md §8.5). Pure module — no JSX — imported by
 * the editor page, the Settings list, and tests.
 */

export const CHANNELS = [
  { value: 'call', label: 'Call' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'email', label: 'Email' },
  { value: 'instagram_dm', label: 'Instagram DM' },
  { value: 'visit', label: 'Walk-in visit' },
  { value: 'custom', label: 'Custom step' },
];

export const WINDOWS = [
  { value: 'any', label: 'Any time' },
  { value: 'morning', label: 'Morning (9:30)' },
  { value: 'afternoon', label: 'Afternoon (15:00)' },
  { value: 'off_peak', label: 'Off-peak (15:00–17:00)' },
];

export const PRIORITIES = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

/** Non-terminal outcomes that may advance to the next step, per channel. */
export const CONTINUE_OPTIONS = {
  call: [{ value: '*', label: 'Any outcome' }, { value: 'no_answer', label: 'No answer only' }, { value: 'connected', label: 'Connected only' }],
  whatsapp: [{ value: '*', label: 'Any outcome' }, { value: 'sent', label: 'Sent' }],
  email: [{ value: '*', label: 'Any outcome' }, { value: 'sent', label: 'Sent' }],
  instagram_dm: [{ value: '*', label: 'Any outcome' }, { value: 'sent', label: 'Sent' }],
  visit: [{ value: '*', label: 'Any outcome' }, { value: 'met', label: 'Met only' }, { value: 'closed', label: 'Outlet closed only' }],
  custom: [{ value: '*', label: 'Any outcome' }, { value: 'done', label: 'Done' }],
};

export const CHANNEL_LABEL = Object.fromEntries(CHANNELS.map((c) => [c.value, c.label]));

export const emptyStep = (channel = 'call') => ({
  channel, title: '', script: '', priority: 'medium',
  delayDays: 0, timeWindow: 'any', continueOn: channel === 'call' ? 'no_answer' : '*',
});

/**
 * Reverse-map a stored cadence (steps + transition edges) into the builder's
 * linear dialect: each step's delay/window ride its INCOMING edge, its
 * continue-on is the OUTGOING edge to the next step. Both seeded cadences and
 * everything the builder saves are linear, so the round-trip is lossless.
 */
export function toBuilderSteps(cadence) {
  const steps = [...(cadence.steps || [])].sort((a, b) => a.stepOrder - b.stepOrder);
  const byFrom = {};
  let entry = null;
  for (const t of cadence.transitions || []) {
    if (t.fromStepId) byFrom[t.fromStepId] = t;
    else entry = t;
  }
  return steps.map((s, i) => {
    const incoming = i === 0 ? entry : byFrom[steps[i - 1].id];
    const outgoing = byFrom[s.id];
    return {
      channel: s.channel,
      title: s.title,
      script: s.scriptTemplate || '',
      priority: s.priority || 'medium',
      delayDays: incoming?.delayDays ?? 0,
      timeWindow: incoming?.timeWindow || 'any',
      continueOn: outgoing?.disposition || '*',
    };
  });
}

/** "≈ Day N" markers: cumulative delay down the continue path. */
export function cumulativeDays(steps) {
  let day = 0;
  return steps.map((s) => {
    day += Number(s.delayDays) || 0;
    return day;
  });
}

/** Builder state → API payload. */
export function toPayload({ name, description, steps }) {
  return {
    name: name.trim(),
    description: (description || '').trim() || null,
    steps: steps.map((s) => ({
      channel: s.channel, title: s.title.trim(), script: s.script || null,
      priority: s.priority, delayDays: Number(s.delayDays) || 0,
      timeWindow: s.timeWindow, continueOn: s.continueOn,
    })),
  };
}
