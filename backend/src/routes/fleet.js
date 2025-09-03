import express from 'express';
import { Op } from 'sequelize';
import { FleetOwner, Driver, Car, User, sequelize } from '../models/index.js';
import { authenticateToken, requireAdmin, requireFleetOwnerOrAdmin } from '../middleware/auth.js';
import { validate, schemas } from '../middleware/validation.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';

const router = express.Router();

// Fleet Owners Routes
router.get('/owners', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, status, businessType, search } = req.query;
  const offset = (page - 1) * limit;

  const whereConditions = {};
  
  if (status) {
    whereConditions.status = status;
  }
  
  if (businessType) {
    whereConditions.businessType = businessType;
  }
  
  if (search) {
    whereConditions[Op.or] = [
      { companyName: { [Op.iLike]: `%${search}%` } },
      { businessLicense: { [Op.iLike]: `%${search}%` } }
    ];
  }

  const { count, rows: fleetOwners } = await FleetOwner.findAndCountAll({
    where: whereConditions,
    limit: parseInt(limit),
    offset: parseInt(offset),
    order: [['createdAt', 'DESC']],
    include: [
      {
        association: 'user',
        attributes: ['id', 'firstName', 'lastName', 'email', 'phone']
      },
      {
        association: 'cars',
        attributes: ['id', 'make', 'model', 'status']
      },
      {
        association: 'drivers',
        attributes: ['id', 'licenseNumber', 'status']
      }
    ]
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

// Create fleet owner profile
router.post('/owners', authenticateToken, validate(schemas.fleetOwnerCreate), asyncHandler(async (req, res) => {
  // Check if user already has a fleet owner profile
  const existingProfile = await FleetOwner.findOne({
    where: { userId: req.user.id }
  });

  if (existingProfile) {
    throw new AppError('Fleet owner profile already exists', 400);
  }

  const fleetOwner = await FleetOwner.create({
    ...req.body,
    userId: req.user.id
  });

  // Update user role if not already set
  if (req.user.role !== 'fleet_owner') {
    await req.user.update({ role: 'fleet_owner' });
  }

  res.status(201).json({
    success: true,
    message: 'Fleet owner profile created successfully',
    data: { fleetOwner }
  });
}));

// Get fleet owner by ID
router.get('/owners/:id', authenticateToken, asyncHandler(async (req, res) => {
  const { id } = req.params;
  
  const whereConditions = { id };
  
  // Non-admin users can only see their own profile
  if (req.user.role !== 'admin') {
    whereConditions.userId = req.user.id;
  }

  const fleetOwner = await FleetOwner.findOne({
    where: whereConditions,
    include: [
      {
        association: 'user',
        attributes: ['id', 'firstName', 'lastName', 'email', 'phone']
      },
      {
        association: 'cars',
        include: [
          {
            association: 'currentDriver',
            include: [{ association: 'user', attributes: ['firstName', 'lastName'] }]
          }
        ]
      },
      {
        association: 'drivers',
        include: [
          { association: 'user', attributes: ['firstName', 'lastName', 'email'] }
        ]
      }
    ]
  });

  if (!fleetOwner) {
    throw new AppError('Fleet owner not found or access denied', 404);
  }

  res.json({
    success: true,
    data: { fleetOwner }
  });
}));

// Update fleet owner
router.put('/owners/:id', authenticateToken, requireFleetOwnerOrAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  
  const whereConditions = { id };
  
  // Non-admin users can only update their own profile
  if (req.user.role !== 'admin') {
    whereConditions.userId = req.user.id;
  }

  const fleetOwner = await FleetOwner.findOne({ where: whereConditions });
  
  if (!fleetOwner) {
    throw new AppError('Fleet owner not found or access denied', 404);
  }

  await fleetOwner.update(req.body);

  res.json({
    success: true,
    message: 'Fleet owner updated successfully',
    data: { fleetOwner }
  });
}));

