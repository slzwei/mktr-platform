import { z } from 'zod';

export const campaignSchema = z.object({
  name: z.string().min(1, 'Campaign name is required').max(100),
  description: z.string().optional(),
  type: z.enum(['lead_generation', 'brand_awareness', 'product_promotion', 'event_marketing']),
  budget: z.coerce.number().min(0).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  landingPageUrl: z.string().url('Must be a valid URL').optional().or(z.literal('')),
  callToAction: z.string().max(200).optional(),
  agentAssignmentMode: z.enum(['direct', 'round_robin']).optional(),
});

export type CampaignInput = z.infer<typeof campaignSchema>;
