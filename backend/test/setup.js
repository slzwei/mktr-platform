// Runs before any test module is imported.
// Sets env vars that are read at module scope (e.g., auth.js JWT_SECRET).
process.env.JWT_SECRET = process.env.JWT_SECRET || 'dev-jwt-secret-key';
process.env.NODE_ENV = 'test';
