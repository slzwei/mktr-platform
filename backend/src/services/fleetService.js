import { Op } from 'sequelize';
import { FleetOwner, Car, User, sequelize } from '../models/index.js';
import { AppError } from '../middleware/errorHandler.js';

const FLEET_OWNER_FIELDS = [
  'full_name', 'email', 'phone', 'company_name', 'uen',
  'payout_method', 'bank_account', 'address'
];

const CAR_FIELDS = [
  'make', 'model', 'year', 'plate_number', 'vin', 'color',
  'type', 'status', 'fleet_owner_id'
];

const CAR_UPDATE_FIELDS = [...CAR_FIELDS, 'current_driver_id'];

function whitelist(body, fields) {
  return Object.fromEntries(
    Object.entries(body).filter(([k]) => fields.includes(k))
  );
}

// ---- Fleet Owners ----

export async function listFleetOwners(query) {
  const { page = 1, limit = 50, search } = query;
  const offset = (page - 1) * limit;
  const where = {};

  if (search) {
    const sanitizedSearch = String(search).slice(0, 100).replace(/%/g, '\\%').replace(/_/g, '\\_');
    where[Op.or] = [
      { full_name: { [Op.iLike]: `%${sanitizedSearch}%` } },
      { email: { [Op.iLike]: `%${sanitizedSearch}%` } },
      { company_name: { [Op.iLike]: `%${sanitizedSearch}%` } }
    ];
  }

  const { count, rows: fleetOwners } = await FleetOwner.findAndCountAll({
    where,
    limit: parseInt(limit),
    offset: parseInt(offset),
    order: [['createdAt', 'DESC']]
  });

  return {
    fleetOwners,
    pagination: {
      currentPage: parseInt(page),
      totalPages: Math.ceil(count / limit),
      totalItems: count,
      itemsPerPage: parseInt(limit)
    }
  };
}

export async function createFleetOwner(body) {
  const safeData = whitelist(body, FLEET_OWNER_FIELDS);
  return FleetOwner.create(safeData);
}

export async function getFleetOwner(id) {
  const fleetOwner = await FleetOwner.findByPk(id);
  if (!fleetOwner) throw new AppError('Fleet owner not found', 404);
  return fleetOwner;
}

export async function updateFleetOwner(id, body) {
  const fleetOwner = await FleetOwner.findByPk(id);
  if (!fleetOwner) throw new AppError('Fleet owner not found', 404);

  const safeUpdates = whitelist(body, FLEET_OWNER_FIELDS);
  await fleetOwner.update(safeUpdates);
  return fleetOwner;
}

export async function deleteFleetOwner(id) {
  const fleetOwner = await FleetOwner.findByPk(id);
  if (!fleetOwner) throw new AppError('Fleet owner not found', 404);

  const carCount = await Car.count({ where: { fleet_owner_id: id } });
  if (carCount > 0) {
    throw new AppError('Cannot delete fleet owner with assigned vehicles', 400);
  }

  await fleetOwner.destroy();
}

// ---- Cars ----

export async function listCars(query) {
  const { page = 1, limit = 50, status, fleet_owner_id, search } = query;
  const offset = (page - 1) * limit;
  const where = {};

  if (status) where.status = status;
  if (fleet_owner_id) where.fleet_owner_id = fleet_owner_id;

  if (search) {
    const sanitizedSearch = String(search).slice(0, 100).replace(/%/g, '\\%').replace(/_/g, '\\_');
    where[Op.or] = [
      { make: { [Op.iLike]: `%${sanitizedSearch}%` } },
      { model: { [Op.iLike]: `%${sanitizedSearch}%` } },
      { plate_number: { [Op.iLike]: `%${sanitizedSearch}%` } }
    ];
  }

  const { count, rows: cars } = await Car.findAndCountAll({
    where,
    limit: parseInt(limit),
    offset: parseInt(offset),
    order: [['createdAt', 'DESC']],
    include: [
      { model: FleetOwner, as: 'fleetOwner', attributes: ['id', 'full_name', 'company_name'] },
      { model: User, as: 'currentDriver', attributes: ['id', 'firstName', 'lastName', 'email'] }
    ]
  });

  return {
    cars,
    pagination: {
      currentPage: parseInt(page),
      totalPages: Math.ceil(count / limit),
      totalItems: count,
      itemsPerPage: parseInt(limit)
    }
  };
}

export async function createCar(body) {
  if (body.fleet_owner_id) {
    const fleetOwner = await FleetOwner.findByPk(body.fleet_owner_id);
    if (!fleetOwner) throw new AppError('Fleet owner not found', 404);
  }

  const safeData = whitelist(body, CAR_FIELDS);
  return Car.create(safeData);
}

export async function getCar(id) {
  const car = await Car.findByPk(id, {
    include: [
      { model: FleetOwner, as: 'fleetOwner', attributes: ['id', 'full_name', 'company_name'] },
      { model: User, as: 'currentDriver', attributes: ['id', 'firstName', 'lastName', 'email'] }
    ]
  });
  if (!car) throw new AppError('Car not found', 404);
  return car;
}

export async function updateCar(id, body) {
  const car = await Car.findByPk(id);
  if (!car) throw new AppError('Car not found', 404);

  if (body.fleet_owner_id && body.fleet_owner_id !== car.fleet_owner_id) {
    const fleetOwner = await FleetOwner.findByPk(body.fleet_owner_id);
    if (!fleetOwner) throw new AppError('Fleet owner not found', 404);
  }

  if (body.current_driver_id) {
    const driver = await User.findOne({
      where: { id: body.current_driver_id, role: 'driver_partner' }
    });
    if (!driver) throw new AppError('Driver not found', 404);
  }

  const safeUpdates = whitelist(body, CAR_UPDATE_FIELDS);
  await car.update(safeUpdates);
  return car;
}

export async function deleteCar(id) {
  const car = await Car.findByPk(id);
  if (!car) throw new AppError('Car not found', 404);
  await car.destroy();
}

export async function assignDriver(id, driverId) {
  const car = await Car.findByPk(id);
  if (!car) throw new AppError('Car not found', 404);

  if (driverId) {
    const driver = await User.findOne({
      where: { id: driverId, role: 'driver_partner' }
    });
    if (!driver) throw new AppError('Driver not found or not available', 404);
  }

  const updateData = {
    current_driver_id: driverId || null,
    assignment_start: driverId ? new Date() : null,
    assignment_end: driverId ? null : new Date()
  };

  await car.update(updateData);
  return { car, assigned: !!driverId };
}

// ---- Statistics ----

export async function getFleetStats() {
  const [totalCars, activeCars, assignedCars, totalFleetOwners, totalDrivers, carsByStatus] = await Promise.all([
    Car.count(),
    Car.count({ where: { status: 'active' } }),
    Car.count({ where: { current_driver_id: { [Op.not]: null } } }),
    FleetOwner.count(),
    User.count({ where: { role: 'driver_partner' } }),
    Car.findAll({
      attributes: [
        'status',
        [sequelize.fn('COUNT', sequelize.col('status')), 'count']
      ],
      group: ['status']
    })
  ]);

  return {
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
  };
}
