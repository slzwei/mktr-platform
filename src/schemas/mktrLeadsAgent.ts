import { z } from 'zod';

// 8-digit SG mobile starting 8/9. Entry-form shape only — the mktr-leads edge
// function owns canonical normalization (it also accepts +65/65 prefixes), so
// keep this permissive about separators and strict about the digits.
const sgMobile = z
  .string()
  .min(1, 'Phone is required')
  .transform((v) => v.replace(/[\s()-]/g, ''))
  .refine((v) => /^(\+?65)?[89]\d{7}$/.test(v), 'Enter a Singapore mobile (8 digits starting 8 or 9)');

export const mktrLeadsInviteSchema = z.object({
  phone: sgMobile,
  full_name: z.string().max(120).optional().or(z.literal('')),
  email: z.string().email('Please enter a valid email').optional().or(z.literal('')),
  agency: z.string().max(120).optional().or(z.literal('')),
});

export const mktrLeadsEditSchema = z.object({
  full_name: z.string().min(1, 'Full name is required').max(120),
  email: z.string().email('Please enter a valid email').optional().or(z.literal('')),
  agency: z.string().max(120).optional().or(z.literal('')),
});

export type MktrLeadsInviteInput = z.infer<typeof mktrLeadsInviteSchema>;
export type MktrLeadsEditInput = z.infer<typeof mktrLeadsEditSchema>;
