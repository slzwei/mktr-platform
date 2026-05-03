import { describe, it, expect } from 'vitest';
import { loginSchema, registerSchema } from '../auth';

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

describe('registerSchema', () => {
 const validData = {
 full_name: 'John Doe',
 email: 'john@example.com',
 phone: '91234567',
 company_name: 'Acme',
 role: 'customer',
 password: 'password123',
 confirm_password: 'password123',
 };

 it('validates correct registration data', () => {
 const result = registerSchema.safeParse(validData);
 expect(result.success).toBe(true);
 });

 it('rejects mismatched passwords', () => {
 const result = registerSchema.safeParse({ ...validData, confirm_password: 'different' });
 expect(result.success).toBe(false);
 expect(result.error.issues[0].path).toEqual(['confirm_password']);
 });

 it('rejects password under 6 characters', () => {
 const result = registerSchema.safeParse({ ...validData, password: '12345', confirm_password: '12345' });
 expect(result.success).toBe(false);
 });

 it('rejects invalid role', () => {
 const result = registerSchema.safeParse({ ...validData, role: 'superadmin' });
 expect(result.success).toBe(false);
 });

 it('allows optional phone and company_name', () => {
 const { phone, company_name, ...required } = validData;
 const result = registerSchema.safeParse(required);
 expect(result.success).toBe(true);
 });
});
