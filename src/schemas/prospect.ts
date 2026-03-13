import { z } from 'zod';

export const prospectSchema = z.object({
  firstName: z.string().min(1, 'First name is required').max(50),
  lastName: z.string().max(50).optional(),
  email: z.string().email('Please enter a valid email'),
  phone: z.string().min(8, 'Phone must be at least 8 digits').max(20).optional().or(z.literal('')),
  company: z.string().max(100).optional(),
  jobTitle: z.string().max(100).optional(),
  leadSource: z.enum(['qr_code', 'website', 'referral', 'social_media', 'advertisement', 'direct', 'other']),
  campaignId: z.string().uuid().optional().nullable(),
  date_of_birth: z.string().optional(),
  postal_code: z.string().optional(),
});

export type ProspectInput = z.infer<typeof prospectSchema>;
