import path from 'path'
import { fileURLToPath } from 'url'
import { getApp, closeDb, createTestUser } from './helpers.js'
import { sequelize } from '../src/models/index.js'
import { RewardOffer, Activation, PartnerOrganisation } from '../src/models/index.js'

/**
 * Migration 102 — the money/inventory invariants, in the DATABASE (P1-8).
 *
 * `committed ≥ allocated ≥ issued ≥ redeemed` and `walletBalanceCents ≥ 0` were
 * enforced ONLY by application-level guarded UPDATEs, and the append-only
 * ledger's activationId/entitlementId/redemptionId were bare UUIDs — so the
 * reconciliation source of truth could hold pointers to rows that never existed.
 *
 * What matters here: a write that breaks an invariant is REFUSED BY POSTGRES,
 * whatever issued it — service, script or psql session.
 *
 * SELF-CONTAINED: replays its own chain. `_migrations` survives
 * sync({force:true}), so on a reused test database the runner skips 102 while
 * the tables come back model-shaped.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const migrationsDir = path.join(__dirname, '../src/database/migrations')

let up, down, queryInterface, partner, adminId

const constraintExists = async (name) => {
  const [[r]] = await sequelize.query(
    'SELECT 1 AS ok FROM pg_constraint WHERE conname = :name', { replacements: { name } }
  )
  return Boolean(r)
}

const constraintValidated = async (name) => {
  const [[r]] = await sequelize.query(
    'SELECT convalidated FROM pg_constraint WHERE conname = :name', { replacements: { name } }
  )
  return r?.convalidated ?? null
}

const makeOffer = (over = {}) => RewardOffer.create({
  partnerOrganisationId: partner.id, title: 'Invariant Reward', status: 'active',
  committedQuantity: 100, allocatedQuantity: 50, issuedQuantity: 20, redeemedQuantity: 10,
  claimExpiryDays: 30, redemptionExpiryDays: 90, createdBy: adminId, ...over,
})

beforeAll(async () => {
  await getApp()
  ;({ up, down } = await import(path.join(migrationsDir, '102-inventory-invariant-constraints.js')))
  queryInterface = sequelize.getQueryInterface()
  await up(queryInterface) // idempotent; the runner may already have applied it
  const admin = await createTestUser({ role: 'admin' })
  adminId = admin.user.id
  partner = await PartnerOrganisation.create({
    tradingName: 'Invariant Spa', normalizedName: 'invariant spa', createdBy: adminId,
  })
})

afterAll(async () => { await closeDb() })

describe('migration 102 — up()', () => {
  it('creates every constraint, VALIDATED against clean data', async () => {
    for (const name of [
      'chk_reward_offers_quantity_ordering',
      'chk_activations_quantity_ordering',
      'chk_users_wallet_balance_non_negative',
      'fk_rie_activation',
      'fk_rie_entitlement',
      'fk_rie_redemption',
    ]) {
      expect(await constraintExists(name)).toBe(true)
      expect(await constraintValidated(name)).toBe(true)
    }
  })

  it('is idempotent — a second run adds nothing and throws nothing', async () => {
    await expect(up(queryInterface)).resolves.not.toThrow()
    expect(await constraintExists('chk_reward_offers_quantity_ordering')).toBe(true)
  })
})

describe('reward_offers quantity ordering', () => {
  it('accepts a well-ordered offer', async () => {
    await expect(makeOffer()).resolves.toBeDefined()
  })

  it.each([
    ['allocated above committed', { committedQuantity: 10, allocatedQuantity: 20, issuedQuantity: 0, redeemedQuantity: 0 }],
    ['issued above allocated', { committedQuantity: 100, allocatedQuantity: 10, issuedQuantity: 20, redeemedQuantity: 0 }],
    ['redeemed above issued', { committedQuantity: 100, allocatedQuantity: 50, issuedQuantity: 5, redeemedQuantity: 9 }],
    ['negative redeemed', { committedQuantity: 100, allocatedQuantity: 50, issuedQuantity: 20, redeemedQuantity: -1 }],
  ])('refuses %s', async (_label, quantities) => {
    await expect(makeOffer(quantities)).rejects.toThrow(/chk_reward_offers_quantity_ordering/)
  })

  it('refuses an UPDATE that breaks the ordering — not just an INSERT', async () => {
    const offer = await makeOffer()
    await expect(
      sequelize.query('UPDATE reward_offers SET "redeemedQuantity" = 999 WHERE id = :id', {
        replacements: { id: offer.id },
      })
    ).rejects.toThrow(/chk_reward_offers_quantity_ordering/)
  })
})

describe('activations quantity ordering', () => {
  const makeActivation = (over = {}) => Activation.create({
    partnerOrganisationId: partner.id, rewardOfferId: over.rewardOfferId, campaignId: null,
    allocatedQuantity: 20, issuedCount: 10, redeemedCount: 5, status: 'draft',
    unlockPolicy: 'agent_unlock', createdBy: adminId, ...over,
  })

  it('accepts a well-ordered activation', async () => {
    const offer = await makeOffer()
    await expect(makeActivation({ rewardOfferId: offer.id })).resolves.toBeDefined()
  })

  it('refuses issuing past the allocation', async () => {
    const offer = await makeOffer()
    await expect(
      makeActivation({ rewardOfferId: offer.id, allocatedQuantity: 5, issuedCount: 6, redeemedCount: 0 })
    ).rejects.toThrow(/chk_activations_quantity_ordering/)
  })

  it('refuses redeeming more than was issued', async () => {
    const offer = await makeOffer()
    await expect(
      makeActivation({ rewardOfferId: offer.id, allocatedQuantity: 20, issuedCount: 3, redeemedCount: 4 })
    ).rejects.toThrow(/chk_activations_quantity_ordering/)
  })
})

describe('users wallet balance', () => {
  it('refuses a negative balance', async () => {
    const { user } = await createTestUser({ role: 'agent' })
    await expect(
      sequelize.query('UPDATE users SET "walletBalanceCents" = -1 WHERE id = :id', {
        replacements: { id: user.id },
      })
    ).rejects.toThrow(/chk_users_wallet_balance_non_negative/)
  })

  it('still allows zero', async () => {
    const { user } = await createTestUser({ role: 'agent' })
    await expect(
      sequelize.query('UPDATE users SET "walletBalanceCents" = 0 WHERE id = :id', {
        replacements: { id: user.id },
      })
    ).resolves.toBeDefined()
  })
})

describe('audit-ledger pointers', () => {
  const insertLedger = (column, value, offerId) => sequelize.query(
    `INSERT INTO reward_inventory_events (id, "rewardOfferId", "${column}", type, quantity, "actorType", "createdAt")
     VALUES (gen_random_uuid(), :offerId, :value, 'allocated', 1, 'staff', now())`,
    { replacements: { offerId, value } }
  )

  // Two constraints guard each column in TEST and one in PROD: the model now
  // declares references, so sync({force:true}) emits its own
  // reward_inventory_events_<col>_fkey, while the migration adds fk_rie_<x> for
  // the production table sync never touches. Either name is a pass — what this
  // asserts is that the dangling write is REFUSED, and that the migration's own
  // constraint exists and is validated (first describe block).
  it.each(['activationId', 'entitlementId', 'redemptionId'])('refuses a dangling %s', async (column) => {
    const offer = await makeOffer()
    await expect(
      insertLedger(column, '00000000-0000-4000-8000-000000000000', offer.id)
    ).rejects.toThrow(new RegExp(`foreign key constraint.*${column}|${column}.*foreign key`, 'i'))
  })

  it('still accepts NULL pointers — most ledger rows have no activation', async () => {
    const offer = await makeOffer()
    await expect(insertLedger('activationId', null, offer.id)).resolves.toBeDefined()
  })
})

describe('migration 102 — down()', () => {
  it('removes every constraint it added, then up() restores them', async () => {
    await down(queryInterface)
    expect(await constraintExists('chk_reward_offers_quantity_ordering')).toBe(false)
    expect(await constraintExists('fk_rie_redemption')).toBe(false)

    // ...and without the CHECK, the broken write Postgres just refused goes in.
    const bad = await makeOffer({ committedQuantity: 1, allocatedQuantity: 99, issuedQuantity: 0, redeemedQuantity: 0 })
    expect(bad.allocatedQuantity).toBe(99)
    await bad.destroy()

    await up(queryInterface)
    expect(await constraintExists('chk_reward_offers_quantity_ordering')).toBe(true)
    expect(await constraintExists('fk_rie_redemption')).toBe(true)
  })
})
