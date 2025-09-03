import express from 'express';
import { Op } from 'sequelize';
import { FleetOwner, Car, User, sequelize } from '../models/index.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import { validate, schemas } from '../middleware/validation.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';

const router = express.Router();

// Fleet Owners Routes
router.get('/owners', authenticateToken, asyncHandler(async (req, res) => {
  const { page = 1, limit = 50, search } = req.query;
  const offset = (page - 1) * limit;

  const whereConditions = {};
  
  if (search) {
    whereConditions[Op.or] = [
      { full_name: { [Op.iLike]: `%${search}%` } },
      { email: { [Op.iLike]: `%${search}%` } },
      { company_name: { [Op.iLike]: `%${search}%` } }
    ];
  }

  const { count, rows: fleetOwners } = await FleetOwner.findAndCountAll({
    where: whereConditions,
    limit: parseInt(limit),
    offset: parseInt(offset),
    order: [['createdAt', 'DESC']]
  });

  res.json({
    success: true,
    data: {
      fleetOwners,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(count / limit),
        totalItems: count,
        itemsPerPage: parseInt(limit)
      }
    }
  });
}));

// Create fleet owner
router.post('/owners', authenticateToken, requireAdmin, validate(schemas.fleetOwnerCreate), asyncHandler(async (req, res) => {
  const fleetOwner = await FleetOwner.create(req.body);

  res.status(201).json({
    success: true,
    message: 'Fleet owner created successfully',
    data: { fleetOwner }
  });
}));

// Get fleet owner by ID
router.get('/owners/:id', authenticateToken, asyncHandler(async (req, res) => {
  const { id } = req.params;
  
  const fleetOwner = await FleetOwner.findByPk(id);

  if (!fleetOwner) {
    throw new AppError('Fleet owner not found', 404);
  }

  res.json({
    success: true,
    data: { fleetOwner }
  });
}));

// Update fleet owner
router.put('/owners/:id', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  
  const fleetOwner = await FleetOwner.findByPk(id);
  
  if (!fleetOwner) {
    throw new AppError('Fleet owner not found', 404);
  }

  await fleetOwner.update(req.body);

  res.json({
    success: true,
    message: 'Fleet owner updated successfully',
    data: { fleetOwner }
  });
}));

// Delete fleet owner
router.delete('/owners/:id', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  
  const fleetOwner = await FleetOwner.findByPk(id);
  
  if (!fleetOwner) {
    throw new AppError('Fleet owner not found', 404);
  }

  // Check if fleet owner has cars
  const carCount = await Car.count({ where: { fleet_owner_id: id } });
  if (carCount > 0) {
    throw new AppError('Cannot delete fleet owner with assigned vehicles', 400);
  }

  await fleetOwner.destroy();

  res.json({
    success: true,
    message: 'Fleet owner deleted successfully'
  });
}));

// Cars Routes
router.get('/cars', authenticateToken, asyncHandler(async (req, res) => {
  const { page = 1, limit = 50, status, fleet_owner_id, search } = req.query;
  const offset = (page - 1) * limit;

  const whereConditions = {};
  
  if (status) {
    whereConditions.status = status;
  }
  
  if (fleet_owner_id) {
    whereConditions.fleet_owner_id = fleet_owner_id;
  }
  
  if (search) {
    whereConditions[Op.or] = [
      { make: { [Op.iLike]: `%${search}%` } },
      { model: { [Op.iLike]: `%${search}%` } },
      { plate_number: { [Op.iLike]: `%${search}%` } }
    ];
  }

  const { count, rows: cars } = await Car.findAndCountAll({
    where: whereConditions,
    limit: parseInt(limit),
    offset: parseInt(offset),
    order: [['createdAt', 'DESC']],
    include: [
      {
        model: FleetOwner,
        as: 'fleetOwner',
        attributes: ['id', 'full_name', 'company_name']
      },
      {
        model: User,
        as: 'currentDriver',
        attributes: ['id', 'firstName', 'lastName', 'email']
      }
    ]
  });

  res.json({
    success: true,
    data: {
      cars,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(count / limit),
        totalItems: count,
        itemsPerPage: parseInt(limit)
      }
    }
  });
}));

