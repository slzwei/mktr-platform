import { z } from 'zod';

export const carSchema = z.object({
  plate_number: z.string().min(1, 'Plate number is required').max(20),
  make: z.string().min(1, 'Make is required').max(50),
  model: z.string().min(1, 'Model is required').max(50),
  year: z.coerce.number().min(1900).max(new Date().getFullYear() + 1),
  color: z.string().max(30).optional(),
  type: z.enum(['sedan', 'suv', 'truck', 'van', 'coupe', 'hatchback', 'convertible', 'other']),
  status: z.enum(['active', 'inactive', 'maintenance', 'retired']).optional(),
  fleet_owner_id: z.string().uuid('Fleet owner is required'),
  vin: z.string().length(17, 'VIN must be 17 characters').optional().or(z.literal('')),
  mileage: z.coerce.number().min(0).optional(),
  fuelType: z.enum(['gasoline', 'diesel', 'electric', 'hybrid', 'other']).optional(),
});

export const fleetOwnerSchema = z.object({
  full_name: z.string().min(1, 'Full name is required').max(100),
  email: z.string().email('Please enter a valid email'),
  phone: z.string().max(20).optional(),
  company_name: z.string().max(100).optional(),
  uen: z.string().max(50).optional(),
  payout_method: z.enum(['PayNow', 'Bank Transfer']).optional(),
  status: z.enum(['active', 'inactive']).optional(),
});

export const driverSchema = z.object({
  licenseNumber: z.string().min(1, 'License number is required').max(30),
  licenseClass: z.string().min(1, 'License class is required').max(10),
  licenseExpiration: z.string().min(1, 'License expiration is required'),
  dateOfBirth: z.string().min(1, 'Date of birth is required'),
  experience: z.coerce.number().min(0).max(50).optional(),
});

export const driverInviteSchema = z.object({
  full_name: z.string().min(1, 'Full name is required').max(100),
  email: z.string().email('Please enter a valid email'),
  phone: z.string().max(20).optional().or(z.literal('')),
});

export type CarInput = z.infer<typeof carSchema>;
export type FleetOwnerInput = z.infer<typeof fleetOwnerSchema>;
export type DriverInput = z.infer<typeof driverSchema>;
export type DriverInviteInput = z.infer<typeof driverInviteSchema>;
