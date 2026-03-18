import { jest } from '@jest/globals';
import '../setup.js';

// ── Helpers ──

function buildMocks() {
  const mockFleetOwner = {
    id: 'fleet-1',
    full_name: 'Fleet Corp',
    email: 'fleet@test.com',
    phone: '+6590001111',
    company_name: 'Fleet Corp Pte Ltd',
    status: 'active',
    update: jest.fn().mockResolvedValue(true),
    destroy: jest.fn().mockResolvedValue(true),
  };

  const mockCar = {
    id: 'car-1',
    make: 'Toyota',
    model: 'Corolla',
    plate_number: 'SBA1234A',
    status: 'active',
    fleet_owner_id: 'fleet-1',
    current_driver_id: null,
    update: jest.fn().mockResolvedValue(true),
    destroy: jest.fn().mockResolvedValue(true),
  };

  const mockDriver = {
    id: 'driver-1',
    firstName: 'John',
    lastName: 'Doe',
    role: 'driver_partner',
  };

  const FleetOwner = {
    findAndCountAll: jest.fn().mockResolvedValue({ count: 1, rows: [mockFleetOwner] }),
    findByPk: jest.fn().mockResolvedValue(mockFleetOwner),
    create: jest.fn().mockResolvedValue(mockFleetOwner),
    count: jest.fn().mockResolvedValue(3),
  };

  const Car = {
    findAndCountAll: jest.fn().mockResolvedValue({ count: 1, rows: [mockCar] }),
    findByPk: jest.fn().mockResolvedValue(mockCar),
    create: jest.fn().mockResolvedValue(mockCar),
    count: jest.fn().mockResolvedValue(10),
    findAll: jest.fn().mockResolvedValue([]),
  };

  const User = {
    findOne: jest.fn().mockResolvedValue(mockDriver),
    count: jest.fn().mockResolvedValue(5),
  };

  const sequelize = {
    fn: jest.fn((fnName, col) => `${fnName}(${col})`),
    col: jest.fn((name) => name),
    literal: jest.fn((expr) => expr),
  };

  const AppError = class extends Error {
    constructor(message, statusCode) {
      super(message);
      this.statusCode = statusCode;
    }
  };

  return {
    mockFleetOwner, mockCar, mockDriver,
    FleetOwner, Car, User, sequelize, AppError,
  };
}

let mocks;
let service;

beforeEach(async () => {
  mocks = buildMocks();

  jest.unstable_mockModule('../../src/models/index.js', () => ({
    FleetOwner: mocks.FleetOwner,
    Car: mocks.Car,
    User: mocks.User,
    sequelize: mocks.sequelize,
  }));

  jest.unstable_mockModule('../../src/middleware/errorHandler.js', () => ({
    AppError: mocks.AppError,
  }));

  service = await import('../../src/services/fleetService.js');
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.resetModules();
});

// ── Tests ──

