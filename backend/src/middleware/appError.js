/**
 * AppError lives alone so pure utils (luckyDraw → designConfigV2Clamp →
 * listingDerivation) can throw operational errors WITHOUT dragging in
 * errorHandler's sequelize/pino imports — the frontend lockstep tests load
 * that util chain inside vitest, where backend deps are not installed.
 * errorHandler.js re-exports this class; existing imports keep working.
 */
export class AppError extends Error {
  constructor(message, statusCode, details = null) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}
