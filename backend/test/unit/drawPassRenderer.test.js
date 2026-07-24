/**
 * Vault lucky-draw pass artwork — the two images of the draw journey.
 *
 * These are real satori→resvg renders (~150ms each), not mocks: the whole point
 * of the module is that it produces a PNG on the Render box without a system
 * font, and a mocked engine would prove nothing. What's asserted is the
 * contract every sender depends on — a decodable PNG comes back, the QR-less
 * state needs no qrContent, a bad colourway degrades instead of throwing, and a
 * multiplier the mockup never showed doesn't blow the layout.
 */
import { renderDrawPassPng } from '../../src/services/redeemOps/drawPassRenderer.js';
import { renderQrCardPng } from '../../src/services/redeemOps/qrCardRenderer.js';
import { PASS_THEMES } from '../../src/utils/drawTheme.js';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const LINK = `https://redeem.sg/r/${'x'.repeat(43)}`;

const base = {
  qrContent: LINK,
  multiplier: 10,
  prize: 'iPhone 17 Pro 256GB',
  firstName: 'Shawn',
  deadlineLong: '30 September 2026',
  drawDateLong: '22 October 2026',
};

/** A 1080×1080 PNG: magic bytes + the IHDR width/height big-endian at 16..24. */
function expectSquarePng(buf, size = 1080) {
  expect(buf.subarray(0, 4)).toEqual(PNG_MAGIC);
  expect(buf.readUInt32BE(16)).toBe(size);
  expect(buf.readUInt32BE(20)).toBe(size);
  expect(buf.length).toBeGreaterThan(10_000);
}

describe.each(PASS_THEMES)('colourway %s', (theme) => {
  test('renders both messages of the journey', async () => {
    const pass = await renderDrawPassPng({ ...base, variant: 'pass', theme });
    const boost = await renderDrawPassPng({ ...base, variant: 'boost', theme, qrContent: undefined });
    expectSquarePng(pass);
    expectSquarePng(boost);
    // Same layout, different artwork — the meter+QR message must not be
    // byte-identical to the QR-less receipt.
    expect(pass.equals(boost)).toBe(false);
  });
});

test('each colourway is actually a different image', async () => {
  const renders = await Promise.all(
    PASS_THEMES.map((theme) => renderDrawPassPng({ ...base, variant: 'boost', qrContent: undefined, theme }))
  );
  const digests = new Set(renders.map((b) => b.toString('base64').slice(0, 512)));
  expect(digests.size).toBe(PASS_THEMES.length);
});

test('an unknown colourway falls back to titanium instead of throwing', async () => {
  const bogus = await renderDrawPassPng({ ...base, variant: 'boost', qrContent: undefined, theme: 'chartreuse' });
  const titanium = await renderDrawPassPng({ ...base, variant: 'boost', qrContent: undefined, theme: 'titanium' });
  expect(bogus.equals(titanium)).toBe(true);
});

test('the boost receipt needs no QR; the entry pass insists on one', async () => {
  await expect(renderDrawPassPng({ ...base, variant: 'boost', qrContent: undefined })).resolves.toBeInstanceOf(Buffer);
  await expect(renderDrawPassPng({ ...base, variant: 'pass', qrContent: undefined })).rejects.toThrow(/qrContent/);
});

test('an unknown variant throws rather than guessing', async () => {
  await expect(renderDrawPassPng({ ...base, variant: 'sideways' })).rejects.toThrow(/variant/);
});

// The mockup was drawn around "9×". A campaign may run any multiplier from 2 to
// 100, and a fixed font-size would push "100×" off the card.
test.each([2, 10, 100])('a ×%i multiplier still renders', async (multiplier) => {
  const boost = await renderDrawPassPng({ ...base, variant: 'boost', qrContent: undefined, multiplier });
  expectSquarePng(boost);
});

test('a missing draw date drops the stat rather than borrowing another date', async () => {
  const withDate = await renderDrawPassPng({ ...base, variant: 'boost', qrContent: undefined });
  const without = await renderDrawPassPng({ ...base, variant: 'boost', qrContent: undefined, drawDateLong: null });
  expect(withDate.equals(without)).toBe(false);
});

describe('renderQrCardPng routing', () => {
  const draw = { multiplier: 10, prize: 'iPhone 17 Pro', drawOn: '2026-10-22', passTheme: 'gold', boostClosesAt: '2026-09-30' };

  test('a draw context routes to the Vault, not the Editorial frame', async () => {
    const vault = await renderQrCardPng({ state: 'pass', qrContent: LINK, rewardName: 'Lucky draw entry', draw });
    const editorial = await renderQrCardPng({ state: 'pass', qrContent: LINK, rewardName: 'Lucky draw entry' });
    expectSquarePng(vault);
    expectSquarePng(editorial);
    expect(vault.equals(editorial)).toBe(false);
    // The Vault is a dark, near-photographic frame; the Editorial one is flat
    // cream. Compressed size is a crude but stable proxy for "different design".
    expect(vault.length).toBeGreaterThan(editorial.length);
  });

  test('trial rewards are untouched by the draw work', async () => {
    const voucher = await renderQrCardPng({ state: 'voucher', qrContent: 'tok', rewardName: 'Free coffee', partnerName: 'Cafe', shortCode: 'AB12' });
    expectSquarePng(voucher);
  });

  // A boost card without draw context would render a partner-voucher frame
  // celebrating a reward that does not exist. Senders catch this and ship
  // without an image instead.
  test('a boost card without draw context throws', async () => {
    await expect(renderQrCardPng({ state: 'boost' })).rejects.toThrow(/draw context/);
  });

  test('an unknown state throws', async () => {
    await expect(renderQrCardPng({ state: 'gift', qrContent: 'x' })).rejects.toThrow(/unknown card state/);
  });
});
