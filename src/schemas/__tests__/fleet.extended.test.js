import { describe, it, expect } from 'vitest';
import { carSchema, fleetOwnerSchema, driverSchema, driverInviteSchema } from '../fleet';

describe('carSchema (extended)', () => {
 const validCar = {
 plate_number: 'SBA1234A',
 make: 'Toyota',
 model: 'Camry',
 year: 2022,
 type: 'sedan',
 fleet_owner_id: '550e8400-e29b-41d4-a716-446655440000',
 };

 it('validates all car types', () => {
 const types = ['sedan', 'suv', 'truck', 'van', 'coupe', 'hatchback', 'convertible', 'other'];
 types.forEach(type => {
 const result = carSchema.safeParse({ ...validCar, type });
 expect(result.success).toBe(true);
 });
 });

 it('rejects year before 1900', () => {
 const result = carSchema.safeParse({ ...validCar, year: 1899 });
 expect(result.success).toBe(false);
 });

 it('accepts year of 1900', () => {
 const result = carSchema.safeParse({ ...validCar, year: 1900 });
 expect(result.success).toBe(true);
 });

 it('rejects plate_number exceeding 20 characters', () => {
 const result = carSchema.safeParse({ ...validCar, plate_number: 'A'.repeat(21) });
 expect(result.success).toBe(false);
 });

 it('rejects make exceeding 50 characters', () => {
 const result = carSchema.safeParse({ ...validCar, make: 'B'.repeat(51) });
 expect(result.success).toBe(false);
 });

 it('rejects model exceeding 50 characters', () => {
 const result = carSchema.safeParse({ ...validCar, model: 'C'.repeat(51) });
 expect(result.success).toBe(false);
 });

 it('allows optional color', () => {
 const result = carSchema.safeParse({ ...validCar, color: 'Red' });
 expect(result.success).toBe(true);
 });

 it('rejects color exceeding 30 characters', () => {
 const result = carSchema.safeParse({ ...validCar, color: 'X'.repeat(31) });
 expect(result.success).toBe(false);
 });

 it('allows optional status', () => {
 const result = carSchema.safeParse({ ...validCar, status: 'active' });
 expect(result.success).toBe(true);
 });

 it('validates all status enum values', () => {
 ['active', 'inactive', 'maintenance', 'retired'].forEach(status => {
 const result = carSchema.safeParse({ ...validCar, status });
 expect(result.success).toBe(true);
 });
 });

 it('rejects invalid status', () => {
 const result = carSchema.safeParse({ ...validCar, status: 'sold' });
 expect(result.success).toBe(false);
 });

 it('allows empty string VIN', () => {
 const result = carSchema.safeParse({ ...validCar, vin: '' });
 expect(result.success).toBe(true);
 });

 it('validates 17-character VIN', () => {
 const result = carSchema.safeParse({ ...validCar, vin: '1HGBH41JXMN109186' });
 expect(result.success).toBe(true);
 });

 it('rejects VIN not exactly 17 characters', () => {
 const result = carSchema.safeParse({ ...validCar, vin: '12345' });
 expect(result.success).toBe(false);
 });

 it('allows optional mileage', () => {
 const result = carSchema.safeParse({ ...validCar, mileage: 50000 });
 expect(result.success).toBe(true);
 });

 it('rejects negative mileage', () => {
 const result = carSchema.safeParse({ ...validCar, mileage: -1 });
 expect(result.success).toBe(false);
 });

 it('validates all fuel types', () => {
 ['gasoline', 'diesel', 'electric', 'hybrid', 'other'].forEach(fuelType => {
 const result = carSchema.safeParse({ ...validCar, fuelType });
 expect(result.success).toBe(true);
 });
 });
});

