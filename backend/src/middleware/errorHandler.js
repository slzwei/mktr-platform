import { ValidationError, DatabaseError, ConnectionError } from 'sequelize';
import { logger } from '../utils/logger.js';
import { maskTokenUrl } from '../utils/redactTokens.js';

export const errorHandler = (err, req, res, _next) => {
  let error = { ...err };
  error.message = err.message;

  // Structured error logging via pino (replaces console.error)
  logger.error(
    {
      err: { message: err.message, statusCode: err.statusCode, stack: err.stack },
      req: { method: req.method, url: maskTokenUrl(req.originalUrl), id: req.id },
    },
    'Request error'
  );

  const isDev = process.env.NODE_ENV === 'development';

  // Sequelize validation error
  if (err instanceof ValidationError) {
    const message = err.errors.map((error) => error.message).join(', ');
    return res.status(400).json({
      success: false,
      message: 'Validation Error',
      ...(isDev ? { details: message, errors: err.errors } : { details: 'Invalid input data' }),
    });
  }

  // Sequelize database error
  if (err instanceof DatabaseError) {
    return res.status(500).json({
      success: false,
      message: 'Database Error',
      details: isDev ? err.message : 'Internal server error',
    });
  }

  // Sequelize connection error
  if (err instanceof ConnectionError) {
    return res.status(503).json({
      success: false,
      message: 'Database Connection Error',
      details: 'Service temporarily unavailable',
    });
  }

  // Duplicate key error
  if (err.code === 11000 || err.name === 'SequelizeUniqueConstraintError') {
    return res.status(400).json({
      success: false,
      message: 'Duplicate Value Error',
      details: isDev ? `${Object.keys(err.keyValue || {})[0] || 'field'} already exists` : 'A record with this value already exists',
    });
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      success: false,
      message: 'Invalid Token',
    });
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      message: 'Token Expired',
    });
  }

  // File upload errors
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({
      success: false,
      message: 'File too large',
      details: 'File size exceeds the maximum allowed limit',
    });
  }

  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(400).json({
      success: false,
      message: 'Invalid file upload',
      details: 'Unexpected file field',
    });
  }

  // Custom application errors (AppError instances are intentional — safe to expose)
  if (err.statusCode && err.isOperational) {
    return res.status(err.statusCode).json({
      success: false,
      message: err.message,
      // Structured, non-sensitive payload an operational error opts into carrying (e.g. the
      // existing prospect's canonical share link on a duplicate-signup 409). Only present
      // when the thrower explicitly sets err.data.
      ...(err.data ? { data: err.data } : {}),
      ...(isDev && err.details ? { details: err.details } : {}),
    });
  }

  // Non-operational error with a statusCode — don't leak message in production
  if (err.statusCode) {
    return res.status(err.statusCode).json({
      success: false,
      message: isDev ? err.message : 'An error occurred',
    });
  }

  // Default server error
  res.status(500).json({
    success: false,
    message: 'Internal Server Error',
    details: isDev ? err.message : 'Something went wrong',
  });
};

// Custom error class
export class AppError extends Error {
  constructor(message, statusCode, details = null) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

// Async error wrapper
export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};