// Create new car
router.post('/cars', authenticateToken, validate(schemas.carCreate), asyncHandler(async (req, res) => {
  // Validate fleet owner exists
  if (req.body.fleet_owner_id) {
    const fleetOwner = await FleetOwner.findByPk(req.body.fleet_owner_id);
    if (!fleetOwner) {
      throw new AppError('Fleet owner not found', 404);
    }
  }

  const car = await Car.create(req.body);

  res.status(201).json({
    success: true,
    message: 'Car created successfully',
    data: { car }
  });
}));

// Get car by ID
router.get('/cars/:id', authenticateToken, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const car = await Car.findByPk(id, {
    include: [
      {
        model: FleetOwner,
        as: 'fleetOwner',
        attributes: ['id', 'full_name', 'company_name']
      },
      {
        model: User,
        as: 'currentDriver',
        attributes: ['id', 'firstName', 'lastName', 'email']
      }
    ]
  });

  if (!car) {
    throw new AppError('Car not found', 404);
  }

  res.json({
    success: true,
    data: { car }
  });
}));

// Update car
router.put('/cars/:id', authenticateToken, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const car = await Car.findByPk(id);
  
  if (!car) {
    throw new AppError('Car not found', 404);
  }

  // Validate fleet owner exists if being updated
  if (req.body.fleet_owner_id && req.body.fleet_owner_id !== car.fleet_owner_id) {
    const fleetOwner = await FleetOwner.findByPk(req.body.fleet_owner_id);
    if (!fleetOwner) {
      throw new AppError('Fleet owner not found', 404);
    }
  }

  // Validate driver exists if being assigned
  if (req.body.current_driver_id) {
    const driver = await User.findOne({
      where: {
        id: req.body.current_driver_id,
        role: 'driver_partner'
      }
    });
    if (!driver) {
      throw new AppError('Driver not found', 404);
    }
  }

  await car.update(req.body);

  res.json({
    success: true,
    message: 'Car updated successfully',
    data: { car }
  });
}));

// Delete car
router.delete('/cars/:id', authenticateToken, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const car = await Car.findByPk(id);
  
  if (!car) {
    throw new AppError('Car not found', 404);
  }

  await car.destroy();

  res.json({
    success: true,
    message: 'Car deleted successfully'
  });
}));

// Assign driver to car
router.patch('/cars/:id/assign-driver', authenticateToken, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { driverId } = req.body;

  const car = await Car.findByPk(id);
  
  if (!car) {
    throw new AppError('Car not found', 404);
  }

  // Validate driver exists if assigning
  if (driverId) {
    const driver = await User.findOne({
      where: {
        id: driverId,
        role: 'driver_partner'
      }
    });

    if (!driver) {
      throw new AppError('Driver not found or not available', 404);
    }
  }

  const updateData = {
    current_driver_id: driverId || null,
    assignment_start: driverId ? new Date() : null,
    assignment_end: driverId ? null : new Date()
  };

  await car.update(updateData);

  res.json({
    success: true,
    message: driverId ? 'Driver assigned successfully' : 'Driver unassigned successfully',
    data: { car }
  });
}));

// Fleet statistics
router.get('/stats/overview', authenticateToken, asyncHandler(async (req, res) => {
  const totalCars = await Car.count();
  const activeCars = await Car.count({ where: { status: 'active' } });
  const assignedCars = await Car.count({ where: { current_driver_id: { [Op.not]: null } } });
  const totalFleetOwners = await FleetOwner.count();
  const totalDrivers = await User.count({ where: { role: 'driver_partner' } });

  const carsByStatus = await Car.findAll({
    attributes: [
      'status',
      [sequelize.fn('COUNT', sequelize.col('status')), 'count']
    ],
    group: ['status']
  });

  res.json({
    success: true,
    data: {
      totalCars,
      activeCars,
      assignedCars,
      availableCars: totalCars - assignedCars,
      totalFleetOwners,
      totalDrivers,
      utilizationRate: totalCars > 0 ? ((assignedCars / totalCars) * 100).toFixed(2) : 0,
      carsByStatus: carsByStatus.map(item => ({
        status: item.status,
        count: parseInt(item.dataValues.count)
      }))
    }
  });
}));

export default router;