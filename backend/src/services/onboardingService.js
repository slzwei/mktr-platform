import { FleetOwner, Car, UserPayout } from '../models/index.js';
import { AppError } from '../middleware/errorHandler.js';

/**
 * Update a user's role during onboarding.
 */
export async function updateRole(user, role) {
  if (!['driver_partner', 'agent', 'fleet_owner'].includes(role)) {
    throw new AppError('Invalid role', 400);
  }
  await user.update({ role });
  return user;
}

/**
 * Upsert payout info for a user.
 */
export async function savePayout(userId, { method, paynowId, bankName, bankAccount }) {
  if (!['PayNow', 'Bank Transfer'].includes(method)) {
    throw new AppError('Invalid payout method', 400);
  }

  const [payout, created] = await UserPayout.findOrCreate({
    where: { userId },
    defaults: { method, paynowId: paynowId || null, bankName: bankName || null, bankAccount: bankAccount || null }
  });

  if (!created) {
    const updateData = { method };
    if (method === 'PayNow') {
      updateData.paynowId = paynowId || null;
      updateData.bankName = null;
      updateData.bankAccount = null;
    } else if (method === 'Bank Transfer') {
      updateData.bankName = bankName || null;
      updateData.bankAccount = bankAccount || null;
      updateData.paynowId = null;
    }
    await payout.update(updateData);
  }

  return payout;
}

/**
 * Resolve (find or create) a FleetOwner for the given user.
 * @returns {string} fleetOwnerId
 */
async function resolveFleetOwner(userEmail, userFullName, userPhone) {
  const existing = await FleetOwner.findOne({ where: { email: userEmail } });
  const owner = existing || await FleetOwner.create({
    full_name: userFullName || userEmail,
    email: userEmail,
    phone: userPhone || null,
    status: 'active'
  });
  return owner.id;
}

/**
 * Self-serve car creation during onboarding (driver or fleet owner).
 * @returns {object} created car
 */
export async function createCar(userId, userRole, userEmail, userFullName, userPhone, { plateNumber, make, model }) {
  if (!plateNumber || !make || !model) {
    throw new AppError('plate_number, make, and model are required', 400);
  }

  let fleetOwnerId = null;

  if (userRole === 'fleet_owner') {
    fleetOwnerId = await resolveFleetOwner(userEmail, userFullName, userPhone);
  }

  if (userRole === 'driver_partner' && !fleetOwnerId) {
    fleetOwnerId = await resolveFleetOwner(userEmail, userFullName, userPhone);
  }

  if (!fleetOwnerId) {
    throw new AppError('Unable to determine fleet owner for car', 400);
  }

  const car = await Car.create({
    plate_number: plateNumber,
    make,
    model,
    year: new Date().getFullYear(),
    type: 'sedan',
    status: 'active',
    fleet_owner_id: fleetOwnerId,
    current_driver_id: userRole === 'driver_partner' ? userId : null
  });

  return car;
}

/**
 * Bulk car creation for fleet owners.
 * @param {Array<{plate_number, make, model}>} cars
 * @returns {Array<object>} created cars
 */
export async function bulkCreateCars(userId, userEmail, userFullName, userPhone, userRole, cars) {
  if (userRole !== 'fleet_owner') {
    throw new AppError('Only fleet owners can bulk add cars', 403);
  }

  if (!Array.isArray(cars) || cars.length === 0) {
    throw new AppError('No cars provided', 400);
  }

  const ownerId = await resolveFleetOwner(userEmail, userFullName, userPhone);

  const created = await Promise.all(cars.map(c => Car.create({
    plate_number: c.plate_number,
    make: c.make,
    model: c.model,
    year: new Date().getFullYear(),
    type: 'sedan',
    status: 'active',
    fleet_owner_id: ownerId
  })));

  return created;
}
