import * as fleetService from '../services/fleetService.js';

// Fleet Owners
export async function listFleetOwners(req, res) {
  const data = await fleetService.listFleetOwners(req.query);
  res.json({ success: true, data });
}

export async function createFleetOwner(req, res) {
  const fleetOwner = await fleetService.createFleetOwner(req.body);
  res.status(201).json({ success: true, message: 'Fleet owner created successfully', data: { fleetOwner } });
}

export async function getFleetOwner(req, res) {
  const fleetOwner = await fleetService.getFleetOwner(req.params.id);
  res.json({ success: true, data: { fleetOwner } });
}

export async function updateFleetOwner(req, res) {
  const fleetOwner = await fleetService.updateFleetOwner(req.params.id, req.body);
  res.json({ success: true, message: 'Fleet owner updated successfully', data: { fleetOwner } });
}

export async function deleteFleetOwner(req, res) {
  await fleetService.deleteFleetOwner(req.params.id);
  res.json({ success: true, message: 'Fleet owner deleted successfully' });
}

// Cars
export async function listCars(req, res) {
  const data = await fleetService.listCars(req.query);
  res.json({ success: true, data });
}

export async function createCar(req, res) {
  const car = await fleetService.createCar(req.body);
  res.status(201).json({ success: true, message: 'Car created successfully', data: { car } });
}

export async function getCar(req, res) {
  const car = await fleetService.getCar(req.params.id);
  res.json({ success: true, data: { car } });
}

export async function updateCar(req, res) {
  const car = await fleetService.updateCar(req.params.id, req.body);
  res.json({ success: true, message: 'Car updated successfully', data: { car } });
}

export async function deleteCar(req, res) {
  await fleetService.deleteCar(req.params.id);
  res.json({ success: true, message: 'Car deleted successfully' });
}

export async function assignDriver(req, res) {
  const { car, assigned } = await fleetService.assignDriver(req.params.id, req.body.driverId);
  res.json({
    success: true,
    message: assigned ? 'Driver assigned successfully' : 'Driver unassigned successfully',
    data: { car }
  });
}

// Statistics
export async function getFleetStats(req, res) {
  const data = await fleetService.getFleetStats();
  res.json({ success: true, data });
}
