// Runs before any test module is imported.
// Sets env vars that are read at module scope (e.g., auth.js JWT_SECRET).
// Defaults target local Homebrew PostgreSQL 15 on port 5433.
// CI overrides these via workflow env vars.
process.env.DB_HOST = process.env.DB_HOST || 'localhost';
process.env.DB_PORT = process.env.DB_PORT || '5433';
process.env.DB_NAME = process.env.DB_NAME || 'mktr_test';
process.env.DB_USER = process.env.DB_USER || 'postgres';
process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'postgres';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'local-test-placeholder';
process.env.NODE_ENV = 'test';
process.env.WEBHOOK_ENABLED = 'false'; // Don't fire real webhooks in tests
