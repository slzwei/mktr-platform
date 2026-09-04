import { UploadFile } from '@/api/integrations';
import { MAX_UPLOAD_SIZE_MB } from '@/lib/uploadLimits';
import { optimizeImageFile, formatBytes } from '@/lib/imageOptimize';

/**
 * Designer image picker: shrink and re-encode in the browser, upload, and hand
 * back the ABSOLUTE url. Absolute matters — the public page is served from
 * rsvp.redeem.sg, which has no /uploads proxy, so a relative path would 404
 * there while looking perfect in the designer's preview on mktr.sg.
 */
export async function uploadRsvpImage(file) {
  const { file: out, bytesBefore, bytesAfter, width, height } = await optimizeImageFile(file);

  if (out.size > MAX_UPLOAD_SIZE_MB * 1024 * 1024) {
    throw new Error(`Image is too large — maximum ${MAX_UPLOAD_SIZE_MB}MB.`);
  }

  const result = await UploadFile(out, 'images');
  const url = result?.file?.publicUrl || result?.file?.url || '';
  if (!url) throw new Error('The upload did not return a link. Please try again.');

  const note = bytesAfter
    ? `Optimised for fast loading: ${formatBytes(bytesBefore)} to ${formatBytes(bytesAfter)}, ${width} by ${height}.`
    : 'Uploaded. This picture was already small enough to send as it is.';

  return { url, note };
}
