import { PartnerOnboardingItem, PartnerOrganisation, sequelize } from '../../models/index.js';
import { AppError } from '../../middleware/errorHandler.js';
import { logger } from '../../utils/logger.js';

/**
 * Partner onboarding checklist (brief §22). Seeded when a partner hits
 * PARTNERED (partnerService.changeStage → onPartnered hook); idempotent
 * (unique (partner, itemKey)).
 */
export const ONBOARDING_TEMPLATE = [
  { itemKey: 'partnership_confirmed', label: 'Partnership confirmed' },
  { itemKey: 'primary_contact_verified', label: 'Primary contact verified' },
  { itemKey: 'org_details_verified', label: 'Organisation details verified' },
  { itemKey: 'locations_confirmed', label: 'Participating locations confirmed' },
  { itemKey: 'reward_offer_entered', label: 'Reward offer entered' },
  { itemKey: 'reward_terms_confirmed', label: 'Reward terms confirmed' },
  { itemKey: 'quantity_confirmed', label: 'Quantity / capacity confirmed' },
  { itemKey: 'redemption_method_confirmed', label: 'Redemption method confirmed' },
  { itemKey: 'campaign_requirements_collected', label: 'Campaign requirements collected' },
  { itemKey: 'documentation_recorded', label: 'Documentation status recorded' },
  { itemKey: 'ready_for_activation', label: 'Ready for Activation' },
];

const ITEM_STATUSES = ['pending', 'in_progress', 'done', 'na'];

export function makeOnboardingService(overrides = {}) {
  const d = { PartnerOnboardingItem, PartnerOrganisation, sequelize, logger, ...overrides };

  /** Idempotent template seed — safe to call on every PARTNERED transition. */
  async function seedChecklist(partnerOrganisationId, transaction = null) {
    for (const [i, item] of ONBOARDING_TEMPLATE.entries()) {
      await d.PartnerOnboardingItem.findOrCreate({
        where: { partnerOrganisationId, itemKey: item.itemKey },
        defaults: { partnerOrganisationId, itemKey: item.itemKey, label: item.label, sortOrder: i },
        transaction,
      });
    }
  }

  async function getChecklist(partnerOrganisationId) {
    return d.PartnerOnboardingItem.findAll({
      where: { partnerOrganisationId },
      order: [['sortOrder', 'ASC']],
    });
  }

  async function updateItem(itemId, body, user) {
    const item = await d.PartnerOnboardingItem.findByPk(itemId);
    if (!item) throw new AppError('Checklist item not found', 404);
    const updates = {};
    if (body.status !== undefined) {
      if (!ITEM_STATUSES.includes(body.status)) throw new AppError('Unknown status', 400);
      updates.status = body.status;
      updates.completedAt = body.status === 'done' ? new Date() : null;
    }
    if (body.assigneeUserId !== undefined) updates.assigneeUserId = body.assigneeUserId;
    if (body.notes !== undefined) updates.notes = body.notes;
    await item.update(updates);
    return item;
  }

  return { seedChecklist, getChecklist, updateItem };
}

const _default = makeOnboardingService();
export default _default;
