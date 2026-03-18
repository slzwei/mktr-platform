import { jest } from '@jest/globals';
import '../setup.js';

// ── Helpers ──

function buildMocks() {
  const mockUser = {
    id: 'user-1',
    role: 'agent',
    email: 'user@test.com',
    firstName: 'Test',
    lastName: 'User',
    phone: '+6590000001',
    update: jest.fn().mockResolvedValue(true),
  };

  const mockPayout = {
    id: 'payout-1',
    userId: 'user-1',
    method: 'PayNow',
    paynowId: '90000001',
    bankName: null,
    bankAccount: null,
    update: jest.fn().mockResolvedValue(true),
  };

  const mockFleetOwner = {
    id: 'fleet-1',
    full_name: 'Test User',
    email: 'user@test.com',
  };

  const mockCar = {
    id: 'car-1',
    plate_number: 'SBA1234A',
    make: 'Toyota',
    model: 'Corolla',
  };

  const FleetOwner = {
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue(mockFleetOwner),
  };

  const Car = {
    create: jest.fn().mockResolvedValue(mockCar),
  };

  const UserPayout = {
    findOrCreate: jest.fn().mockResolvedValue([mockPayout, true]),
  };

  const AppError = class extends Error {
    constructor(message, statusCode) {
      super(message);
      this.statusCode = statusCode;
    }
  };

  return {
    mockUser,
    mockPayout,
    mockFleetOwner,
    mockCar,
    FleetOwner,
    Car,
    UserPayout,
    AppError,
  };
}

let mocks;
let service;

beforeEach(async () => {
  mocks = buildMocks();

  jest.unstable_mockModule('../../src/models/index.js', () => ({
    FleetOwner: mocks.FleetOwner,
    Car: mocks.Car,
    UserPayout: mocks.UserPayout,
  }));

  jest.unstable_mockModule('../../src/middleware/errorHandler.js', () => ({
    AppError: mocks.AppError,
  }));

  service = await import('../../src/services/onboardingService.js');
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.resetModules();
});

// ── Tests ──

