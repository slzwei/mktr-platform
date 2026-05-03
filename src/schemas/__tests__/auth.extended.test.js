import { describe, it, expect } from 'vitest';
import { loginSchema, registerSchema } from '../auth';

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

describe('registerSchema (extended)', () => {
 const validData = {
 full_name: 'John Doe',
 email: 'john@example.com',
 role: 'customer',
 password: 'password123',
 confirm_password: 'password123',
 };

 it('rejects empty full_name', () => {
 const result = registerSchema.safeParse({ ...validData, full_name: '' });
 expect(result.success).toBe(false);
 });

 it('rejects full_name exceeding 100 characters', () => {
 const result = registerSchema.safeParse({ ...validData, full_name: 'A'.repeat(101) });
 expect(result.success).toBe(false);
 });

 it('validates all valid roles', () => {
 ['customer', 'agent', 'fleet_owner'].forEach(role => {
 const result = registerSchema.safeParse({ ...validData, role });
 expect(result.success).toBe(true);
 });
 });

 it('rejects admin role', () => {
 const result = registerSchema.safeParse({ ...validData, role: 'admin' });
 expect(result.success).toBe(false);
 });

 it('rejects driver_partner role', () => {
 const result = registerSchema.safeParse({ ...validData, role: 'driver_partner' });
 expect(result.success).toBe(false);
 });

 it('validates with all optional fields present', () => {
 const result = registerSchema.safeParse({
 ...validData,
 phone: '91234567',
 company_name: 'Acme Corp',
 });
 expect(result.success).toBe(true);
 });

 it('rejects password of exactly 5 characters', () => {
 const result = registerSchema.safeParse({
 ...validData,
 password: '12345',
 confirm_password: '12345',
 });
 expect(result.success).toBe(false);
 });

 it('accepts password of exactly 6 characters', () => {
 const result = registerSchema.safeParse({
 ...validData,
 password: '123456',
 confirm_password: '123456',
 });
 expect(result.success).toBe(true);
 });

 it('rejects empty confirm_password', () => {
 const result = registerSchema.safeParse({ ...validData, confirm_password: '' });
 expect(result.success).toBe(false);
 });

 it('rejects when confirm_password differs by one character', () => {
 const result = registerSchema.safeParse({
 ...validData,
 password: 'password123',
 confirm_password: 'password124',
 });
 expect(result.success).toBe(false);
 expect(result.error.issues.some(i => i.path.includes('confirm_password'))).toBe(true);
 });
});
