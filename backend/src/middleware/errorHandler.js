import { ValidationError, DatabaseError, ConnectionError } from 'sequelize';

export const errorHandler = (err, req, res, next) => {
  let error = { ...err };
  error.message = err.message;

  // Log error for debugging
  console.error('Error:', err);

  // Sequelize validation error
  if (err instanceof ValidationError) {
    const message = err.errors.map(error => error.message).join(', ');
    return res.status(400).json({
      success: false,
      message: 'Validation Error',
      details: message,
      errors: err.errors
    });
  }

  // Sequelize database error
  if (err instanceof DatabaseError) {
    return res.status(500).json({
      success: false,
      message: 'Database Error',
      details: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
    });
  }

  // Sequelize connection error
  if (err instanceof ConnectionError) {
    return res.status(503).json({
      success: false,
      message: 'Database Connection Error',
      details: 'Service temporarily unavailable'
    });
  }

  // Duplicate key error
  if (err.code === 11000 || err.name === 'SequelizeUniqueConstraintError') {
    const field = Object.keys(err.keyValue || {})[0] || 'field';
    return res.status(400).json({
      success: false,
      message: 'Duplicate Value Error',
      details: `${field} already exists`
    });
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      success: false,
      message: 'Invalid Token'
    });
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      message: 'Token Expired'
    });
  }

  // File upload errors
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({
      success: false,
      message: 'File too large',
      details: 'File size exceeds the maximum allowed limit'
    });
  }

  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(400).json({
      success: false,
      message: 'Invalid file upload',
      details: 'Unexpected file field'
    });
  }

  // Custom application errors
  if (err.statusCode) {
    return res.status(err.statusCode).json({
      success: false,
      message: err.message,
      details: err.details || null
    });
  }

  // Default server error
  res.status(500).json({
    success: false,
    message: 'Internal Server Error',
    details: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
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
