import { describe, it, expect } from 'vitest';
import { loginSchema } from '../auth';

describe('loginSchema', () => {
 it('validates a correct login', () => {
 const result = loginSchema.safeParse({ email: 'user@example.com', password: 'secret' });
 expect(result.success).toBe(true);
 });

 it('rejects invalid email', () => {
 const result = loginSchema.safeParse({ email: 'not-an-email', password: 'secret' });
 expect(result.success).toBe(false);
 expect(result.error.issues[0].path).toEqual(['email']);
 });

 it('rejects empty password', () => {
 const result = loginSchema.safeParse({ email: 'user@example.com', password: '' });
 expect(result.success).toBe(false);
 });
});
