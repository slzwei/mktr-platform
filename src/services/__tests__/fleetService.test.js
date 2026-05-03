import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFleetOwner = vi.hoisted(() => ({ list: vi.fn() }));
const mockCar = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() }));
const mockDriver = vi.hoisted(() => ({ list: vi.fn() }));
const mockFleet = vi.hoisted(() => ({ getStats: vi.fn() }));

vi.mock('@/api/entities', () => ({
 FleetOwner: mockFleetOwner,
 Car: mockCar,
 Driver: mockDriver,
}));

vi.mock('@/api/client', () => ({
 fleet: mockFleet,
}));

import {
 listFleetOwners,
 listCars,
 createCar,
 updateCar,
 deleteCar,
 listDrivers,
 getFleetStats,
} from '../fleetService';

describe('fleetService', () => {
 beforeEach(() => {
 vi.clearAllMocks();
 });

 describe('listFleetOwners', () => {
 it('calls FleetOwner.list with params', async () => {
 mockFleetOwner.list.mockResolvedValue([{ id: '1' }]);
 const result = await listFleetOwners({ page: 1 });
 expect(result).toEqual([{ id: '1' }]);
 expect(mockFleetOwner.list).toHaveBeenCalledWith({ page: 1 });
 });
 });

 describe('listCars', () => {
 it('calls Car.list with params', async () => {
 mockCar.list.mockResolvedValue([{ id: 'c-1', plate: 'SBA1234A' }]);
 const result = await listCars();
 expect(result).toEqual([{ id: 'c-1', plate: 'SBA1234A' }]);
 expect(mockCar.list).toHaveBeenCalledWith({});
 });
 });

 describe('createCar', () => {
 it('calls Car.create with data', async () => {
 const data = { plate: 'SBA1234A', model: 'Toyota' };
 mockCar.create.mockResolvedValue({ id: 'c-1', ...data });
 const result = await createCar(data);
 expect(result).toEqual({ id: 'c-1', ...data });
 });
 });

 describe('updateCar', () => {
 it('calls Car.update with id and data', async () => {
 mockCar.update.mockResolvedValue({ id: 'c-1', model: 'Honda' });
 const result = await updateCar('c-1', { model: 'Honda' });
 expect(result).toEqual({ id: 'c-1', model: 'Honda' });
 expect(mockCar.update).toHaveBeenCalledWith('c-1', { model: 'Honda' });
 });
 });

 describe('deleteCar', () => {
 it('calls Car.delete with id', async () => {
 mockCar.delete.mockResolvedValue({ success: true });
 await deleteCar('c-1');
 expect(mockCar.delete).toHaveBeenCalledWith('c-1');
 });
 });

 describe('listDrivers', () => {
 it('calls Driver.list with params', async () => {
 mockDriver.list.mockResolvedValue([{ id: 'd-1', name: 'Driver A' }]);
 const result = await listDrivers({ status: 'active' });
 expect(result).toEqual([{ id: 'd-1', name: 'Driver A' }]);
 expect(mockDriver.list).toHaveBeenCalledWith({ status: 'active' });
 });
 });

 describe('getFleetStats', () => {
 it('calls fleet.getStats', async () => {
 mockFleet.getStats.mockResolvedValue({ totalCars: 10, totalDrivers: 5 });
 const result = await getFleetStats();
 expect(result).toEqual({ totalCars: 10, totalDrivers: 5 });
 });
 });
});
