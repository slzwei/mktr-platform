/**
 * Client-side twin of the backend upload cap for honest editor copy.
 *
 * The backend enforces `MAX_UPLOAD_SIZE_MB` (default 10) on every `/api/uploads/*`
 * route (backend/src/routes/uploads.js) — the server stays the enforcement point;
 * this number is presentation only. `VITE_MAX_UPLOAD_SIZE_MB` is build-time: when
 * overriding the backend env, set it on every static-site build too or the editor
 * copy will drift from the real cap (it can only under- or over-state the hint —
 * uploads themselves are unaffected).
 */
const parsed = Number.parseInt(import.meta.env.VITE_MAX_UPLOAD_SIZE_MB, 10);
export const MAX_UPLOAD_SIZE_MB = Number.isFinite(parsed) && parsed > 0 ? parsed : 10;
