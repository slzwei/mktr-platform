import { z } from 'zod';

export const leadPackageSchema = z.object({
  campaign_id: z.string().min(1, 'Campaign is required'),
  package_name: z.string().min(1, 'Package name is required').max(100),
  total_leads: z.coerce.number().min(1, 'At least 1 lead required'),
  price_per_lead: z.coerce.number().min(0, 'Price must be positive'),
  start_date: z.string().optional().or(z.literal('')),
  end_date: z.string().optional().or(z.literal('')),
  payment_status: z.enum(['pending', 'paid', 'partial']).optional(),
  notes: z.string().max(500).optional().or(z.literal('')),
});

export const leadPackageTemplateSchema = z.object({
  name: z.string().min(1, 'Package name is required').max(100),
  description: z.string().max(500).optional().or(z.literal('')),
  campaignId: z.string().min(1, 'Campaign is required'),
  type: z.enum(['basic', 'premium', 'enterprise', 'custom']).optional(),
  leadCount: z.coerce.number().min(1, 'At least 1 lead required'),
  price: z.coerce.number().min(0, 'Price must be positive'),
  isPublic: z.boolean().optional(),
  status: z.enum(['active', 'inactive']).optional(),
});

export type LeadPackageInput = z.infer<typeof leadPackageSchema>;
export type LeadPackageTemplateInput = z.infer<typeof leadPackageTemplateSchema>;