describe('fleetOwnerSchema (extended)', () => {
 const valid = { full_name: 'Jane', email: 'jane@test.com' };

 it('rejects full_name exceeding 100 characters', () => {
 const result = fleetOwnerSchema.safeParse({ ...valid, full_name: 'A'.repeat(101) });
 expect(result.success).toBe(false);
 });

 it('allows phone up to 20 characters', () => {
 const result = fleetOwnerSchema.safeParse({ ...valid, phone: '91234567' });
 expect(result.success).toBe(true);
 });

 it('allows company_name up to 100 characters', () => {
 const result = fleetOwnerSchema.safeParse({ ...valid, company_name: 'ACME Corp' });
 expect(result.success).toBe(true);
 });

 it('allows uen up to 50 characters', () => {
 const result = fleetOwnerSchema.safeParse({ ...valid, uen: 'UEN12345678' });
 expect(result.success).toBe(true);
 });

 it('validates payout_method Bank Transfer', () => {
 const result = fleetOwnerSchema.safeParse({ ...valid, payout_method: 'Bank Transfer' });
 expect(result.success).toBe(true);
 });

 it('rejects invalid payout_method', () => {
 const result = fleetOwnerSchema.safeParse({ ...valid, payout_method: 'Cash' });
 expect(result.success).toBe(false);
 });

 it('validates status enum', () => {
 ['active', 'inactive'].forEach(status => {
 const result = fleetOwnerSchema.safeParse({ ...valid, status });
 expect(result.success).toBe(true);
 });
 });
});

describe('driverSchema', () => {
 const valid = {
 licenseNumber: 'DL12345',
 licenseClass: 'Class 3',
 licenseExpiration: '2028-12-31',
 dateOfBirth: '1990-01-01',
 };

 it('validates correct driver data', () => {
 const result = driverSchema.safeParse(valid);
 expect(result.success).toBe(true);
 });

 it('rejects empty licenseNumber', () => {
 const result = driverSchema.safeParse({ ...valid, licenseNumber: '' });
 expect(result.success).toBe(false);
 });

 it('rejects empty licenseClass', () => {
 const result = driverSchema.safeParse({ ...valid, licenseClass: '' });
 expect(result.success).toBe(false);
 });

 it('rejects empty licenseExpiration', () => {
 const result = driverSchema.safeParse({ ...valid, licenseExpiration: '' });
 expect(result.success).toBe(false);
 });

 it('rejects empty dateOfBirth', () => {
 const result = driverSchema.safeParse({ ...valid, dateOfBirth: '' });
 expect(result.success).toBe(false);
 });

 it('allows optional experience', () => {
 const result = driverSchema.safeParse({ ...valid, experience: 5 });
 expect(result.success).toBe(true);
 });

 it('rejects experience exceeding 50', () => {
 const result = driverSchema.safeParse({ ...valid, experience: 51 });
 expect(result.success).toBe(false);
 });

 it('rejects negative experience', () => {
 const result = driverSchema.safeParse({ ...valid, experience: -1 });
 expect(result.success).toBe(false);
 });

 it('rejects licenseNumber exceeding 30 characters', () => {
 const result = driverSchema.safeParse({ ...valid, licenseNumber: 'X'.repeat(31) });
 expect(result.success).toBe(false);
 });

 it('rejects licenseClass exceeding 10 characters', () => {
 const result = driverSchema.safeParse({ ...valid, licenseClass: 'X'.repeat(11) });
 expect(result.success).toBe(false);
 });
});

describe('driverInviteSchema (extended)', () => {
 it('rejects full_name exceeding 100 characters', () => {
 const result = driverInviteSchema.safeParse({
 full_name: 'A'.repeat(101),
 email: 'test@test.com',
 });
 expect(result.success).toBe(false);
 });

 it('rejects phone exceeding 20 characters', () => {
 const result = driverInviteSchema.safeParse({
 full_name: 'Test',
 email: 'test@test.com',
 phone: '1'.repeat(21),
 });
 expect(result.success).toBe(false);
 });

 it('rejects invalid email', () => {
 const result = driverInviteSchema.safeParse({
 full_name: 'Test',
 email: 'bad-email',
 });
 expect(result.success).toBe(false);
 });
});