describe('onboardingService (unit)', () => {

  // ── updateRole ──

  describe('updateRole', () => {
    it('updates user role to driver_partner', async () => {
      const result = await service.updateRole(mocks.mockUser, 'driver_partner');

      expect(mocks.mockUser.update).toHaveBeenCalledWith({ role: 'driver_partner' });
      expect(result).toBe(mocks.mockUser);
    });

    it('updates user role to agent', async () => {
      await service.updateRole(mocks.mockUser, 'agent');

      expect(mocks.mockUser.update).toHaveBeenCalledWith({ role: 'agent' });
    });

    it('updates user role to fleet_owner', async () => {
      await service.updateRole(mocks.mockUser, 'fleet_owner');

      expect(mocks.mockUser.update).toHaveBeenCalledWith({ role: 'fleet_owner' });
    });

    it('throws 400 for invalid role', async () => {
      await expect(service.updateRole(mocks.mockUser, 'superadmin'))
        .rejects.toThrow('Invalid role');

      try {
        await service.updateRole(mocks.mockUser, 'superadmin');
      } catch (err) {
        expect(err.statusCode).toBe(400);
      }
    });

    it('throws 400 for admin role (not in allowed list)', async () => {
      await expect(service.updateRole(mocks.mockUser, 'admin'))
        .rejects.toThrow('Invalid role');
    });
  });

  // ── savePayout ──

  describe('savePayout', () => {
    it('creates new payout record with PayNow method', async () => {
      mocks.UserPayout.findOrCreate.mockResolvedValue([mocks.mockPayout, true]);

      const result = await service.savePayout('user-1', {
        method: 'PayNow',
        paynowId: '90000001',
      });

      expect(mocks.UserPayout.findOrCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1' },
          defaults: expect.objectContaining({ method: 'PayNow', paynowId: '90000001' }),
        })
      );
      expect(result).toBe(mocks.mockPayout);
    });

    it('updates existing payout to PayNow and clears bank fields', async () => {
      mocks.UserPayout.findOrCreate.mockResolvedValue([mocks.mockPayout, false]);

      await service.savePayout('user-1', {
        method: 'PayNow',
        paynowId: '90000001',
      });

      expect(mocks.mockPayout.update).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'PayNow',
          paynowId: '90000001',
          bankName: null,
          bankAccount: null,
        })
      );
    });

    it('updates existing payout to Bank Transfer and clears PayNow field', async () => {
      mocks.UserPayout.findOrCreate.mockResolvedValue([mocks.mockPayout, false]);

      await service.savePayout('user-1', {
        method: 'Bank Transfer',
        bankName: 'DBS',
        bankAccount: '123456789',
      });

      expect(mocks.mockPayout.update).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'Bank Transfer',
          bankName: 'DBS',
          bankAccount: '123456789',
          paynowId: null,
        })
      );
    });

    it('throws 400 for invalid payout method', async () => {
      await expect(service.savePayout('user-1', { method: 'crypto' }))
        .rejects.toThrow('Invalid payout method');

      try {
        await service.savePayout('user-1', { method: 'crypto' });
      } catch (err) {
        expect(err.statusCode).toBe(400);
      }
    });

    it('does not call update when record was just created', async () => {
      mocks.UserPayout.findOrCreate.mockResolvedValue([mocks.mockPayout, true]);

      await service.savePayout('user-1', { method: 'PayNow', paynowId: '12345' });

      expect(mocks.mockPayout.update).not.toHaveBeenCalled();
    });
  });

  // ── createCar ──

  describe('createCar', () => {
    it('creates a car for fleet_owner role', async () => {
      const result = await service.createCar(
        'user-1', 'fleet_owner', 'user@test.com', 'Test User', '+6590000001',
        { plateNumber: 'SBA1234A', make: 'Toyota', model: 'Corolla' }
      );

      expect(mocks.Car.create).toHaveBeenCalledWith(
        expect.objectContaining({
          plate_number: 'SBA1234A',
          make: 'Toyota',
          model: 'Corolla',
          status: 'active',
        })
      );
      expect(result).toBe(mocks.mockCar);
    });

    it('creates a car for driver_partner role and assigns driver', async () => {
      await service.createCar(
        'user-1', 'driver_partner', 'user@test.com', 'Test User', '+6590000001',
        { plateNumber: 'SBA1234A', make: 'Toyota', model: 'Corolla' }
      );

      const createArg = mocks.Car.create.mock.calls[0][0];
      expect(createArg.current_driver_id).toBe('user-1');
    });

    it('sets current_driver_id to null for fleet_owner', async () => {
      await service.createCar(
        'user-1', 'fleet_owner', 'user@test.com', 'Test User', '+6590000001',
        { plateNumber: 'SBA1234A', make: 'Toyota', model: 'Corolla' }
      );

      const createArg = mocks.Car.create.mock.calls[0][0];
      expect(createArg.current_driver_id).toBeNull();
    });

    it('throws 400 when plateNumber is missing', async () => {
      await expect(
        service.createCar('user-1', 'fleet_owner', 'user@test.com', 'Test', '+65', { make: 'Toyota', model: 'Corolla' })
      ).rejects.toThrow('plate_number, make, and model are required');
    });

    it('throws 400 when make is missing', async () => {
      await expect(
        service.createCar('user-1', 'fleet_owner', 'user@test.com', 'Test', '+65', { plateNumber: 'X', model: 'Y' })
      ).rejects.toThrow('plate_number, make, and model are required');
    });

    it('reuses existing fleet owner when one exists', async () => {
      mocks.FleetOwner.findOne.mockResolvedValue(mocks.mockFleetOwner);

      await service.createCar(
        'user-1', 'fleet_owner', 'user@test.com', 'Test', '+65',
        { plateNumber: 'X', make: 'Y', model: 'Z' }
      );

      expect(mocks.FleetOwner.create).not.toHaveBeenCalled();
    });
  });

  // ── bulkCreateCars ──

  describe('bulkCreateCars', () => {
    it('throws 403 for non fleet_owner', async () => {
      await expect(
        service.bulkCreateCars('user-1', 'e@e.com', 'N', '+65', 'agent', [{ plate_number: 'X', make: 'Y', model: 'Z' }])
      ).rejects.toThrow('Only fleet owners can bulk add cars');

      try {
        await service.bulkCreateCars('user-1', 'e@e.com', 'N', '+65', 'agent', []);
      } catch (err) {
        expect(err.statusCode).toBe(403);
      }
    });

    it('throws 400 when cars array is empty', async () => {
      await expect(
        service.bulkCreateCars('user-1', 'e@e.com', 'N', '+65', 'fleet_owner', [])
      ).rejects.toThrow('No cars provided');
    });

    it('throws 400 when cars is not an array', async () => {
      await expect(
        service.bulkCreateCars('user-1', 'e@e.com', 'N', '+65', 'fleet_owner', null)
      ).rejects.toThrow('No cars provided');
    });

    it('creates multiple cars for fleet_owner', async () => {
      const cars = [
        { plate_number: 'SBA1111A', make: 'Toyota', model: 'Corolla' },
        { plate_number: 'SBA2222B', make: 'Honda', model: 'Civic' },
      ];

      await service.bulkCreateCars('user-1', 'e@e.com', 'N', '+65', 'fleet_owner', cars);

      expect(mocks.Car.create).toHaveBeenCalledTimes(2);
    });
  });
});
