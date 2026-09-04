/**
 * Uploads must be addressable from a surface that does NOT proxy /uploads.
 * rsvp.redeem.sg is such a surface, so the RSVP designer stores `publicUrl`.
 */
import { absoluteUploadUrl } from '../../src/services/uploadService.js';

describe('absoluteUploadUrl', () => {
  const original = process.env.API_PUBLIC_ORIGIN;
  afterEach(() => {
    if (original === undefined) delete process.env.API_PUBLIC_ORIGIN;
    else process.env.API_PUBLIC_ORIGIN = original;
  });

  test('prefixes a stored path with the configured public origin', () => {
    process.env.API_PUBLIC_ORIGIN = 'https://api.example.test';
    expect(absoluteUploadUrl('/uploads/images/a.webp')).toBe('https://api.example.test/uploads/images/a.webp');
  });

  test('defaults to the production API origin and tolerates a trailing slash', () => {
    delete process.env.API_PUBLIC_ORIGIN;
    expect(absoluteUploadUrl('/uploads/images/a.webp')).toBe('https://api.mktr.sg/uploads/images/a.webp');
    process.env.API_PUBLIC_ORIGIN = 'https://api.example.test/';
    expect(absoluteUploadUrl('/uploads/images/a.webp')).toBe('https://api.example.test/uploads/images/a.webp');
    expect(absoluteUploadUrl('uploads/images/a.webp')).toBe('https://api.example.test/uploads/images/a.webp');
  });

  test('leaves an already-absolute storage URL alone, and empty stays empty', () => {
    expect(absoluteUploadUrl('https://cdn.example.test/x.webp')).toBe('https://cdn.example.test/x.webp');
    expect(absoluteUploadUrl('')).toBe('');
    expect(absoluteUploadUrl(null)).toBe('');
  });
});
