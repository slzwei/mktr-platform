import { z } from 'zod';

export const agentInviteSchema = z.object({
  full_name: z.string().min(1, 'Full name is required').max(100),
  email: z.string().email('Please enter a valid email'),
  phone: z.string().max(20).optional().or(z.literal('')),
  dateOfBirth: z.string().optional().or(z.literal('')),
  owed_leads_count: z.coerce.number().min(0).optional(),
});

export type AgentInviteInput = z.infer<typeof agentInviteSchema>;
