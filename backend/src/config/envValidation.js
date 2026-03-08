/**
 * Validate that required environment variables are set in production.
 * Call once at startup — throws on missing required vars.
 */
export function validateEnv() {
  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) return;

  const required = [
    'JWT_SECRET',
    'DB_HOST',
    'DB_NAME',
    'DB_USER',
    'DB_PASSWORD',
  ];

  const recommended = [
    'CORS_ORIGIN',
    'IP_HASH_SALT',
    'ATTRIB_SECRET',
  ];

  const missing = required.filter(key => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`FATAL: Missing required environment variables: ${missing.join(', ')}`);
  }

  const missingRecommended = recommended.filter(key => !process.env[key]);
  if (missingRecommended.length > 0) {
    console.warn(`⚠️ Recommended environment variables not set: ${missingRecommended.join(', ')}`);
  }
}
