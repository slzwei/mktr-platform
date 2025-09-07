import { signAssetUrl } from '../utils/assetSigning.js';

describe('asset signing placeholder', () => {
  it('returns expiresAt >= manifest refresh seconds', () => {
    process.env.MANIFEST_REFRESH_SECONDS = '120';
    const start = Date.now();
    const { url, expiresAt } = signAssetUrl('http://cdn.example/test.mp4', 30);
    expect(url).toBe('http://cdn.example/test.mp4');
    const deltaSec = (new Date(expiresAt).getTime() - start) / 1000;
    expect(deltaSec).toBeGreaterThanOrEqual(120);
  });
});


