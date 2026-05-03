/**
 * Frontend service layer barrel export.
 *
 * Services sit between React Query hooks and the raw API client entities,
 * providing consistent response normalization and a single import path.
 *
 * Usage in hooks:
 * import * as prospectService from '@/services/prospectService';
 * queryFn: () => prospectService.listProspects(params)
 *
 * Usage in components (for shared formatters):
 * import { formatPhone, formatCurrency } from '@/services/formatters';
 */
export * as prospectService from './prospectService';
export * as campaignService from './campaignService';
export * as fleetService from './fleetService';
export * as userService from './userService';
export * from './formatters';