// Cars Routes
router.get('/cars', authenticateToken, asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, status, type, fleetOwnerId, search } = req.query;
  const offset = (page - 1) * limit;

  const whereConditions = {};
  
  // Non-admin users can only see their own cars
  if (req.user.role === 'fleet_owner') {
    const fleetOwner = await FleetOwner.findOne({ where: { userId: req.user.id } });
    if (fleetOwner) {
      whereConditions.fleetOwnerId = fleetOwner.id;
    }
  } else if (req.user.role !== 'admin') {
    // Other roles see no cars or implement specific logic
    whereConditions.id = null;
  }
  
  if (status) {
    whereConditions.status = status;
  }
  
  if (type) {
    whereConditions.type = type;
  }
  
  if (fleetOwnerId && req.user.role === 'admin') {
    whereConditions.fleetOwnerId = fleetOwnerId;
  }
  
  if (search) {
    whereConditions[Op.or] = [
      { make: { [Op.iLike]: `%${search}%` } },
      { model: { [Op.iLike]: `%${search}%` } },
      { licensePlate: { [Op.iLike]: `%${search}%` } }
    ];
  }

  const { count, rows: cars } = await Car.findAndCountAll({
    where: whereConditions,
    limit: parseInt(limit),
    offset: parseInt(offset),
    order: [['createdAt', 'DESC']],
    include: [
      {
        association: 'fleetOwner',
        attributes: ['id', 'companyName'],
        include: [{ association: 'user', attributes: ['firstName', 'lastName'] }]
      },
      {
        association: 'currentDriver',
        attributes: ['id', 'licenseNumber'],
        include: [{ association: 'user', attributes: ['firstName', 'lastName'] }]
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
router.post('/cars', authenticateToken, requireFleetOwnerOrAdmin, validate(schemas.carCreate), asyncHandler(async (req, res) => {
  let fleetOwnerId = req.body.fleetOwnerId;
  
  // If not admin, use the requesting user's fleet owner profile
  if (req.user.role !== 'admin') {
    const fleetOwner = await FleetOwner.findOne({ where: { userId: req.user.id } });
    if (!fleetOwner) {
      throw new AppError('Fleet owner profile not found', 404);
    }
    fleetOwnerId = fleetOwner.id;
  }

  const car = await Car.create({
    ...req.body,
    fleetOwnerId
  });

  // Update fleet owner's fleet size
  const fleetOwner = await FleetOwner.findByPk(fleetOwnerId);
  if (fleetOwner) {
    await fleetOwner.update({
      fleetSize: fleetOwner.fleetSize + 1,
      activeVehicles: car.status === 'active' ? fleetOwner.activeVehicles + 1 : fleetOwner.activeVehicles
    });
  }

  res.status(201).json({
    success: true,
    message: 'Car created successfully',
    data: { car }
  });
}));

// Get car by ID
router.get('/cars/:id', authenticateToken, asyncHandler(async (req, res) => {
  const { id } = req.params;
  
  const whereConditions = { id };
  
  // Non-admin users can only see their own cars
  if (req.user.role === 'fleet_owner') {
    const fleetOwner = await FleetOwner.findOne({ where: { userId: req.user.id } });
    if (fleetOwner) {
      whereConditions.fleetOwnerId = fleetOwner.id;
    }
  }

  const car = await Car.findOne({
    where: whereConditions,
    include: [
      {
        association: 'fleetOwner',
        include: [{ association: 'user', attributes: ['firstName', 'lastName', 'email'] }]
      },
      {
        association: 'currentDriver',
        include: [{ association: 'user', attributes: ['firstName', 'lastName', 'email'] }]
      },
      {
        association: 'qrTags',
        attributes: ['id', 'name', 'type', 'status', 'scanCount']
      }
    ]
  });

  if (!car) {
    throw new AppError('Car not found or access denied', 404);
  }

  res.json({
    success: true,
    data: { car }
  });
}));

// Update car
router.put('/cars/:id', authenticateToken, requireFleetOwnerOrAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  
  const whereConditions = { id };
  
  // Non-admin users can only update their own cars
  if (req.user.role !== 'admin') {
    const fleetOwner = await FleetOwner.findOne({ where: { userId: req.user.id } });
    if (fleetOwner) {
      whereConditions.fleetOwnerId = fleetOwner.id;
    }
  }

  const car = await Car.findOne({ where: whereConditions });
  
  if (!car) {
    throw new AppError('Car not found or access denied', 404);
  }

  const oldStatus = car.status;
  await car.update(req.body);

  // Update fleet owner's active vehicles count if status changed
  if (oldStatus !== req.body.status && req.body.status) {
    const fleetOwner = await FleetOwner.findByPk(car.fleetOwnerId);
    if (fleetOwner) {
      let activeChange = 0;
      if (oldStatus !== 'active' && req.body.status === 'active') {
        activeChange = 1;
      } else if (oldStatus === 'active' && req.body.status !== 'active') {
        activeChange = -1;
      }
      
      if (activeChange !== 0) {
        await fleetOwner.update({
          activeVehicles: Math.max(0, fleetOwner.activeVehicles + activeChange)
        });
      }
    }
  }

  res.json({
    success: true,
    message: 'Car updated successfully',
    data: { car }
  });
}));

// Assign driver to car
router.patch('/cars/:id/assign-driver', authenticateToken, requireFleetOwnerOrAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { driverId } = req.body;

  const whereConditions = { id };
  
  // Non-admin users can only assign drivers to their own cars
  if (req.user.role !== 'admin') {
    const fleetOwner = await FleetOwner.findOne({ where: { userId: req.user.id } });
    if (fleetOwner) {
      whereConditions.fleetOwnerId = fleetOwner.id;
    }
  }

  const car = await Car.findOne({ where: whereConditions });
  
  if (!car) {
    throw new AppError('Car not found or access denied', 404);
  }

  // Verify driver belongs to the same fleet owner
  if (driverId) {
    const driver = await Driver.findOne({
      where: {
        id: driverId,
        fleetOwnerId: car.fleetOwnerId,
        status: 'active'
      }
    });

    if (!driver) {
      throw new AppError('Driver not found or not available', 404);
    }
  }

  await car.update({ currentDriverId: driverId || null });

  res.json({
    success: true,
    message: driverId ? 'Driver assigned successfully' : 'Driver unassigned successfully',
    data: { car }
  });
}));

