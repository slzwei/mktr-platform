/**
 * The composer between the optimiser and the upload endpoint. The url it
 * returns MUST be the absolute one — the public page is on rsvp.redeem.sg,
 * which does not proxy /uploads.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { uploadFileMock, optimizeMock } = vi.hoisted(() => ({ uploadFileMock: vi.fn(), optimizeMock: vi.fn() }));
vi.mock('@/api/integrations', () => ({ UploadFile: uploadFileMock }));
vi.mock('@/lib/uploadLimits', () => ({ MAX_UPLOAD_SIZE_MB: 10 }));
vi.mock('@/lib/imageOptimize', async (orig) => ({ ...(await orig()), optimizeImageFile: optimizeMock }));

const { uploadRsvpImage } = await import('../rsvpImageUpload');

const sized = (name, type, size) => {
  const f = new File([new Uint8Array(1)], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
};

beforeEach(() => { uploadFileMock.mockReset(); optimizeMock.mockReset(); });

describe('uploadRsvpImage', () => {
  it('optimises, uploads as an image, and returns the ABSOLUTE url', async () => {
    const small = sized('hero.webp', 'image/webp', 180 * 1024);
    optimizeMock.mockResolvedValue({ file: small, bytesBefore: 6 * 1024 * 1024, bytesAfter: 180 * 1024, width: 1600, height: 1200 });
    uploadFileMock.mockResolvedValue({ file: { url: '/uploads/images/hero.webp', publicUrl: 'https://api.mktr.sg/uploads/images/hero.webp' } });

    const out = await uploadRsvpImage(sized('IMG.jpg', 'image/jpeg', 6 * 1024 * 1024));

    expect(uploadFileMock).toHaveBeenCalledWith(small, 'images');
    expect(out.url).toBe('https://api.mktr.sg/uploads/images/hero.webp');
    expect(out.note).toContain('6.0MB to 180KB');
    expect(out.note).toContain('1600 by 1200');
  });

  it('falls back to the relative url only when no absolute one came back', async () => {
    const f = sized('a.webp', 'image/webp', 1000);
    optimizeMock.mockResolvedValue({ file: f, skipped: 'already-small' });
    uploadFileMock.mockResolvedValue({ file: { url: '/uploads/images/a.webp' } });
    const out = await uploadRsvpImage(f);
    expect(out.url).toBe('/uploads/images/a.webp');
    expect(out.note).toContain('already small enough');
  });

  it('refuses a file that is still over the limit after optimising, without uploading', async () => {
    const huge = sized('raw.jpg', 'image/jpeg', 11 * 1024 * 1024);
    optimizeMock.mockResolvedValue({ file: huge, skipped: 'decode-failed' });
    await expect(uploadRsvpImage(huge)).rejects.toThrow('maximum 10MB');
    expect(uploadFileMock).not.toHaveBeenCalled();
  });

  it('explains a response with no url instead of storing an empty one', async () => {
    const f = sized('a.webp', 'image/webp', 1000);
    optimizeMock.mockResolvedValue({ file: f, skipped: 'already-small' });
    uploadFileMock.mockResolvedValue({ file: {} });
    await expect(uploadRsvpImage(f)).rejects.toThrow('did not return a link');
  });
});
