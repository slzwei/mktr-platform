import { PartnerOnboardingItem, PartnerOrganisation, User, sequelize } from '../../models/index.js';
import { AppError } from '../../middleware/appError.js';
import { logger } from '../../utils/logger.js';
import { canActOnPartnerRow, isRedeemOpsUser } from './permissions.js';

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
  const d = {
    PartnerOnboardingItem, PartnerOrganisation, User, sequelize, logger,
    canActOnPartnerRow, isRedeemOpsUser, ...overrides,
  };

  /**
   * H2: onboarding.manage is a CAPABILITY, not row access — an outreach_exec
   * holds it yet may only act on partners they own. Every read/write below
   * loads the parent row and applies the same ownership gate as stage moves
   * and detail edits (canActOnPartnerRow: owner, ops_admin+, platform admin).
   */
  async function assertPartnerActionable(partnerOrganisationId, user) {
    const partner = await d.PartnerOrganisation.findByPk(partnerOrganisationId);
    if (!partner || partner.mergedIntoId) throw new AppError('Partner not found', 404);
    if (!d.canActOnPartnerRow(user, partner)) {
      throw new AppError(
        partner.ownerUserId
          ? 'You can only manage onboarding for businesses you own'
          : 'Claim this business first, then you can manage its onboarding',
        403
      );
    }
    return partner;
  }

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

  async function getChecklist(partnerOrganisationId, user) {
    await assertPartnerActionable(partnerOrganisationId, user);
    return d.PartnerOnboardingItem.findAll({
      where: { partnerOrganisationId },
      order: [['sortOrder', 'ASC']],
    });
  }

  async function updateItem(itemId, body, user) {
    const item = await d.PartnerOnboardingItem.findByPk(itemId);
    if (!item) throw new AppError('Checklist item not found', 404);
    // The item's parent decides who may touch it — knowing another partner's
    // item UUID must not grant writes across the ownership boundary (H2).
    await assertPartnerActionable(item.partnerOrganisationId, user);
    const updates = {};
    if (body.status !== undefined) {
      if (!ITEM_STATUSES.includes(body.status)) throw new AppError('Unknown status', 400);
      updates.status = body.status;
      updates.completedAt = body.status === 'done' ? new Date() : null;
    }
    if (body.assigneeUserId !== undefined) {
      if (body.assigneeUserId === null || body.assigneeUserId === '') {
        updates.assigneeUserId = null;
      } else {
        const assignee = await d.User.findByPk(body.assigneeUserId);
        if (!assignee || assignee.isActive !== true || !d.isRedeemOpsUser(assignee)) {
          throw new AppError('assigneeUserId must be an active Redeem Ops user', 422);
        }
        updates.assigneeUserId = assignee.id;
      }
    }
    if (body.notes !== undefined) updates.notes = body.notes;
    await item.update(updates);
    return item;
  }

  return { seedChecklist, getChecklist, updateItem };
}

const _default = makeOnboardingService();
export default _default;
