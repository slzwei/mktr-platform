import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import ffmpegPath from 'ffmpeg-static';
import { logger } from '../utils/logger.js';
import { AppError } from '../middleware/errorHandler.js';

// Hard cap on a single synchronous transcode (runs inside the upload request).
const TRANSCODE_TIMEOUT_MS = 120000;

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error('ffmpeg binary not available'));
    const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
      if (stderr.length > 8000) stderr = stderr.slice(-8000);
    });
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error('Transcode timed out'));
    }, TRANSCODE_TIMEOUT_MS);
    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.split('\n').filter(Boolean).slice(-3).join(' | ')}`));
    });
  });
}

/**
 * Normalize an uploaded video (a multer disk file) to a web-optimized, SILENT
 * MP4 ready to be used as a muted, auto-looping hero background:
 *   - H.264 / yuv420p           → plays in every browser (fixes MOV/HEVC)
 *   - -an                       → audio track stripped (truly silent, smaller)
 *   - +faststart                → starts playing before fully downloaded
 *   - scale='min(1280,iw)':-2   → cap width at 1280 (never upscales), even height
 *
 * Mutates `file` in place to point at the new .mp4 (path/filename/mimetype/size/
 * originalname), deletes the source, and returns it. Non-video files pass through
 * untouched. Throws an AppError(400) if transcoding fails so the upload surfaces
 * a friendly message rather than storing an unplayable file.
 */
export async function transcodeUploadedVideoToMp4(file) {
  if (!file?.mimetype?.startsWith('video/')) return file;

  const srcPath = file.path;
  const dir = path.dirname(srcPath);
  const base = path.basename(srcPath, path.extname(srcPath));
  const candidate = path.join(dir, `${base}.mp4`);
  // If the source is already named .mp4, transcode to a distinct name then drop the source.
  const outPath = candidate === srcPath ? path.join(dir, `${base}-web.mp4`) : candidate;

  const args = [
    '-y',
    '-i', srcPath,
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-vf', "scale='min(1280,iw)':-2",
    '-an',
    '-movflags', '+faststart',
    '-preset', 'veryfast',
    '-crf', '23',
    outPath,
  ];

  logger.info('Transcoding uploaded video', { original: file.originalname, mimetype: file.mimetype, size: file.size });
  try {
    await runFfmpeg(args);
  } catch (err) {
    try {
      if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
    } catch (e) {
      void e;
    }
    logger.error('Video transcode failed', { error: err?.message, original: file.originalname });
    throw new AppError('Could not process that video. Please try a shorter MP4 or MOV clip.', 400);
  }

  // Drop the original source; keep only the web MP4.
  if (srcPath !== outPath) {
    try {
      fs.unlinkSync(srcPath);
    } catch (e) {
      void e;
    }
  }

  const stat = fs.statSync(outPath);
  file.path = outPath;
  file.filename = path.basename(outPath);
  file.mimetype = 'video/mp4';
  file.size = stat.size;
  file.originalname = `${path.basename(file.originalname, path.extname(file.originalname))}.mp4`;
  logger.info('Video transcoded to web MP4', { filename: file.filename, size: file.size });
  return file;
}
