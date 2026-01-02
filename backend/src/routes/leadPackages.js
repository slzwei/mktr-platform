import express from 'express';
import { Op } from 'sequelize';
import { LeadPackage, LeadPackageAssignment, User, Campaign, sequelize } from '../models/index.js';
import { getTenantId } from '../middleware/tenant.js';
import { authenticateToken, requireAgentOrAdmin } from '../middleware/auth.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';

const router = express.Router();

/**
 * @route GET /api/lead-packages
 * @desc Get all lead packages (Templates)
 * @access Admin only (or Agents to view catalog)
 */
router.get('/', authenticateToken, asyncHandler(async (req, res) => {
    const { status, campaignId } = req.query;

    const where = {};
    if (status) where.status = status;
    if (campaignId) where.campaignId = campaignId;

    // If agent, only show active and public packages
    if (req.user.role === 'agent') {
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

    res.json({
        success: true,
        data: { packages }
    });
}));

/**
 * @route POST /api/lead-packages
 * @desc Create a new lead package template
 * @access Admin only
 */
router.post('/', authenticateToken, requireAgentOrAdmin, asyncHandler(async (req, res) => {
    if (req.user.role !== 'admin') {
        throw new AppError('Access denied', 403);
    }

    const { name, price, leadCount, campaignId, type, start_date, end_date } = req.body;

    // Basic validation
    if (!name || price === undefined || price === null || !leadCount || !campaignId) {
        throw new AppError('Missing required fields', 400);
    }

    const pkg = await LeadPackage.create({
        name,
        price,
        leadCount,
        campaignId,
        type: type || 'basic',
        // Add temporary fields if model supports them or ignore if strict
        // Assuming backend model matches the one seen earlier (which didn't have start/end date explicitly unless in JSON/other)
        // Actually the model I saw earlier had `validityPeriod`. `start_date` / `end_date` were in the dialog.
        // For now we map strictly to the model. 
        createdBy: req.user.id,
        status: 'active'
    });

    res.status(201).json({
        success: true,
        data: { package: pkg }
    });
}));

/**
 * @route POST /api/lead-packages/assign
 * @desc Assign a package to an agent
 * @access Admin only
 */
router.post('/assign', authenticateToken, requireAgentOrAdmin, asyncHandler(async (req, res) => {
    if (req.user.role !== 'admin') {
        throw new AppError('Access denied', 403);
    }

    const { agentId, packageId } = req.body;

    if (!agentId || !packageId) {
        throw new AppError('Agent ID and Package ID are required', 400);
    }

    const agent = await User.findByPk(agentId);
    if (!agent) throw new AppError('Agent not found', 404);

    const pkg = await LeadPackage.findByPk(packageId);
    if (!pkg) throw new AppError('Package not found', 404);

    // Snapshot values
    const assignment = await LeadPackageAssignment.create({
        agentId,
        leadPackageId: packageId,
        leadsTotal: pkg.leadCount,
        leadsRemaining: pkg.leadCount,
        priceSnapshot: pkg.price,
        status: 'active',
        purchaseDate: new Date()
    });

    res.status(201).json({
        success: true,
        message: 'Package assigned successfully',
        data: { assignment }
    });
}));

/**
 * @route GET /api/lead-packages/assignments/:agentId
 * @desc Get assignments for a specific agent
 * @access Admin or the Agent themselves
 */
router.get('/assignments/:agentId', authenticateToken, asyncHandler(async (req, res) => {
    const { agentId } = req.params;

    // Authorization check
    if (req.user.role !== 'admin' && req.user.id !== agentId) {
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

    res.json({
        success: true,
        data: { assignments }
    });
}));

/**
 * @route DELETE /api/lead-packages/:id
 * @desc Delete or archive a lead package
 * @access Admin only
 */
router.delete('/:id', authenticateToken, requireAgentOrAdmin, asyncHandler(async (req, res) => {
    if (req.user.role !== 'admin') {
        throw new AppError('Access denied', 403);
    }

    const { id } = req.params;
    const pkg = await LeadPackage.findByPk(id);

    if (!pkg) {
        throw new AppError('Package not found', 404);
    }

    // Check for existing assignments
    const assignmentCount = await LeadPackageAssignment.count({
        where: { leadPackageId: id }
    });

    if (assignmentCount > 0) {
        // Soft delete (archive) if used
        await pkg.update({ status: 'archived' });
        res.json({
            success: true,
            message: 'Package archived (assignments exist)',
            data: { package: pkg }
        });
    } else {
        // Hard delete if unused
        await pkg.destroy();
        res.json({
            success: true,
            message: 'Package deleted successfully'
        });
    }
}));

export default router;