// Drivers Routes
router.get('/drivers', authenticateToken, asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, status, fleetOwnerId, search } = req.query;
  const offset = (page - 1) * limit;

  const whereConditions = {};
  
  // Non-admin users can only see their own drivers
  if (req.user.role === 'fleet_owner') {
    const fleetOwner = await FleetOwner.findOne({ where: { userId: req.user.id } });
    if (fleetOwner) {
      whereConditions.fleetOwnerId = fleetOwner.id;
    }
  } else if (req.user.role !== 'admin') {
    whereConditions.id = null; // No access for other roles
  }
  
  if (status) {
    whereConditions.status = status;
  }
  
  if (fleetOwnerId && req.user.role === 'admin') {
    whereConditions.fleetOwnerId = fleetOwnerId;
  }
  
  if (search) {
    whereConditions[Op.or] = [
      { licenseNumber: { [Op.iLike]: `%${search}%` } }
    ];
  }

  const { count, rows: drivers } = await Driver.findAndCountAll({
    where: whereConditions,
    limit: parseInt(limit),
    offset: parseInt(offset),
    order: [['createdAt', 'DESC']],
    include: [
      {
        association: 'user',
        attributes: ['id', 'firstName', 'lastName', 'email', 'phone']
      },
      {
        association: 'fleetOwner',
        attributes: ['id', 'companyName']
      },
      {
        association: 'assignedCars',
        attributes: ['id', 'make', 'model', 'licensePlate', 'status']
      }
    ]
  });

  res.json({
    success: true,
    data: {
      drivers,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(count / limit),
        totalItems: count,
        itemsPerPage: parseInt(limit)
      }
    }
  });
}));

// Create new driver
router.post('/drivers', authenticateToken, requireFleetOwnerOrAdmin, validate(schemas.driverCreate), asyncHandler(async (req, res) => {
  const { userId, ...driverData } = req.body;
  let fleetOwnerId = req.body.fleetOwnerId;
  
  // If not admin, use the requesting user's fleet owner profile
  if (req.user.role !== 'admin') {
    const fleetOwner = await FleetOwner.findOne({ where: { userId: req.user.id } });
    if (!fleetOwner) {
      throw new AppError('Fleet owner profile not found', 404);
    }
    fleetOwnerId = fleetOwner.id;
  }

  // Verify the user exists and doesn't already have a driver profile
  const user = await User.findByPk(userId);
  if (!user) {
    throw new AppError('User not found', 404);
  }

  const existingDriver = await Driver.findOne({ where: { userId } });
  if (existingDriver) {
    throw new AppError('User already has a driver profile', 400);
  }

  const driver = await Driver.create({
    ...driverData,
    userId,
    fleetOwnerId
  });

  // Update user role
  await user.update({ role: 'driver' });

  // Update fleet owner's driver count
  const fleetOwner = await FleetOwner.findByPk(fleetOwnerId);
  if (fleetOwner) {
    await fleetOwner.update({
      totalDrivers: fleetOwner.totalDrivers + 1
    });
  }

  res.status(201).json({
    success: true,
    message: 'Driver created successfully',
    data: { driver }
  });
}));

