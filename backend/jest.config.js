export default {
  testEnvironment: 'node',
  transform: {},
  verbose: false,
  // Applies to hooks as well as tests. Generous ON PURPOSE: booting the app in
  // a beforeAll costs ~1.5s on a fresh database, so anything in this range is
  // never measuring the code — it is measuring how contended the runner was.
  // At 20000 the migration-replay suites (which rebuild a chain in beforeAll)
  // still timed out on a GitHub runner while passing locally, turning shared-CPU
  // noise into a red build on an unrelated PR. A ceiling this high still catches
  // a genuine hang; it just stops reporting contention as failure.
  testTimeout: 60000,
  // maxWorkers=1 avoids DB contention between test suites
  maxWorkers: 1,
  // forceExit needed: Express + morgan + process.on handlers keep Node alive
  forceExit: true,
  // Set env vars before any modules are loaded (JWT_SECRET, NODE_ENV)
  setupFiles: ['./test/setup.js'],
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/tests/**',
    '!src/database/migrations/**',
    '!src/database/seed/**',
  ],
  coverageReporters: ['text', 'text-summary', 'lcov'],
}
