# Redeem Ops — Permission Matrix

> Phase 0 deliverable. Authorization is **additive** to the existing system: `users.role` keeps its
> current five values plus one new value `redeem_ops`; fine-grained access is a nullable
> `users.redeemOpsRole` sub-role mapped to capabilities. Enforcement is server-side middleware;
> UI hiding is convenience only. See `RECOMMENDED_ARCHITECTURE.md` §4 for storage design.

## 1. Principals

| Sub-role (`redeemOpsRole`) | Intended person | Platform `role` |
|---|---|---|
| `super_admin` | Shawn / platform owners. **Implicit for every `role='admin'` user** (middleware override); grantable explicitly too | `admin` or `redeem_ops` |
| `ops_admin` | Senior ops running partners+rewards+redemptions day-to-day | `redeem_ops` |
| `bdm` | Business Development Manager — team lead over outreach | `redeem_ops` |
| `outreach_exec` | The three V1 outreach staff | `redeem_ops` |
| `campaign_ops` | Activation/reward-allocation operator. **NOT an MKTR campaign builder** — links existing campaigns only (addendum §4); campaign create/edit stays behind MKTR `requireRole('admin')` on mktr.sg | `redeem_ops` |
| `redemption_ops` | Fulfilment/verification staff | `redeem_ops` |
| `analyst` | Read-only reporting | `redeem_ops` |
| *(future)* partner portal user | External business staff — **separate principal table** (`partner_users`) + separate token scope; never holds any capability below | n/a |

## 2. Capabilities → roles

Legend: ✓ full · O = own/owned-records only · — = no.

| Capability | super_admin | ops_admin | bdm | outreach_exec | campaign_ops | redemption_ops | analyst |
|---|---|---|---|---|---|---|---|
| `partners.view` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ (fulfilment context) | ✓ |
| `partners.create` | ✓ | ✓ | ✓ | ✓ | — | — | — |
| `partners.edit` | ✓ | ✓ | ✓ | O | — | — | — |
| `partners.claim` | ✓ | ✓ | ✓ | ✓ | — | — | — |
| `partners.release` (own claim) | ✓ | ✓ | ✓ | O | — | — | — |
| `partners.reassign` (any owner) | ✓ | ✓ | ✓ | — | — | — | — |
| `partners.restrict_disqualify` | ✓ | ✓ | ✓ | — | — | — | — |
| `partners.merge` | ✓ | ✓ | — | — | — | — | — |
| `partners.import` | ✓ | ✓ | ✓ | — | — | — | — |
| `contacts.manage` | ✓ | ✓ | ✓ | O | — | — | — |
| `locations.manage` | ✓ | ✓ | ✓ | O | — | — | — |
| `activities.log` | ✓ | ✓ | ✓ | O | — | ✓ (redemption notes) | — |
| `activities.edit` | ✓ | ✓ | own | own | — | — | — |
| `pipeline.move` | ✓ | ✓ | ✓ | O (permitted transitions) | — | — | — |
| `pipeline.view_team` | ✓ | ✓ | ✓ | — (own only) | ✓ (read) | — | ✓ (read) |
| `tasks.manage` | ✓ | ✓ | team | O | — | — | — |
| `pools.manage` | ✓ | ✓ | ✓ | — | — | — | — |
| `pools.claim_next` | ✓ | ✓ | ✓ | ✓ | — | — | — |
| `onboarding.manage` | ✓ | ✓ | ✓ | O | — | — | — |
| `rewards.view` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `rewards.manage` (offers+terms) | ✓ | ✓ | — | — | — | — | — |
| `inventory.adjust` (manual ledger) | ✓ | ✓ | — | — | — | — | — |
| `activations.view` | ✓ | ✓ | ✓ | — | ✓ | ✓ | ✓ |
| `activations.manage` | ✓ | ✓ | — | — | ✓ | — | — |
| `activations.link_campaign` | ✓ | ✓ | — | — | ✓ | — | — |
| `activations.allocate_inventory` | ✓ | ✓ | — | — | ✓ | — | — |
| `campaigns.read_reference` (projection + metrics) | ✓ | ✓ | ✓ | — | ✓ | — | ✓ |
| `entitlements.view` | ✓ | ✓ | — | — | ✓ | ✓ | ✓ (aggregates) |
| `entitlements.issue_manual` / `cancel` | ✓ | ✓ | — | — | — | ✓ | — |
| `redemptions.verify` (incl. unmasked lead contact at fulfilment) | ✓ | ✓ | — | — | — | ✓ | — |
| `redemptions.override` (manual exception; reason required) | ✓ | ✓ | — | — | — | ✓ | — |
| `analytics.view_own` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `analytics.view_team` | ✓ | ✓ | ✓ | — | ✓ | ✓ | ✓ |
| `exports.run` | ✓ | ✓ | ✓ | — | — | — | ✓ |
| `audit.view` | ✓ | ✓ | — | — | — | — | — |
| `team.manage_access` (grant sub-roles, invite staff) | ✓ | — | — | — | — | — | — |
| `settings.manage` (category taxonomy: create/rename/merge/retire) | ✓ | ✓ | — | — | — | — | — |

"O (own)" is a **row-level** check: `partner_organisations.ownerUserId === req.user.id`
(or task `assigneeUserId`). Implemented in services, not just middleware.

## 3. Enforcement design

```js
// backend/src/middleware/redeemOpsAuth.js
requireRedeemOps(...caps)   // = authenticateToken →
                            //   role==='admin' → pass (implicit super_admin)
                            //   role==='redeem_ops' || redeemOpsRole set →
                            //     caps ⊆ ROLE_CAPABILITIES[user.redeemOpsRole] → pass
                            //   else 403
```

- `ROLE_CAPABILITIES` lives in `backend/src/services/redeemOps/permissions.js` — single source of
  truth, exported for tests and for the SPA (mirrored constant for nav/UI gating; drift caught by a
  unit test comparing both).
- Row-level "own" checks live in services (`claimService`, `taskService`) so bulk endpoints can't
  bypass them.
- Every route in `ROUTE_MAP.md` names its capability; a route without one fails review.
- Existing MKTR gates are untouched. A `redeem_ops` user hitting `/api/admin/*` fails
  `requireAdmin` exactly as a `customer` would today.
- API-level tests (not nav-hiding) are the acceptance bar — brief §37 "Permissions".

## 4. Audited actions (minimum set → `redeem_ops_audit_events`)

`partner.created / edited / claimed / released / reassigned / restricted / disqualified / merged`,
`stage.changed`, `contact.created / edited`, `activity.edited / voided`, `task.reassigned`,
`pool.created / member_added`, `reward.created / edited / status_changed`, `terms.versioned`,
`inventory.adjusted` (any manual ledger entry), `activation.created / status_changed /
campaign_linked / campaign_unlinked / allocation_changed`, `entitlement.issued_manual / cancelled`,
`redemption.completed / overridden / reversed`, `access.role_granted / revoked`, `export.ran`.

## 5. Future partner-portal scoping (design constraint, not V1 code)

Portal principals get **none** of the capabilities above. Their future namespace
(`/api/partner-portal/*`) authorizes by token scope (`partnerOrgId`) + a tiny portal-role set
(`owner|staff`), and every query is forced through `WHERE partnerOrganisationId = token.partnerOrgId`
(+ location scoping for multi-outlet). The V1 schema already keys all reward/redemption data by
`partnerOrganisationId`, so this is additive. Lead PII is excluded by the
`entitlementService.partnerView()` projection contract (`MKTR_INTEGRATION.md` §4).
