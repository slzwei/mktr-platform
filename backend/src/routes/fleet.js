import express from 'express';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import { validate, schemas } from '../middleware/validation.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import * as ctrl from '../controllers/fleetController.js';

export const meta = {
  mounts: [
    { path: '/api/fleet' },
    { path: '/api/fleet', flag: 'ENABLE_DOMAIN_PREFIXES' },
  ],
};

const router = express.Router();

// Fleet Owners
router.get('/owners', authenticateToken, asyncHandler(ctrl.listFleetOwners));
router.post('/owners', authenticateToken, requireAdmin, validate(schemas.fleetOwnerCreate), asyncHandler(ctrl.createFleetOwner));
router.get('/owners/:id', authenticateToken, asyncHandler(ctrl.getFleetOwner));
router.put('/owners/:id', authenticateToken, requireAdmin, asyncHandler(ctrl.updateFleetOwner));
router.delete('/owners/:id', authenticateToken, requireAdmin, asyncHandler(ctrl.deleteFleetOwner));

// Cars
router.get('/cars', authenticateToken, asyncHandler(ctrl.listCars));
router.post('/cars', authenticateToken, validate(schemas.carCreate), asyncHandler(ctrl.createCar));
router.get('/cars/:id', authenticateToken, asyncHandler(ctrl.getCar));
router.put('/cars/:id', authenticateToken, asyncHandler(ctrl.updateCar));
router.delete('/cars/:id', authenticateToken, asyncHandler(ctrl.deleteCar));
router.patch('/cars/:id/assign-driver', authenticateToken, asyncHandler(ctrl.assignDriver));

// Statistics
router.get('/stats/overview', authenticateToken, asyncHandler(ctrl.getFleetStats));

export default router;
