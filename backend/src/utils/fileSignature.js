/**
 * Magic-byte sniffing + canonical extensions for everything stored under uploads/ (P0-1).
 *
 * Both the multipart Content-Type and the client filename are attacker-supplied,
 * so neither may decide what lands on disk: a part sent as `image/png` named
 * `evil.html` used to be stored verbatim as `evil-<uuid>.html` and served
 * text/html INLINE from the API origin, where the session cookie lives.
 *
 * The rule here: the bytes we actually received pick the extension, and anything
 * not on the inline allowlist is served as a download.
 */

const ascii = (buf, start, len) => buf.subarray(start, start + len).toString('latin1');

const PNG_MAGIC = '\x89PNG\r\n\x1a\n';

// Ordered: the narrower ftyp/EBML brands must be tested before their fallbacks.
const SIGNATURES = [
  { mime: 'image/jpeg', ext: 'jpg', match: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', ext: 'png', match: (b) => b.length >= 8 && ascii(b, 0, 8) === PNG_MAGIC },
  { mime: 'image/gif', ext: 'gif', match: (b) => b.length >= 6 && ['GIF87a', 'GIF89a'].includes(ascii(b, 0, 6)) },
  { mime: 'image/webp', ext: 'webp', match: (b) => b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP' },
  { mime: 'video/x-msvideo', ext: 'avi', match: (b) => b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'AVI ' },
  { mime: 'application/pdf', ext: 'pdf', match: (b) => b.length >= 5 && ascii(b, 0, 5) === '%PDF-' },
  { mime: 'video/3gpp', ext: '3gp', match: (b) => isFtyp(b) && ascii(b, 8, 3) === '3gp' },
  { mime: 'video/quicktime', ext: 'mov', match: (b) => isFtyp(b) && ascii(b, 8, 2) === 'qt' },
  { mime: 'video/mp4', ext: 'mp4', match: (b) => isFtyp(b) },
  { mime: 'video/webm', ext: 'webm', match: (b) => isEbml(b) && ebmlDocType(b) !== 'matroska' },
  { mime: 'video/x-matroska', ext: 'mkv', match: (b) => isEbml(b) },
];

function isFtyp(buf) {
  return buf.length >= 12 && ascii(buf, 4, 4) === 'ftyp';
}

function isEbml(buf) {
  return buf.length >= 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3;
}

/** DocType lives in the EBML header a few dozen bytes in; a substring probe is enough to split webm from mkv. */
function ebmlDocType(buf) {
  const head = ascii(buf, 0, Math.min(buf.length, 64));
  if (head.includes('webm')) return 'webm';
  if (head.includes('matroska')) return 'matroska';
  return null;
}

/**
 * Identify a file from its leading bytes.
 * Returns `{ mime, ext }` for a recognised type, or null — null means "reject",
 * never "trust the client's Content-Type".
 */
export function sniffFileType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return null;
  const hit = SIGNATURES.find((sig) => sig.match(buffer));
  return hit ? { mime: hit.mime, ext: hit.ext } : null;
}

/**
 * The one extension we will write for a given type. Used for the provisional
 * name multer picks from the declared MIME (before the bytes exist) so that even
 * a bypassed sniff can never put an executable extension on disk.
 */
export function canonicalExtensionForMime(mime) {
  const hit = SIGNATURES.find((sig) => sig.mime === mime);
  return hit ? hit.ext : 'bin';
}

/**
 * Extensions safe to serve inline from the API origin: passive media only.
 * Everything else — .svg, .pdf, .html, anything unrecognised — is forced to
 * download so a stored file can never execute script same-origin.
 */
export const INLINE_SAFE_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'mp4', 'webm', 'mov', 'm4v',
]);

/** True when a stored path may be served inline (Content-Type from its extension). */
export function isInlineSafePath(filePath) {
  const ext = String(filePath || '').split('.').pop().toLowerCase();
  return INLINE_SAFE_EXTENSIONS.has(ext);
}
