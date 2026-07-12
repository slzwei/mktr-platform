import {
  OutreachCadence, OutreachCadenceStep, OutreachCadenceTransition, User, sequelize,
} from '../../models/index.js';
import { logger } from '../../utils/logger.js';

/**
 * Canonical cadence definitions (docs/plans/redeem-ops-cadences.md §10).
 * Seeded from bootstrap AFTER initSystemAgent — a migration seed could never
 * satisfy createdBy on a fresh DB. Idempotent by immutable (key, version);
 * editing a definition means adding a NEW version here, never mutating one.
 * There is deliberately no builder UI in P1 — these are the cadences.
 *
 * Transitions: `from`/`to` reference stepOrder (resolved to ids at insert);
 * from=null is the entry edge; missing edges finish the enrollment. delayDays
 * count from the PREVIOUS step's completion (edge semantics, not absolute days).
 */
const SEEDS = [
  {
    key: 'fnb_call_first',
    version: 1,
    name: 'F&B acquisition — call-first',
    description: 'Default acquisition chase for F&B and retail merchants: calls carry the sequence, WhatsApp/IG fill the gaps, a walk-in closes it out.',
    steps: [
      { o: 1, channel: 'call', title: 'Intro call', priority: 'high', script: 'Hi {{contact_name}}, calling from Redeem about {{partner_name}} — we send nearby customers to partner outlets through voucher campaigns. 30 seconds to explain?' },
      { o: 2, channel: 'whatsapp', title: 'WhatsApp intro (after no answer)', priority: 'medium', script: 'Hi {{contact_name}}! Tried calling about {{partner_name}} — we run Redeem (redeem.sg), sending verified customers to partner outlets. Free to list, you only honour redemptions. Keen to hear more?' },
      { o: 3, channel: 'call', title: 'Call #2 (off-peak)', priority: 'medium', script: 'Second attempt — reference the WhatsApp intro if it was sent.' },
      { o: 4, channel: 'instagram_dm', title: 'Instagram DM', priority: 'low', script: 'Hi! Love what {{partner_name}} is doing. We feature partner outlets on redeem.sg voucher drops — no upfront cost. Who handles partnerships?' },
      { o: 5, channel: 'call', title: 'Call #3 (final phone attempt)', priority: 'medium', script: 'Final call attempt — if no answer, the walk-in is next.' },
      { o: 6, channel: 'visit', title: 'Walk-in visit', priority: 'high', script: 'Drop by, ask for the owner/manager. Bring the partner one-pager.' },
      { o: 7, channel: 'whatsapp', title: 'Break-up message', priority: 'low', script: 'Hi {{contact_name}}, last note from me — if partnering with Redeem ever makes sense for {{partner_name}}, my line is open. All the best!' },
    ],
    transitions: [
      { from: null, disposition: '*', to: 1, delayDays: 0, timeWindow: 'any' },
      { from: 1, disposition: 'no_answer', to: 2, delayDays: 0, timeWindow: 'any' },
      // single-outcome steps use '*' so a BLOCKED step (no IG handle, no phone
      // on record) skips forward instead of finishing the whole cadence
      { from: 2, disposition: '*', to: 3, delayDays: 2, timeWindow: 'off_peak' },
      { from: 3, disposition: 'no_answer', to: 4, delayDays: 2, timeWindow: 'any' },
      { from: 4, disposition: '*', to: 5, delayDays: 3, timeWindow: 'off_peak' },
      { from: 5, disposition: 'no_answer', to: 6, delayDays: 3, timeWindow: 'any' },
      { from: 6, disposition: 'closed', to: 7, delayDays: 4, timeWindow: 'any' },
      // everything else (connected without a follow-on, sent break-up, met…) → finish
    ],
  },
  {
    key: 'revival_60d',
    version: 1,
    name: 'Revival — 60 days later',
    description: 'Light-touch re-engagement for businesses that went quiet or were lost to no-response.',
    steps: [
      { o: 1, channel: 'whatsapp', title: 'Check-in message', priority: 'medium', script: 'Hi {{contact_name}}, checking back in — Redeem has grown since we last spoke. Worth a fresh look for {{partner_name}}?' },
      { o: 2, channel: 'call', title: 'Revival call', priority: 'medium', script: 'Follow the check-in message; lead with what changed (new campaigns, redemption volume).' },
      { o: 3, channel: 'email', title: 'Recap email', priority: 'low', script: 'Hi {{contact_name}},\n\nSharing a quick recap of the Redeem partner programme for {{partner_name}} — happy to answer anything.\n\nBest,' },
    ],
    transitions: [
      { from: null, disposition: '*', to: 1, delayDays: 0, timeWindow: 'any' },
      { from: 1, disposition: '*', to: 2, delayDays: 5, timeWindow: 'off_peak' },
      { from: 2, disposition: 'no_answer', to: 3, delayDays: 7, timeWindow: 'any' },
    ],
  },
];

/** Idempotent bootstrap seeding, advisory-lock guarded (single-flight). */
export async function ensureCadences() {
  const creator = await User.findOne({
    where: { email: process.env.SYSTEM_AGENT_EMAIL || 'system@mktr.local' },
  });
  if (!creator) {
    logger.warn('[RedeemOps] cadence seeds skipped — system agent not found');
    return { seeded: 0 };
  }

  let seeded = 0;
  await sequelize.transaction(async (t) => {
    await sequelize.query('SELECT pg_advisory_xact_lock(9157002)', { transaction: t });
    for (const seed of SEEDS) {
      const existing = await OutreachCadence.findOne({
        where: { key: seed.key, version: seed.version }, transaction: t,
      });
      if (existing) continue;

      const cadence = await OutreachCadence.create({
        key: seed.key, version: seed.version, name: seed.name,
        description: seed.description, createdBy: creator.id,
      }, { transaction: t });

      const idByOrder = {};
      for (const s of seed.steps) {
        const step = await OutreachCadenceStep.create({
          cadenceId: cadence.id, stepOrder: s.o, channel: s.channel,
          title: s.title, scriptTemplate: s.script || null, priority: s.priority || 'medium',
        }, { transaction: t });
        idByOrder[s.o] = step.id;
      }
      for (const tr of seed.transitions) {
        await OutreachCadenceTransition.create({
          cadenceId: cadence.id,
          fromStepId: tr.from === null ? null : idByOrder[tr.from],
          disposition: tr.disposition,
          toStepId: tr.to === null ? null : idByOrder[tr.to],
          delayDays: tr.delayDays, timeWindow: tr.timeWindow,
        }, { transaction: t });
      }
      seeded += 1;
      logger.info('redeem_ops.cadence.seeded', { key: seed.key, version: seed.version });
    }
  });
  return { seeded };
}
