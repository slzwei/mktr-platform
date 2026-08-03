/**
 * M4 (review round 3): reconcile() must honour legitimate redemption
 * reversals.
 *
 * reverseRedeemed (the agent_handover undo) decrements redeemedQuantity and
 * writes a `redeem_reversed` ledger event — but reconcile() derived
 * redeemedQuantity from `redeemed` events alone. Every legitimate reversal
 * therefore produced PERMANENT reported drift: the 15-minute fulfilment sweep
 * raised a false inconsistency forever after, and a stream of false alarms is
 * exactly how real counter corruption goes unnoticed.
 *
 * Note on the task's "back-check existing offers": the drift lived only in
 * reconcile()'s DERIVED output (the stored counters were always correct —
 * reverseRedeemed moved them properly). Nothing is persisted to clear; the
 * corrected formula clears every historical false positive on the next sweep.
 */
import { getApp, closeDb, createTestUser } from './helpers.js'
import { PartnerOrganisation, RewardOffer, sequelize } from '../src/models/index.js'
import { makeInventoryService } from '../src/services/redeemOps/inventoryService.js'

let admin, partner

beforeAll(async () => {
  await getApp()
  admin = (await createTestUser({ role: 'admin' })).user
  partner = await PartnerOrganisation.create({
    legalName: 'Reconcile Reversal Partner',
    normalizedName: 'reconcile reversal partner',
    createdBy: admin.id,
  })
})

afterAll(async () => {
  await closeDb()
})

const inventory = makeInventoryService()

async function makeOffer() {
  return RewardOffer.create({
    partnerOrganisationId: partner.id,
    title: 'Reconcile Test Reward',
    rewardType: 'free_service',
    fundingSource: 'mktr',
    status: 'active',
    createdBy: admin.id,
  })
}

/** committed → allocated → issued(n) → redeemed(n) through the real service,
 *  so the ledger and counters move exactly as production does. */
async function issueAndRedeem(offerId, n) {
  await inventory.increaseCommitted({ offerId, quantity: n, actorUser: admin, reason: 'test supply' })
  await inventory.allocate({ offerId, activationId: null, quantity: n, actorUser: admin, reason: 'test allocation' })
  for (let i = 0; i < n; i++) {
    await inventory.recordIssued({ offerId, activationId: null, entitlementId: null })
    await inventory.recordRedeemed({ offerId, activationId: null, entitlementId: null, actorUser: admin })
  }
}

describe('M4 — reconcile() subtracts redeem_reversed', () => {
  it('a full handover reversal leaves the offer CONSISTENT', async () => {
    const offer = await makeOffer()
    await issueAndRedeem(offer.id, 1)

    // The agent_handover undo, in the documented order: redeemed side first.
    await inventory.reverseRedeemed({ offerId: offer.id, actorUser: admin, reason: 'voucher still in pocket' })
    await inventory.reverseIssued({ offerId: offer.id, type: 'cancelled', reason: 'handover reversed' })

    const { consistent, derived, actual } = await inventory.reconcile(offer.id)
    // Pre-fix: derived.redeemedQuantity stayed 1 (sum of `redeemed` only)
    // while the counter correctly read 0 — false drift on every sweep.
    expect(derived.redeemedQuantity).toBe(0)
    expect(actual.redeemedQuantity).toBe(0)
    expect(consistent).toBe(true)
  })

  it('a partial reversal reconciles to the surviving redemptions', async () => {
    const offer = await makeOffer()
    await issueAndRedeem(offer.id, 2)
    await inventory.reverseRedeemed({ offerId: offer.id, actorUser: admin, reason: 'one handover undone' })

    const { consistent, derived, actual } = await inventory.reconcile(offer.id)
    expect(derived.redeemedQuantity).toBe(1)
    expect(actual.redeemedQuantity).toBe(1)
    expect(consistent).toBe(true)
  })

  it('REAL counter corruption still surfaces (the alarm keeps its teeth)', async () => {
    const offer = await makeOffer()
    await issueAndRedeem(offer.id, 1)

    // Corrupt the counter without a ledger row — the drift reconcile exists
    // for. The corruption must be one PROD could actually hold: a lost update
    // (counter reset to 0 while the ledger says 1). The old test set the
    // counter to 5 > issued, which chk_reward_offers_quantity_ordering makes
    // unstorable — the degraded sync-era schema was the only place it fit.
    await sequelize.query(
      'UPDATE reward_offers SET "redeemedQuantity" = 0 WHERE id = :id',
      { replacements: { id: offer.id } }
    )

    const { consistent, derived, actual } = await inventory.reconcile(offer.id)
    expect(derived.redeemedQuantity).toBe(1)
    expect(actual.redeemedQuantity).toBe(0)
    expect(consistent).toBe(false)
  })
})
