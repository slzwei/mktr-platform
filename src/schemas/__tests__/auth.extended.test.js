import { describe, it, expect } from 'vitest';
import { loginSchema } from '../auth';

describe('loginSchema (extended)', () => {
 it('validates correct login with long password', () => {
 const result = loginSchema.safeParse({ email: 'user@example.com', password: 'a'.repeat(100) });
 expect(result.success).toBe(true);
 });

 it('rejects missing email field entirely', () => {
 const result = loginSchema.safeParse({ password: 'secret' });
 expect(result.success).toBe(false);
 });

 it('rejects missing password field entirely', () => {
 const result = loginSchema.safeParse({ email: 'user@example.com' });
 expect(result.success).toBe(false);
 });

 it('rejects email with spaces', () => {
 const result = loginSchema.safeParse({ email: 'user @example.com', password: 'secret' });
 expect(result.success).toBe(false);
 });

 it('rejects email without domain', () => {
 const result = loginSchema.safeParse({ email: 'user@', password: 'secret' });
 expect(result.success).toBe(false);
 });

 it('validates email with subdomain', () => {
 const result = loginSchema.safeParse({ email: 'user@mail.example.com', password: 'secret' });
 expect(result.success).toBe(true);
 });

 it('validates email with plus addressing', () => {
 const result = loginSchema.safeParse({ email: 'user+tag@example.com', password: 'secret' });
 expect(result.success).toBe(true);
 });
});
