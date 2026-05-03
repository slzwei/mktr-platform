/**
 * Fleet service layer — wraps fleet entity APIs.
 */
import { FleetOwner, Car, Driver } from '@/api/entities';
import { fleet } from '@/api/client';

// Fleet Owners
export async function listFleetOwners(params = {}) {
 return FleetOwner.list(params);
}

// Cars
export async function listCars(params = {}) {
 return Car.list(params);
}

export async function createCar(data) {
 return Car.create(data);
}

export async function updateCar(id, data) {
 return Car.update(id, data);
}

export async function deleteCar(id) {
 return Car.delete(id);
}

// Drivers
export async function listDrivers(params = {}) {
 return Driver.list(params);
}

export async function createDriver(data) {
 return Driver.create(data);
}

export async function updateDriver(id, data) {
 return Driver.update(id, data);
}

export async function deleteDriver(id) {
 return Driver.delete(id);
}

// Stats
export async function getFleetStats() {
 return fleet.getStats();
}