// Get driver by ID
router.get('/drivers/:id', authenticateToken, asyncHandler(async (req, res) => {
  const { id } = req.params;
  
  const whereConditions = { id };
  
  // Non-admin users can only see their own drivers or their own profile
  if (req.user.role === 'fleet_owner') {
    const fleetOwner = await FleetOwner.findOne({ where: { userId: req.user.id } });
    if (fleetOwner) {
      whereConditions.fleetOwnerId = fleetOwner.id;
    }
  } else if (req.user.role === 'driver') {
    whereConditions.userId = req.user.id;
  }

  const driver = await Driver.findOne({
    where: whereConditions,
    include: [
      {
        association: 'user',
        attributes: ['id', 'firstName', 'lastName', 'email', 'phone']
      },
      {
        association: 'fleetOwner',
        attributes: ['id', 'companyName'],
        include: [{ association: 'user', attributes: ['firstName', 'lastName'] }]
      },
      {
        association: 'assignedCars',
        attributes: ['id', 'make', 'model', 'licensePlate', 'status', 'location']
      }
    ]
  });

  if (!driver) {
    throw new AppError('Driver not found or access denied', 404);
  }

  res.json({
    success: true,
    data: { driver }
  });
}));

// Update driver
router.put('/drivers/:id', authenticateToken, asyncHandler(async (req, res) => {
  const { id } = req.params;
  
  const whereConditions = { id };
  
  // Non-admin users can only update their own drivers or their own profile
  if (req.user.role === 'fleet_owner') {
    const fleetOwner = await FleetOwner.findOne({ where: { userId: req.user.id } });
    if (fleetOwner) {
      whereConditions.fleetOwnerId = fleetOwner.id;
    }
  } else if (req.user.role === 'driver') {
    whereConditions.userId = req.user.id;
  } else if (req.user.role !== 'admin') {
    throw new AppError('Access denied', 403);
  }

  const driver = await Driver.findOne({ where: whereConditions });
  
  if (!driver) {
    throw new AppError('Driver not found or access denied', 404);
  }

  await driver.update(req.body);

  res.json({
    success: true,
    message: 'Driver updated successfully',
    data: { driver }
  });
}));

// Fleet statistics
router.get('/stats/overview', authenticateToken, requireFleetOwnerOrAdmin, asyncHandler(async (req, res) => {
  const whereConditions = {};
  
  // Non-admin users see stats for their own fleet
  if (req.user.role === 'fleet_owner') {
    const fleetOwner = await FleetOwner.findOne({ where: { userId: req.user.id } });
    if (fleetOwner) {
      whereConditions.fleetOwnerId = fleetOwner.id;
    }
  }

  const totalCars = await Car.count({ where: whereConditions });
  const activeCars = await Car.count({ where: { ...whereConditions, status: 'active' } });
  const totalDrivers = await Driver.count({ 
    where: req.user.role === 'fleet_owner' ? { fleetOwnerId: whereConditions.fleetOwnerId } : {} 
  });
  const activeDrivers = await Driver.count({ 
    where: {
      ...(req.user.role === 'fleet_owner' ? { fleetOwnerId: whereConditions.fleetOwnerId } : {}),
      status: 'active'
    }
  });

  const carsByType = await Car.findAll({
    where: whereConditions,
    attributes: [
      'type',
      [sequelize.fn('COUNT', sequelize.col('type')), 'count']
    ],
    group: ['type']
  });

  const carsByStatus = await Car.findAll({
    where: whereConditions,
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
      totalDrivers,
      activeDrivers,
      utilizationRate: totalCars > 0 ? ((activeCars / totalCars) * 100).toFixed(2) : 0,
      carsByType: carsByType.map(item => ({
        type: item.type,
        count: parseInt(item.dataValues.count)
      })),
      carsByStatus: carsByStatus.map(item => ({
        status: item.status,
        count: parseInt(item.dataValues.count)
      }))
    }
  });
}));

export default router;
