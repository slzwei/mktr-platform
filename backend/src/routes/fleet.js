import express from 'express';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import { validate, schemas } from '../middleware/validation.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import * as fleetService from '../services/fleetService.js';

const router = express.Router();

// Fleet Owners
router.get('/owners', authenticateToken, asyncHandler(async (req, res) => {
  const data = await fleetService.listFleetOwners(req.query);
  res.json({ success: true, data });
}));

router.post('/owners', authenticateToken, requireAdmin, validate(schemas.fleetOwnerCreate), asyncHandler(async (req, res) => {
  const fleetOwner = await fleetService.createFleetOwner(req.body);
  res.status(201).json({ success: true, message: 'Fleet owner created successfully', data: { fleetOwner } });
}));

router.get('/owners/:id', authenticateToken, asyncHandler(async (req, res) => {
  const fleetOwner = await fleetService.getFleetOwner(req.params.id);
  res.json({ success: true, data: { fleetOwner } });
}));

router.put('/owners/:id', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const fleetOwner = await fleetService.updateFleetOwner(req.params.id, req.body);
  res.json({ success: true, message: 'Fleet owner updated successfully', data: { fleetOwner } });
}));

router.delete('/owners/:id', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  await fleetService.deleteFleetOwner(req.params.id);
  res.json({ success: true, message: 'Fleet owner deleted successfully' });
}));

// Cars
router.get('/cars', authenticateToken, asyncHandler(async (req, res) => {
  const data = await fleetService.listCars(req.query);
  res.json({ success: true, data });
}));

router.post('/cars', authenticateToken, validate(schemas.carCreate), asyncHandler(async (req, res) => {
  const car = await fleetService.createCar(req.body);
  res.status(201).json({ success: true, message: 'Car created successfully', data: { car } });
}));

router.get('/cars/:id', authenticateToken, asyncHandler(async (req, res) => {
  const car = await fleetService.getCar(req.params.id);
  res.json({ success: true, data: { car } });
}));

router.put('/cars/:id', authenticateToken, asyncHandler(async (req, res) => {
  const car = await fleetService.updateCar(req.params.id, req.body);
  res.json({ success: true, message: 'Car updated successfully', data: { car } });
}));

router.delete('/cars/:id', authenticateToken, asyncHandler(async (req, res) => {
  await fleetService.deleteCar(req.params.id);
  res.json({ success: true, message: 'Car deleted successfully' });
}));

router.patch('/cars/:id/assign-driver', authenticateToken, asyncHandler(async (req, res) => {
  const { car, assigned } = await fleetService.assignDriver(req.params.id, req.body.driverId);
  res.json({
    success: true,
    message: assigned ? 'Driver assigned successfully' : 'Driver unassigned successfully',
    data: { car }
  });
}));

// Statistics
router.get('/stats/overview', authenticateToken, asyncHandler(async (req, res) => {
  const data = await fleetService.getFleetStats();
  res.json({ success: true, data });
}));

export default router;
