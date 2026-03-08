const LOG_LEVEL = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug');
const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

function shouldLog(level) {
  return LEVELS[level] <= LEVELS[LOG_LEVEL];
}

function formatLog(level, message, meta = {}) {
  if (process.env.NODE_ENV === 'production') {
    // JSON structured logging for production (easy to parse by log aggregators)
    return JSON.stringify({ timestamp: new Date().toISOString(), level, message, ...meta });
  }
  // Human-readable for dev
  const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
  return `[${new Date().toISOString()}] ${level.toUpperCase()}: ${message}${metaStr}`;
}

export const logger = {
  error: (message, meta = {}) => { if (shouldLog('error')) console.error(formatLog('error', message, meta)); },
  warn: (message, meta = {}) => { if (shouldLog('warn')) console.warn(formatLog('warn', message, meta)); },
  info: (message, meta = {}) => { if (shouldLog('info')) console.log(formatLog('info', message, meta)); },
  debug: (message, meta = {}) => { if (shouldLog('debug')) console.log(formatLog('debug', message, meta)); },
};
