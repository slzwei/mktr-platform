import express from 'express';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import * as vehicleController from '../controllers/vehicleController.js';

export const meta = { path: '/api/vehicles' };

const router = express.Router();

// Middleware: All routes require Admin access
router.use(authenticateToken, requireAdmin);

router.get('/', vehicleController.listVehicles);
router.post('/', vehicleController.createVehicle);
router.get('/:id', vehicleController.getVehicle);
router.patch('/:id', vehicleController.updateVehicle);
router.delete('/:id', vehicleController.deleteVehicle);
router.put('/:id/pair', vehicleController.pairDevices);
router.delete('/:id/pair', vehicleController.unpairDevices);
router.put('/:id/volume', vehicleController.setVolume);

export default router;
