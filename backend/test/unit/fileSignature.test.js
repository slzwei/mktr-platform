/**
 * Magic-byte sniffing + the inline-serving allowlist (P0-1). The stored
 * extension must come from the bytes, never from the client's Content-Type or
 * filename, and only passive media may be served inline from the API origin.
 */
import '../setup.js';
import {
  sniffFileType,
  canonicalExtensionForMime,
  isInlineSafePath,
  INLINE_SAFE_EXTENSIONS
} from '../../src/utils/fileSignature.js';

const png = () => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const jpeg = () => Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const gif = () => Buffer.from('GIF89a\x01\x00\x01\x00', 'latin1');
const webp = () => Buffer.concat([Buffer.from('RIFF', 'latin1'), Buffer.alloc(4), Buffer.from('WEBPVP8 ', 'latin1')]);
const avi = () => Buffer.concat([Buffer.from('RIFF', 'latin1'), Buffer.alloc(4), Buffer.from('AVI LIST', 'latin1')]);
const pdf = () => Buffer.from('%PDF-1.4 doc', 'latin1');
const ftyp = (brand) => Buffer.concat([Buffer.alloc(4), Buffer.from(`ftyp${brand}`, 'latin1'), Buffer.alloc(4)]);
const ebml = (docType) => Buffer.concat([
  Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
  Buffer.from(`\x42\x82\x84${docType}`, 'latin1'),
  Buffer.alloc(16)
]);

describe('sniffFileType', () => {
  it.each([
    ['png', png(), 'image/png', 'png'],
    ['jpeg', jpeg(), 'image/jpeg', 'jpg'],
    ['gif', gif(), 'image/gif', 'gif'],
    ['webp', webp(), 'image/webp', 'webp'],
    ['avi', avi(), 'video/x-msvideo', 'avi'],
    ['pdf', pdf(), 'application/pdf', 'pdf'],
    ['mp4', ftyp('isom'), 'video/mp4', 'mp4'],
    ['quicktime', ftyp('qt  '), 'video/quicktime', 'mov'],
    ['3gpp', ftyp('3gp5'), 'video/3gpp', '3gp'],
    ['webm', ebml('webm'), 'video/webm', 'webm'],
    ['matroska', ebml('matroska'), 'video/x-matroska', 'mkv']
  ])('identifies %s from its magic bytes', (_label, buf, mime, ext) => {
    expect(sniffFileType(buf)).toEqual({ mime, ext });
  });

  it('returns null for HTML disguised as an image', () => {
    expect(sniffFileType(Buffer.from('<html><script>alert(1)</script></html>'))).toBeNull();
  });

  it.each([
    ['empty buffer', Buffer.alloc(0)],
    ['plain text', Buffer.from('just some text')],
    ['non-buffer', 'not a buffer'],
    ['RIFF that is neither WEBP nor AVI', Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVEfmt ')])]
  ])('returns null for %s', (_label, input) => {
    expect(sniffFileType(input)).toBeNull();
  });
});

describe('canonicalExtensionForMime', () => {
  it('maps every accepted MIME to exactly one extension', () => {
    expect(canonicalExtensionForMime('image/png')).toBe('png');
    expect(canonicalExtensionForMime('image/jpeg')).toBe('jpg');
    expect(canonicalExtensionForMime('application/pdf')).toBe('pdf');
    expect(canonicalExtensionForMime('video/quicktime')).toBe('mov');
  });

  it('falls back to .bin rather than echoing an unknown type', () => {
    expect(canonicalExtensionForMime('text/html')).toBe('bin');
    expect(canonicalExtensionForMime(undefined)).toBe('bin');
  });
});

describe('isInlineSafePath', () => {
  it.each(['a.png', 'a.JPG', 'dir/b.mp4', 'c.webp'])('serves %s inline', (p) => {
    expect(isInlineSafePath(p)).toBe(true);
  });

  it.each(['evil.html', 'evil.svg', 'doc.pdf', 'script.js', 'noextension', ''])('forces %s to download', (p) => {
    expect(isInlineSafePath(p)).toBe(false);
  });

  it('never lets an executable type onto the inline allowlist', () => {
    for (const ext of ['html', 'htm', 'svg', 'js', 'xml', 'pdf']) {
      expect(INLINE_SAFE_EXTENSIONS.has(ext)).toBe(false);
    }
  });
});
