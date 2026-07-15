// Runs before any test module is imported.
// Local: Homebrew PostgreSQL 15 on port 5433
// CI: GitHub Actions Postgres service on port 5432 with trust auth
process.env.DB_HOST = process.env.DB_HOST || 'localhost';
process.env.DB_PORT = process.env.DB_PORT || '5433';
process.env.DB_NAME = process.env.DB_NAME || 'mktr_test';
process.env.DB_USER = process.env.DB_USER || 'mktr_local';
process.env.DB_PASSWORD = process.env.DB_PASSWORD || '';

if (!process.env.JWT_SECRET) {
  console.error('JWT_SECRET env var is required. Set it before running tests.');
  process.exit(1);
}

process.env.NODE_ENV = 'test';
process.env.WEBHOOK_ENABLED = 'false';

// Fleet-era routers (fleet/vehicles/devices/provisioning/commissions/apk/adtech)
// are dark in production (FLEET_ROUTES_ENABLED unset) but stay mounted under
// test so their suites keep guarding the code until it is removed outright.
process.env.FLEET_ROUTES_ENABLED = 'true';
