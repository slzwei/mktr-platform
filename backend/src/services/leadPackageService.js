import { Op } from 'sequelize';
import { LeadPackage, LeadPackageAssignment, User, Campaign, Prospect, sequelize } from '../models/index.js';
import { AppError } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';

/**
 * List lead packages with optional filters.
 * Agents only see active + public packages.
 */
export async function listPackages({ status, campaignId, userRole }) {
  // Hidden wallet containers are managed by the wallet service, never here.
  const where = { kind: { [Op.ne]: 'wallet' } };
  if (status) where.status = status;
  if (campaignId) where.campaignId = campaignId;

  if (userRole === 'agent') {
    where.status = 'active';
    where.isPublic = true;
  }

  const packages = await LeadPackage.findAll({
    where,
    include: [
      {
        model: Campaign,
        as: 'campaign',
        attributes: ['id', 'name', 'status']
      }
    ],
    order: [['createdAt', 'DESC']]
  });

  return { packages };
}

// ── Admin-package field normalizers ──────────────────────────────────────────
// Shared by create + update. `null` clears an optional field; a `0`/absent
// commission means "no commission" (the DTO hides non-positive so it never renders
// a misleading "$0/lead"). Kept module-local + exported for unit tests.
export function normalizeQuality(q) {
  if (q === null || q === undefined || q === '') return null;
  const n = parseInt(q, 10);
  if (!Number.isFinite(n)) return null;
  return Math.min(10, Math.max(1, n));
}
export function normalizeValidity(d) {
  if (d === null || d === undefined || d === '') return null;
  const n = Number(d);
  return Number.isFinite(n) && n >= 1 ? Math.round(n) : null;
}
export function normalizeCommission(c) {
  const n = Number(c);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Create a new lead package template.
 *
 * Backward-compatible with the internal (web) controller, which passes only
 * { name, price, leadCount, campaignId, type, createdBy } — the rest default.
 * The external admin surface (HMAC) passes the full payload incl. the net-new
 * fields. `createdBy` is a non-null FK to users.id — the caller (controller)
 * supplies a concrete id (web: req.user.id; external: resolveCreator). campaignId
 * is now nullable; currency is forced SGD (SG market; non-editable in the UI).
 */
export async function createPackage({
  name, price, leadCount, campaignId = null, type, createdBy,
  status, description, isPublic, qualityScore, validityPeriod, agentCommission,
}) {
  if (!name || price === undefined || price === null || !leadCount) {
    throw new AppError('Missing required fields', 400);
  }
  // createdBy is a non-null FK enforced at the DB + supplied by every caller
  // (web: req.user.id; external: resolveCreator). Kept lenient here — the original
  // contract — so the existing unit tests that omit it stay valid.

  const ALLOWED_CREATE_STATUS = ['draft', 'active', 'inactive'];
  const pkg = await LeadPackage.create({
    name,
    price,
    leadCount,
    campaignId: campaignId ?? null,
    type: type || 'basic',
    createdBy,
    status: ALLOWED_CREATE_STATUS.includes(status) ? status : 'active',
    description: description ?? null,
    isPublic: isPublic === undefined ? true : !!isPublic,
    currency: 'SGD',
    qualityScore: normalizeQuality(qualityScore),
    validityPeriod: normalizeValidity(validityPeriod),
    commissionStructure: { agentCommission: normalizeCommission(agentCommission), referralBonus: 0, tierBonuses: {} },
  });

  return { package: pkg };
}

/**
 * Update a lead package template. Only whitelisted fields are mutable —
 * `id` and `createdBy` are never reassigned. Re-fetches with the campaign
 * association so the response matches the list/get shape the admin UI expects.
 */
export async function updatePackage(id, fields) {
  const pkg = await LeadPackage.findByPk(id);
  if (!pkg) {
    throw new AppError('Package not found', 404);
  }
  rejectWalletPackage(pkg);

  // NOTE: `currency` is deliberately absent — it is forced SGD at create and is
  // never editable (length-only validation on the column would otherwise accept
  // any 3-char string). `campaignId: null` IS honoured (null !== undefined) so the
  // UI's "No campaign" clears it.
  const ALLOWED = ['name', 'description', 'price', 'leadCount', 'campaignId', 'type', 'isPublic', 'status'];
  const updates = {};
  for (const key of ALLOWED) {
    if (fields[key] !== undefined) {
      updates[key] = fields[key];
    }
  }
  // Optional/clearable numeric fields — normalize (null clears).
  if (fields.qualityScore !== undefined) updates.qualityScore = normalizeQuality(fields.qualityScore);
  if (fields.validityPeriod !== undefined) updates.validityPeriod = normalizeValidity(fields.validityPeriod);
  // agentCommission lives inside the commissionStructure JSON — MERGE so a partial
  // update never clobbers referralBonus / tierBonuses.
  if (fields.agentCommission !== undefined) {
    const prev = pkg.commissionStructure || {};
    updates.commissionStructure = { ...prev, agentCommission: normalizeCommission(fields.agentCommission) };
  }

  if (Object.keys(updates).length > 0) {
    await pkg.update(updates);
  }

  const updated = await LeadPackage.findByPk(id, {
    include: [{
      model: Campaign,
      as: 'campaign',
      attributes: ['id', 'name', 'status']
    }]
  });

  return { package: updated };
}

/**
 * Assign a package to an agent. Returns the assignment and data needed for email.
 */
export async function assignPackage({ agentId, packageId }) {
  if (!agentId || !packageId) {
    throw new AppError('Agent ID and Package ID are required', 400);
  }

  const agent = await User.findByPk(agentId);
  if (!agent) throw new AppError('Agent not found', 404);

  const pkg = await LeadPackage.findByPk(packageId, {
    include: [{
      model: Campaign,
      as: 'campaign',
      attributes: ['name']
    }]
  });
  if (!pkg) throw new AppError('Package not found', 404);

  const assignment = await LeadPackageAssignment.create({
    agentId,
    leadPackageId: packageId,
    leadsTotal: pkg.leadCount,
    leadsRemaining: pkg.leadCount,
    priceSnapshot: pkg.price,
    status: 'active',
    purchaseDate: new Date()
  });

  // New funded package → trigger the held-queue sweep for its campaign (async,
  // fire-and-forget). NOTE: auto-release is currently DISABLED (held leads are
  // manual-only) so this sweep no-ops — retained as the hook to re-enable it.
  if (pkg.campaignId) {
    // Dynamic import keeps releaseSweep (and its systemAgent/webhook graph) out of this
    // module's static dependency graph — avoids coupling and keeps unit-test mocks lean.
    import('./releaseSweep.js')
      .then((m) => m.sweepCampaign(pkg.campaignId))
      .catch((err) => logger.error('[ReleaseSweep] assignPackage trigger failed', { error: err?.message || String(err) }));
  }

  return {
    assignment,
    agent,
    packageInfo: {
      name: pkg.name,
      campaignName: pkg.campaign ? pkg.campaign.name : 'N/A',
      leadCount: pkg.leadCount
    }
  };
}

/**
 * Get assignments for a specific agent.
 */
export async function getAgentAssignments({ agentId, requesterId, requesterRole }) {
  logger.info('GET assignments', { agentId, requesterId, requesterRole });

  if (requesterRole !== 'admin' && requesterId !== agentId) {
    logger.error('Access denied for agent assignments', { requesterId, agentId });
    throw new AppError('Access denied', 403);
  }

  const assignments = await LeadPackageAssignment.findAll({
    where: { agentId },
    include: [
      {
        model: LeadPackage,
        as: 'package',
        attributes: ['name', 'description'],
        include: [{
          model: Campaign,
          as: 'campaign',
          attributes: ['id', 'name']
        }]
      }
    ],
    order: [['purchaseDate', 'DESC']]
  });
  logger.info('Found assignments', { count: assignments.length });

  return { assignments };
}

/**
 * External (mktr-leads buyer app) → an agent's OWN lead-package assignments.
 *
 * Self-scoping by design: resolves the agent by `mktrLeadsId` AND `role:'agent'` AND
 * `isActive:true` — the SAME guard as releaseHeldProspect's destination resolver, so a
 * stale / cross-source / non-agent id can never read someone's packages. An unknown or
 * ineligible id returns an empty list (never throws, never leaks existence). Returns a
 * flat, display-ready DTO; the only id exposed is the assignment's own.
 *
 * Called by externalAgentPackagesController (HMAC + AGENT_PACKAGES_EXTERNAL_ENABLED gated).
 */
export async function getExternalAgentPackages(mktrLeadsId) {
  if (!mktrLeadsId || typeof mktrLeadsId !== 'string') return { packages: [] };

  const agent = await User.findOne({
    where: { mktrLeadsId, role: 'agent', isActive: true },
    attributes: ['id']
  });
  if (!agent) return { packages: [] };

  const assignments = await LeadPackageAssignment.findAll({
    // Only states an agent's "My Packages" view should reflect: 'active' = still
    // receivable, 'completed' = ran dry (shown as the OUT-OF-LEADS card — the COUNT,
    // not the enum, drives that on the app side via derivePackageState).
    // 'cancelled'/'expired' are dead — never receivable — so excluding them keeps a
    // stale assignment with leftover credits from inflating the headline.
    // NOTE: do NOT add 'exhausted' here — it is NOT a label in the live enum
    // (enum_lead_package_assignments_status = active|completed|cancelled|expired), so
    // Postgres throws "invalid input value for enum" on the IN-list and the whole
    // query 500s for EVERY agent (this exact bug blanked the screen, fixed 2026-06-27).
    where: { agentId: agent.id, status: ['active', 'completed'] },
    include: [
      {
        model: LeadPackage,
        as: 'package',
        attributes: ['name', 'type', 'qualityScore', 'currency', 'commissionStructure', 'validityPeriod'],
        include: [{ model: Campaign, as: 'campaign', attributes: ['name'] }]
      }
    ],
    order: [['purchaseDate', 'DESC']]
  });

  const packages = assignments.map((a) => {
    const pkg = a.package || null;
    const validityDays = pkg?.validityPeriod ?? null;
    const purchasedAt = a.purchaseDate ? new Date(a.purchaseDate) : null;
    // Expiry is derived, not stored — only when the package carries a validity window.
    const expiresAt =
      purchasedAt && Number.isFinite(validityDays) && validityDays > 0
        ? new Date(purchasedAt.getTime() + validityDays * 86400000).toISOString()
        : null;
    // commissionStructure is JSON ({ agentCommission, ... }), default 0. Pass the agent's
    // per-lead cut through only when it's a positive number — the UI hides it otherwise so
    // a default/absent value never renders as a misleading "$0/lead".
    const agentCommission = pkg?.commissionStructure?.agentCommission;
    return {
      id: a.id,
      name: pkg?.name || 'Lead package',
      type: pkg?.type || null,
      status: a.status,
      leadsRemaining: a.leadsRemaining,
      leadsTotal: a.leadsTotal,
      qualityScore: pkg?.qualityScore ?? null,
      commissionPerLead: typeof agentCommission === 'number' && agentCommission > 0 ? agentCommission : null,
      currency: pkg?.currency || 'USD',
      campaignName: pkg?.campaign?.name || null,
      purchaseDate: purchasedAt ? purchasedAt.toISOString() : null,
      validityDays,
      expiresAt
    };
  });

  return { packages };
}

// ════════════════════════════════════════════════════════════════════════════
// External admin surface (mktr-leads admin app → /api/external/admin-packages).
// HMAC-authed (no JWT user). Catalog ops are GLOBAL (same catalog as the web
// admin, by design). Assignment ops are SCOPED to mktr-leads-sourced agents
// (User.mktrLeadsId NOT NULL) so an mktr-leads admin can never mutate a
// Lyfe/internal assignment by a guessed UUID.
// ════════════════════════════════════════════════════════════════════════════

/**
 * Resolve a non-null `createdBy` (FK → users.id) for an externally-created package.
 * Prefer the acting admin when they're a synced MKTR user (auditable); else a
 * configured system creator. Throws if neither resolves (deploy-inert until set).
 */
export async function resolveCreator(actorMktrUserId) {
  if (actorMktrUserId && typeof actorMktrUserId === 'string') {
    const u = await User.findOne({ where: { mktrLeadsId: actorMktrUserId }, attributes: ['id'] });
    if (u) return u.id;
  }
  const fallback = process.env.ADMIN_PACKAGES_CREATOR_USER_ID;
  if (fallback) return fallback;
  // Last resort: attribute to the oldest active MKTR admin (the web package creator
  // always exists), so catalog.create works even without the env override set.
  const admin = await User.findOne({
    where: { role: 'admin', isActive: true },
    order: [['createdAt', 'ASC']],
    attributes: ['id'],
  });
  if (admin) return admin.id;
  throw new AppError('No package creator available (no actor, env, or admin user)', 500);
}

/** Catalog list for the admin app — full fields + per-package assignmentCount (Archive vs Delete). */
export async function getExternalAdminCatalog() {
  const packages = await LeadPackage.findAll({
    // Wallet containers are not grantable SKUs — hidden from the admin catalog.
    where: { kind: { [Op.ne]: 'wallet' } },
    include: [{ model: Campaign, as: 'campaign', attributes: ['id', 'name', 'status'] }],
    order: [['createdAt', 'DESC']],
  });
  // One grouped COUNT (avoid N+1). `sequelize.fn/col` — the bare `fn` is not imported.
  const counts = await LeadPackageAssignment.findAll({
    attributes: ['leadPackageId', [sequelize.fn('COUNT', sequelize.col('id')), 'n']],
    group: ['leadPackageId'],
    raw: true,
  });
  const countBy = new Map(counts.map((c) => [c.leadPackageId, Number(c.n)]));
  return {
    packages: packages.map((p) => ({
      id: p.id,
      name: p.name,
      type: p.type,
      status: p.status,
      description: p.description ?? null,
      price: Number(p.price),
      leadCount: p.leadCount,
      currency: p.currency || 'SGD',
      qualityScore: p.qualityScore ?? null,
      commissionPerLead:
        typeof p.commissionStructure?.agentCommission === 'number' && p.commissionStructure.agentCommission > 0
          ? p.commissionStructure.agentCommission
          : null,
      validityDays: p.validityPeriod ?? null,
      campaignId: p.campaignId ?? null,
      campaignName: p.campaign?.name ?? null,
      campaignStatus: p.campaign?.status ?? null,
      isPublic: p.isPublic,
      assignmentCount: countBy.get(p.id) ?? 0,
    })),
  };
}

/** Campaign picker for the create/edit form — active campaigns + (when editing) the still-selected one. */
export async function listCampaignsForPicker(selectedId) {
  const active = await Campaign.findAll({
    where: { is_active: true },
    attributes: ['id', 'name', 'status'],
    order: [['name', 'ASC']],
  });
  const out = active.map((c) => ({ id: c.id, name: c.name, status: c.status }));
  if (selectedId && !out.some((c) => c.id === selectedId)) {
    const sel = await Campaign.findByPk(selectedId, { attributes: ['id', 'name', 'status'] });
    if (sel) out.unshift({ id: sel.id, name: sel.name, status: sel.status });
  }
  return { campaigns: out };
}

/**
 * One mktr-leads agent's assignments for the admin per-agent screen. Self-scoped
 * resolution (mktrLeadsId + role:'agent' + isActive) like getExternalAgentPackages,
 * but returns ALL four statuses (so the app groups Past), adds priceSnapshot, and
 * caps at 100 newest (cancelled history is unbounded). No agent identity — the app
 * already holds the AgentRow locally.
 */
export async function getExternalAdminAgentAssignments(mktrLeadsId) {
  if (!mktrLeadsId || typeof mktrLeadsId !== 'string') return { packages: [] };
  const agent = await User.findOne({ where: { mktrLeadsId, role: 'agent', isActive: true }, attributes: ['id'] });
  if (!agent) return { packages: [] };

  const assignments = await LeadPackageAssignment.findAll({
    where: { agentId: agent.id },
    include: [
      {
        model: LeadPackage,
        as: 'package',
        attributes: ['name', 'type', 'qualityScore', 'currency', 'commissionStructure', 'validityPeriod'],
        include: [{ model: Campaign, as: 'campaign', attributes: ['name'] }],
      },
    ],
    order: [['purchaseDate', 'DESC']],
    limit: 100,
  });

  const packages = assignments.map((a) => {
    const pkg = a.package || null;
    const validityDays = pkg?.validityPeriod ?? null;
    const purchasedAt = a.purchaseDate ? new Date(a.purchaseDate) : null;
    const expiresAt =
      purchasedAt && Number.isFinite(validityDays) && validityDays > 0
        ? new Date(purchasedAt.getTime() + validityDays * 86400000).toISOString()
        : null;
    const agentCommission = pkg?.commissionStructure?.agentCommission;
    return {
      id: a.id,
      name: pkg?.name || 'Lead package',
      type: pkg?.type || null,
      status: a.status,
      leadsRemaining: a.leadsRemaining,
      leadsTotal: a.leadsTotal,
      qualityScore: pkg?.qualityScore ?? null,
      commissionPerLead: typeof agentCommission === 'number' && agentCommission > 0 ? agentCommission : null,
      currency: pkg?.currency || 'SGD',
      campaignName: pkg?.campaign?.name || null,
      purchaseDate: purchasedAt ? purchasedAt.toISOString() : null,
      validityDays,
      expiresAt,
      priceSnapshot: a.priceSnapshot != null ? Number(a.priceSnapshot) : null,
    };
  });
  return { packages };
}

/** Load an assignment ONLY if its agent is mktr-leads-sourced (write-scope guard). */
async function loadMktrLeadsAssignment(assignmentId) {
  if (!assignmentId || typeof assignmentId !== 'string') return null;
  return LeadPackageAssignment.findOne({
    where: { id: assignmentId },
    include: [
      {
        model: User,
        as: 'agent',
        attributes: ['id', 'mktrLeadsId'],
        where: { mktrLeadsId: { [Op.ne]: null } },
        required: true,
      },
    ],
  });
}

/**
 * Wallet commitments are PAID financial records with their own lifecycle
 * (walletService: debit at commit, refund only on campaign takedown). No
 * generic package-admin mutation may touch them — inflating, cancelling,
 * moving or destroying one corrupts the ledger's audit trail.
 */
function rejectWalletAssignment(assignment) {
  if (assignment?.source === 'wallet') {
    throw new AppError('Wallet commitments cannot be modified here — they resolve only by delivery or campaign takedown.', 409);
  }
}

function rejectWalletPackage(pkg) {
  if (pkg?.kind === 'wallet') {
    throw new AppError('This is a hidden wallet-commitment container managed by the wallet service — it cannot be edited or deleted.', 409);
  }
}

/**
 * Assign an ACTIVE catalog package to a mktr-leads agent. Active-only guard +
 * duplicate guard under the same per-package advisory lock bulkAssignPackage uses
 * (no unique (agentId,leadPackageId) index). Optional custom leadsTotal override.
 * Returns a typed status: assigned | exists | package_inactive | invalid_agent.
 */
export async function assignPackageExternal({ agentMktrUserId, packageId, leadsTotalOverride }) {
  if (!agentMktrUserId || !packageId) throw new AppError('agentMktrUserId and packageId are required', 400);

  const agent = await User.findOne({
    where: { mktrLeadsId: agentMktrUserId, role: 'agent', isActive: true },
    attributes: ['id'],
  });
  if (!agent) return { status: 'invalid_agent' };

  const pkg = await LeadPackage.findByPk(packageId);
  if (!pkg) throw new AppError('Package not found', 404);
  if (pkg.status !== 'active') return { status: 'package_inactive' };

  const result = await sequelize.transaction(async (t) => {
    await sequelize.query('SELECT pg_advisory_xact_lock(hashtext(:k))', {
      replacements: { k: `lpa:${packageId}` },
      transaction: t,
    });
    const existing = await LeadPackageAssignment.findOne({
      where: { leadPackageId: packageId, agentId: agent.id, status: 'active' },
      transaction: t,
    });
    if (existing) return { status: 'exists', assignmentId: existing.id };

    const override = Number(leadsTotalOverride);
    const total = Number.isFinite(override) && override >= 1 ? Math.round(override) : pkg.leadCount;
    const a = await LeadPackageAssignment.create(
      {
        agentId: agent.id,
        leadPackageId: packageId,
        leadsTotal: total,
        leadsRemaining: total,
        priceSnapshot: pkg.price,
        status: 'active',
        purchaseDate: new Date(),
      },
      { transaction: t }
    );
    return { status: 'assigned', assignmentId: a.id };
  });

  // New funded package → campaign sweep (no-op today; retained as the re-enable hook).
  if (result.status === 'assigned' && pkg.campaignId) {
    import('./releaseSweep.js')
      .then((m) => m.sweepCampaign(pkg.campaignId))
      .catch((err) => logger.error('[ReleaseSweep] assignPackageExternal trigger failed', { error: err?.message || String(err) }));
  }
  return result;
}

/**
 * Top up an assignment. Delta ("add N") increments BOTH leadsRemaining and
 * leadsTotal (so the ratio never exceeds 100% — fixes the 150/100 bug). An
 * advanced absolute `setRemaining` correction is also supported. Never resurrects
 * a cancelled/expired row.
 */
export async function topUpAssignment({ assignmentId, addLeads, setRemaining }) {
  const a = await loadMktrLeadsAssignment(assignmentId);
  if (!a) throw new AppError('Assignment not found', 404);
  rejectWalletAssignment(a);
  if (a.status !== 'active' && a.status !== 'completed') {
    throw new AppError('Cannot modify a cancelled or expired assignment', 409);
  }

  const prevRemaining = a.leadsRemaining;
  if (setRemaining !== undefined) {
    const n = parseInt(setRemaining, 10);
    if (isNaN(n) || n < 0) throw new AppError('Invalid lead count', 400);
    await a.update({ leadsRemaining: n, status: n === 0 ? 'completed' : 'active' });
  } else {
    const add = parseInt(addLeads, 10);
    if (isNaN(add) || add < 1) throw new AppError('Invalid amount', 400);
    await a.update({ leadsRemaining: a.leadsRemaining + add, leadsTotal: a.leadsTotal + add, status: 'active' });
  }

  if (a.leadsRemaining > prevRemaining) {
    const pkg = await LeadPackage.findByPk(a.leadPackageId, { attributes: ['campaignId'] });
    if (pkg?.campaignId) {
      import('./releaseSweep.js')
        .then((m) => m.sweepCampaign(pkg.campaignId))
        .catch((err) => logger.error('[ReleaseSweep] topUpAssignment trigger failed', { error: err?.message || String(err) }));
    }
  }
  return { assignment: a };
}

/** Cancel an assignment → status:'cancelled' (preferred stop; preserves row + history). Idempotent. */
export async function cancelAssignment(assignmentId) {
  const a = await loadMktrLeadsAssignment(assignmentId);
  if (!a) throw new AppError('Assignment not found', 404);
  rejectWalletAssignment(a);
  if (a.status === 'cancelled') return { assignment: a };
  await a.update({ status: 'cancelled' });
  return { assignment: a };
}

/** Remove an assignment → destroys the row (history lost). Scoped to mktr-leads agents. */
export async function removeAssignmentExternal(assignmentId) {
  const a = await loadMktrLeadsAssignment(assignmentId);
  if (!a) throw new AppError('Assignment not found', 404);
  rejectWalletAssignment(a);
  await a.destroy();
  return { ok: true };
}

/**
 * Delete a package assignment by ID.
 */
export async function deleteAssignment(id) {
  const assignment = await LeadPackageAssignment.findByPk(id);
  if (!assignment) {
    throw new AppError('Assignment not found', 404);
  }
  rejectWalletAssignment(assignment);

  await assignment.destroy();
}

/**
 * Update a package assignment (e.g. leadsRemaining).
 */
export async function updateAssignment(id, { leadsRemaining }) {
  const assignment = await LeadPackageAssignment.findByPk(id);
  if (!assignment) {
    throw new AppError('Assignment not found', 404);
  }
  rejectWalletAssignment(assignment);

  if (leadsRemaining !== undefined) {
    const newCount = parseInt(leadsRemaining, 10);
    if (isNaN(newCount) || newCount < 0) {
      throw new AppError('Invalid lead count', 400);
    }

    const prevCount = assignment.leadsRemaining;
    await assignment.update({
      leadsRemaining: newCount,
      // 'completed' is the terminal "no credits left" status used everywhere else
      // (leadCredits.js natural drain). 'exhausted' is NOT in the live Postgres enum
      // (enum_lead_package_assignments_status) so writing it throws a DatabaseError.
      status: newCount === 0 ? 'completed' : 'active'
    });

    // Top-up (credits increased) → trigger the held-queue sweep for this campaign.
    // NOTE: auto-release is DISABLED (held leads are manual-only) — this sweep no-ops today.
    if (newCount > prevCount) {
      const pkg = await LeadPackage.findByPk(assignment.leadPackageId, { attributes: ['campaignId'] });
      if (pkg?.campaignId) {
        import('./releaseSweep.js')
          .then((m) => m.sweepCampaign(pkg.campaignId))
          .catch((err) => logger.error('[ReleaseSweep] updateAssignment trigger failed', { error: err?.message || String(err) }));
      }
    }
  }

  return { assignment };
}

/**
 * Delete or archive a lead package. Archives if assignments exist.
 */
export async function deletePackage(id) {
  const pkg = await LeadPackage.findByPk(id);
  if (!pkg) {
    throw new AppError('Package not found', 404);
  }
  rejectWalletPackage(pkg);

  const assignmentCount = await LeadPackageAssignment.count({
    where: { leadPackageId: id }
  });

  if (assignmentCount > 0) {
    await pkg.update({ status: 'archived' });
    return {
      archived: true,
      assignmentCount,
      message: 'Package archived (assignments exist)',
      package: pkg
    };
  } else {
    await pkg.destroy();
    return {
      archived: false,
      assignmentCount: 0,
      message: 'Package deleted successfully'
    };
  }
}

/** Live assignment count for a package — drives the UI's Archive-vs-Delete label (A10). */
export async function getPackageAssignmentCount(id) {
  return LeadPackageAssignment.count({ where: { leadPackageId: id } });
}

/**
 * Pure aggregation of active package assignments into per-agent delivery-pool
 * rows (sum remaining credits, list assignments, track last assignment). Kept
 * pure + exported so it unit-tests without a DB. Accepts Sequelize instances or
 * plain objects (reads `.agent`, `.leadsRemaining`, `.leadPackageId`, etc.).
 */
export function aggregateDeliveryPoolAgents(assignments = []) {
  const byAgent = new Map();
  for (const a of assignments) {
    const agent = a.agent;
    if (!agent) continue;
    const entry = byAgent.get(agent.id) || {
      agentId: agent.id,
      fullName: agent.fullName || `${agent.firstName || ''} ${agent.lastName || ''}`.trim() || null,
      email: agent.email || null,
      phone: agent.phone || null,
      remainingCredits: 0,
      lastPackageAssignedAt: null,
      assignments: [],
    };
    entry.remainingCredits += a.leadsRemaining;
    entry.assignments.push({
      id: a.id,
      packageId: a.leadPackageId,
      packageName: a.package?.name || null,
      leadsRemaining: a.leadsRemaining,
      leadsTotal: a.leadsTotal,
      purchaseDate: a.purchaseDate,
    });
    if (!entry.lastPackageAssignedAt || new Date(a.purchaseDate) > new Date(entry.lastPackageAssignedAt)) {
      entry.lastPackageAssignedAt = a.purchaseDate;
    }
    byAgent.set(agent.id, entry);
  }
  return [...byAgent.values()];
}

/**
 * Campaign-first delivery pool: the agents actually in this campaign's lead
 * round-robin, with remaining credits. Mirrors the live routing pool
 * (systemAgent.resolveLeadRouting step 4 / campaignReadinessService): active
 * LeadPackageAssignments for packages whose campaignId = :campaignId, restricted
 * to active role:'agent' users. NOT CampaignAgentAssignment (which the router
 * never consults).
 */
export async function getCampaignDeliveryPool(campaignId) {
  const campaign = await Campaign.findByPk(campaignId, {
    attributes: ['id', 'name', 'is_active', 'status', 'enforceLeadQuota'],
  });
  if (!campaign) throw new AppError('Campaign not found', 404);

  const packages = await LeadPackage.findAll({
    where: { campaignId },
    attributes: ['id', 'name', 'leadCount', 'price', 'status'],
    order: [['createdAt', 'DESC']],
  });
  const packageIds = packages.map((p) => p.id);

  let agents = [];
  if (packageIds.length > 0) {
    const assignments = await LeadPackageAssignment.findAll({
      where: { leadPackageId: { [Op.in]: packageIds }, status: 'active' },
      include: [
        {
          model: User,
          as: 'agent',
          where: { role: 'agent', isActive: true },
          required: true,
          attributes: ['id', 'firstName', 'lastName', 'fullName', 'email', 'phone'],
        },
        { model: LeadPackage, as: 'package', attributes: ['id', 'name'] },
      ],
      order: [['purchaseDate', 'DESC']],
    });

    agents = aggregateDeliveryPoolAgents(assignments);
  }

  const remainingCredits = agents.reduce((sum, ag) => sum + ag.remainingCredits, 0);
  const fundedAgents = agents.filter((a) => a.remainingCredits > 0).length;

  // Internally-releasable holds only — external-buyer holds
  // (no_funded_external_buyer) must never release to Lyfe, so they don't count
  // toward this internal delivery pool.
  const heldLeads = await Prospect.count({
    where: { campaignId, quarantinedAt: { [Op.ne]: null }, quarantineReason: 'no_funded_agent' },
  });

  return {
    campaign: {
      id: campaign.id,
      name: campaign.name,
      is_active: campaign.is_active,
      status: campaign.status,
      enforceLeadQuota: campaign.enforceLeadQuota,
    },
    totals: { fundedAgents, remainingCredits, heldLeads },
    packages: packages.map((p) => p.toJSON()),
    agents,
  };
}

/**
 * Bulk-assign one campaign package to many agents (campaign-first funding).
 * Race-safe: a per-package advisory xact lock serializes concurrent admin
 * assigns so the skip-existing read + insert can't duplicate active assignments
 * (no unique (agentId,leadPackageId) index exists). Idempotent — agents already
 * holding an active assignment for this package are skipped, not duplicated.
 * Fires exactly ONE releaseSweep after commit (not per agent).
 */
export async function bulkAssignPackage({ campaignId, packageId, agentIds }) {
  if (!campaignId || !packageId || !Array.isArray(agentIds) || agentIds.length === 0) {
    throw new AppError('campaignId, packageId and a non-empty agentIds array are required', 400);
  }
  const uniqueAgentIds = [...new Set(agentIds)];

  const pkg = await LeadPackage.findByPk(packageId);
  if (!pkg) throw new AppError('Package not found', 404);
  if (String(pkg.campaignId) !== String(campaignId)) {
    throw new AppError('Package does not belong to this campaign', 400);
  }

  const validAgents = await User.findAll({
    where: { id: { [Op.in]: uniqueAgentIds }, role: 'agent', isActive: true },
    attributes: ['id'],
  });
  const validIds = validAgents.map((a) => a.id);
  const invalid = uniqueAgentIds.filter((id) => !validIds.includes(id));

  let assignedIds = [];
  let skipped = [];
  if (validIds.length > 0) {
    await sequelize.transaction(async (t) => {
      await sequelize.query('SELECT pg_advisory_xact_lock(hashtext(:k))', {
        replacements: { k: `lpa:${packageId}` },
        transaction: t,
      });

      const existing = await LeadPackageAssignment.findAll({
        where: { leadPackageId: packageId, agentId: { [Op.in]: validIds }, status: 'active' },
        attributes: ['agentId'],
        transaction: t,
      });
      const existingIds = new Set(existing.map((e) => e.agentId));
      skipped = validIds.filter((id) => existingIds.has(id));
      assignedIds = validIds.filter((id) => !existingIds.has(id));

      if (assignedIds.length > 0) {
        await LeadPackageAssignment.bulkCreate(
          assignedIds.map((agentId) => ({
            agentId,
            leadPackageId: packageId,
            leadsTotal: pkg.leadCount,
            leadsRemaining: pkg.leadCount,
            priceSnapshot: pkg.price,
            status: 'active',
            purchaseDate: new Date(),
          })),
          { transaction: t }
        );
      }
    });
  }

  if (assignedIds.length > 0 && pkg.campaignId) {
    import('./releaseSweep.js')
      .then((m) => m.sweepCampaign(pkg.campaignId))
      .catch((err) => logger.error('[ReleaseSweep] bulkAssignPackage trigger failed', { error: err?.message || String(err) }));
  }

  return {
    assigned: assignedIds.length,
    assignedAgentIds: assignedIds,
    skipped,
    invalid,
    leadsPerAgent: pkg.leadCount,
    packageName: pkg.name,
  };
}
