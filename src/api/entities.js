// REPLACED: Base44 entities with our custom API client
import { entities, auth } from './client.js';

export const Campaign = entities.Campaign;

export const Car = entities.Car;

export const Prospect = entities.Prospect;

export const QrTag = entities.QrTag;

export const Commission = entities.Commission;

export const FleetOwner = entities.FleetOwner;

export const Driver = entities.Driver;

export const LeadPackage = entities.LeadPackage;

// User entity for CRUD operations
export const User = entities.User;