describe('fleetService (unit)', () => {

  // ── listFleetOwners ──

  describe('listFleetOwners', () => {
    it('returns fleet owners and pagination', async () => {
      const result = await service.listFleetOwners({ page: 1, limit: 50 });

      expect(result).toHaveProperty('fleetOwners');
      expect(result).toHaveProperty('pagination');
      expect(result.pagination.currentPage).toBe(1);
    });

    it('applies search filter with iLike', async () => {
      await service.listFleetOwners({ search: 'fleet' });

      const callArg = mocks.FleetOwner.findAndCountAll.mock.calls[0][0];
      expect(callArg.where).toBeDefined();
    });

    it('applies pagination offset', async () => {
      mocks.FleetOwner.findAndCountAll.mockResolvedValue({ count: 100, rows: [] });

      await service.listFleetOwners({ page: 3, limit: 10 });

      const callArg = mocks.FleetOwner.findAndCountAll.mock.calls[0][0];
      expect(callArg.offset).toBe(20);
      expect(callArg.limit).toBe(10);
    });
  });

  // ── createFleetOwner ──

  describe('createFleetOwner', () => {
    it('creates fleet owner with whitelisted fields', async () => {
      const body = { full_name: 'New Fleet', email: 'new@test.com', dangerousField: 'ignored' };
      await service.createFleetOwner(body);

      const createArg = mocks.FleetOwner.create.mock.calls[0][0];
      expect(createArg.full_name).toBe('New Fleet');
      expect(createArg.email).toBe('new@test.com');
      expect(createArg.dangerousField).toBeUndefined();
    });
  });

  // ── getFleetOwner ──

  describe('getFleetOwner', () => {
    it('returns fleet owner by ID', async () => {
      const result = await service.getFleetOwner('fleet-1');
      expect(result).toBe(mocks.mockFleetOwner);
    });

    it('throws 404 when not found', async () => {
      mocks.FleetOwner.findByPk.mockResolvedValue(null);

      await expect(service.getFleetOwner('bad-id'))
        .rejects.toThrow('Fleet owner not found');
    });
  });

  // ── updateFleetOwner ──

  describe('updateFleetOwner', () => {
    it('updates fleet owner with whitelisted fields', async () => {
      await service.updateFleetOwner('fleet-1', { full_name: 'Updated', dangerousField: 'x' });

      const updateArg = mocks.mockFleetOwner.update.mock.calls[0][0];
      expect(updateArg.full_name).toBe('Updated');
      expect(updateArg.dangerousField).toBeUndefined();
    });

    it('throws 404 when not found', async () => {
      mocks.FleetOwner.findByPk.mockResolvedValue(null);

      await expect(service.updateFleetOwner('bad-id', {}))
        .rejects.toThrow('Fleet owner not found');
    });
  });

  // ── deleteFleetOwner ──

  describe('deleteFleetOwner', () => {
    it('deletes fleet owner when no cars assigned', async () => {
      mocks.Car.count.mockResolvedValue(0);

      await service.deleteFleetOwner('fleet-1');

      expect(mocks.mockFleetOwner.destroy).toHaveBeenCalled();
    });

    it('throws 400 when fleet owner has cars', async () => {
      mocks.Car.count.mockResolvedValue(5);

      await expect(service.deleteFleetOwner('fleet-1'))
        .rejects.toThrow('Cannot delete fleet owner with assigned vehicles');

      try {
        await service.deleteFleetOwner('fleet-1');
      } catch (err) {
        expect(err.statusCode).toBe(400);
      }
    });

    it('throws 404 when fleet owner not found', async () => {
      mocks.FleetOwner.findByPk.mockResolvedValue(null);

      await expect(service.deleteFleetOwner('bad-id'))
        .rejects.toThrow('Fleet owner not found');
    });
  });

  // ── listCars ──

  describe('listCars', () => {
    it('returns cars and pagination', async () => {
      const result = await service.listCars({ page: 1, limit: 50 });

      expect(result).toHaveProperty('cars');
      expect(result).toHaveProperty('pagination');
    });

    it('filters by status and fleet_owner_id', async () => {
      await service.listCars({ status: 'active', fleet_owner_id: 'fleet-1' });

      const callArg = mocks.Car.findAndCountAll.mock.calls[0][0];
      expect(callArg.where.status).toBe('active');
      expect(callArg.where.fleet_owner_id).toBe('fleet-1');
    });

    it('applies search filter', async () => {
      await service.listCars({ search: 'toyota' });

      const callArg = mocks.Car.findAndCountAll.mock.calls[0][0];
      expect(callArg.where).toBeDefined();
    });
  });

  // ── createCar ──

  describe('createCar', () => {
    it('creates car with whitelisted fields', async () => {
      const body = { make: 'Honda', model: 'Civic', fleet_owner_id: 'fleet-1', dangerousField: 'x' };
      await service.createCar(body);

      const createArg = mocks.Car.create.mock.calls[0][0];
      expect(createArg.make).toBe('Honda');
      expect(createArg.dangerousField).toBeUndefined();
    });

    it('throws 404 when fleet owner not found', async () => {
      mocks.FleetOwner.findByPk.mockResolvedValue(null);

      await expect(service.createCar({ fleet_owner_id: 'bad-id' }))
        .rejects.toThrow('Fleet owner not found');
    });
  });

  // ── getCar ──

  describe('getCar', () => {
    it('returns car with includes', async () => {
      const result = await service.getCar('car-1');

      expect(mocks.Car.findByPk).toHaveBeenCalledWith(
        'car-1',
        expect.objectContaining({ include: expect.any(Array) })
      );
      expect(result).toBe(mocks.mockCar);
    });

    it('throws 404 when not found', async () => {
      mocks.Car.findByPk.mockResolvedValue(null);

      await expect(service.getCar('bad-id'))
        .rejects.toThrow('Car not found');
    });
  });

  // ── updateCar ──

  describe('updateCar', () => {
    it('updates car with whitelisted fields', async () => {
      await service.updateCar('car-1', { make: 'Honda', dangerousField: 'x' });

      const updateArg = mocks.mockCar.update.mock.calls[0][0];
      expect(updateArg.make).toBe('Honda');
      expect(updateArg.dangerousField).toBeUndefined();
    });

    it('throws 404 when car not found', async () => {
      mocks.Car.findByPk.mockResolvedValue(null);

      await expect(service.updateCar('bad-id', {}))
        .rejects.toThrow('Car not found');
    });

    it('validates fleet owner when fleet_owner_id changes', async () => {
      mocks.FleetOwner.findByPk.mockResolvedValue(null);

      await expect(service.updateCar('car-1', { fleet_owner_id: 'new-fleet' }))
        .rejects.toThrow('Fleet owner not found');
    });

    it('validates driver when current_driver_id is set', async () => {
      mocks.User.findOne.mockResolvedValue(null);

      await expect(service.updateCar('car-1', { current_driver_id: 'bad-driver' }))
        .rejects.toThrow('Driver not found');
    });
  });

  // ── deleteCar ──

  describe('deleteCar', () => {
    it('destroys the car', async () => {
      await service.deleteCar('car-1');

      expect(mocks.mockCar.destroy).toHaveBeenCalled();
    });

    it('throws 404 when car not found', async () => {
      mocks.Car.findByPk.mockResolvedValue(null);

      await expect(service.deleteCar('bad-id'))
        .rejects.toThrow('Car not found');
    });
  });

  // ── assignDriver ──

  describe('assignDriver', () => {
    it('assigns a driver to the car', async () => {
      const result = await service.assignDriver('car-1', 'driver-1');

      expect(mocks.mockCar.update).toHaveBeenCalledWith(
        expect.objectContaining({
          current_driver_id: 'driver-1',
          assignment_start: expect.any(Date),
          assignment_end: null,
        })
      );
      expect(result.assigned).toBe(true);
    });

    it('unassigns driver when driverId is null', async () => {
      const result = await service.assignDriver('car-1', null);

      expect(mocks.mockCar.update).toHaveBeenCalledWith(
        expect.objectContaining({
          current_driver_id: null,
          assignment_start: null,
          assignment_end: expect.any(Date),
        })
      );
      expect(result.assigned).toBe(false);
    });

    it('throws 404 when car not found', async () => {
      mocks.Car.findByPk.mockResolvedValue(null);

      await expect(service.assignDriver('bad-id', 'driver-1'))
        .rejects.toThrow('Car not found');
    });

    it('throws 404 when driver not found', async () => {
      mocks.User.findOne.mockResolvedValue(null);

      await expect(service.assignDriver('car-1', 'bad-driver'))
        .rejects.toThrow('Driver not found or not available');
    });
  });

  // ── getFleetStats ──

  describe('getFleetStats', () => {
    it('returns all stat fields', async () => {
      mocks.Car.count
        .mockResolvedValueOnce(20)   // totalCars
        .mockResolvedValueOnce(15)   // activeCars
        .mockResolvedValueOnce(10);  // assignedCars

      mocks.FleetOwner.count.mockResolvedValue(5);
      mocks.User.count.mockResolvedValue(8);

      mocks.Car.findAll.mockResolvedValue([
        { status: 'active', dataValues: { count: 15 } },
        { status: 'inactive', dataValues: { count: 5 } },
      ]);

      const result = await service.getFleetStats();

      expect(result.totalCars).toBe(20);
      expect(result.activeCars).toBe(15);
      expect(result.assignedCars).toBe(10);
      expect(result.availableCars).toBe(10); // 20 - 10
      expect(result.totalFleetOwners).toBe(5);
      expect(result.totalDrivers).toBe(8);
      expect(result.utilizationRate).toBe('50.00'); // (10/20)*100
      expect(result.carsByStatus).toEqual([
        { status: 'active', count: 15 },
        { status: 'inactive', count: 5 },
      ]);
    });

    it('returns 0 utilization rate when no cars', async () => {
      mocks.Car.count.mockResolvedValue(0);
      mocks.FleetOwner.count.mockResolvedValue(0);
      mocks.User.count.mockResolvedValue(0);
      mocks.Car.findAll.mockResolvedValue([]);

      const result = await service.getFleetStats();

      expect(result.utilizationRate).toBe(0);
    });
  });
});
