import { describe, it, expect } from 'vitest';
import { fleetOwnerSchema, driverInviteSchema, carSchema } from '../fleet';

describe('fleetOwnerSchema', () => {
  it('validates correct fleet owner data', () => {
    const result = fleetOwnerSchema.safeParse({
      full_name: 'Jane Tan',
      email: 'jane@fleet.com',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing full_name', () => {
    const result = fleetOwnerSchema.safeParse({
      full_name: '',
      email: 'jane@fleet.com',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid email', () => {
    const result = fleetOwnerSchema.safeParse({
      full_name: 'Jane Tan',
      email: 'not-email',
    });
    expect(result.success).toBe(false);
  });

  it('validates optional payout_method enum', () => {
    const result = fleetOwnerSchema.safeParse({
      full_name: 'Jane Tan',
      email: 'jane@fleet.com',
      payout_method: 'PayNow',
    });
    expect(result.success).toBe(true);
  });
});

describe('driverInviteSchema', () => {
  it('validates correct driver invite data', () => {
    const result = driverInviteSchema.safeParse({
      full_name: 'Ahmad',
      email: 'ahmad@driver.com',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty name', () => {
    const result = driverInviteSchema.safeParse({
      full_name: '',
      email: 'ahmad@driver.com',
    });
    expect(result.success).toBe(false);
  });

  it('allows empty phone', () => {
    const result = driverInviteSchema.safeParse({
      full_name: 'Ahmad',
      email: 'ahmad@driver.com',
      phone: '',
    });
    expect(result.success).toBe(true);
  });
});

describe('carSchema', () => {
  const validCar = {
    plate_number: 'SBA1234A',
    make: 'Toyota',
    model: 'Camry',
    year: 2022,
    type: 'sedan',
    fleet_owner_id: '550e8400-e29b-41d4-a716-446655440000',
  };

  it('validates correct car data', () => {
    const result = carSchema.safeParse(validCar);
    expect(result.success).toBe(true);
  });

  it('rejects missing plate_number', () => {
    const { plate_number, ...rest } = validCar;
    const result = carSchema.safeParse({ ...rest, plate_number: '' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid car type', () => {
    const result = carSchema.safeParse({ ...validCar, type: 'spaceship' });
    expect(result.success).toBe(false);
  });

  it('coerces year from string', () => {
    const result = carSchema.safeParse({ ...validCar, year: '2023' });
    expect(result.success).toBe(true);
    expect(result.data.year).toBe(2023);
  });

  it('rejects invalid fleet_owner_id', () => {
    const result = carSchema.safeParse({ ...validCar, fleet_owner_id: 'not-a-uuid' });
    expect(result.success).toBe(false);
  });
});
