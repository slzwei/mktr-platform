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
  // ...but one worker means ONE heap for every suite in the run: each suite's
  // models, Express app and module graph stay resident, so peak memory grows
  // monotonically with the suite count. That is how the integration step
  // (test/integration/ + every top-level test/*.test.js) reached "Ineffective
  // mark-compacts near heap limit" and killed CI with exit 134 on 2026-07-28 —
  // no test failed, the process died. Recycling the worker once it passes this
  // threshold releases the accumulated heap between suites, which BOUNDS the
  // growth instead of just raising the ceiling until the next suite breaks it.
  workerIdleMemoryLimit: '1GB',
  // forceExit needed: Express + pino-http + process.on handlers keep Node alive
  forceExit: true,
  // Set env vars before any modules are loaded (JWT_SECRET, NODE_ENV)
  setupFiles: ['./test/setup.js'],
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/database/migrations/**',
    '!src/database/seed/**',
  ],
  coverageReporters: ['text', 'text-summary', 'lcov'],
  // Ratchet, not aspiration (P3-6): measured 2026-08-02 on the CI coverage
  // pattern test/(unit/|integration/) at 50.78/42.13/43.87/53.06 — set ~1.5
  // points under so coverage can never silently halve while CI stays green.
  // Raise as real coverage rises; never lower to make a red build pass.
  coverageThreshold: {
    global: {
      statements: 49,
      branches: 41,
      functions: 42,
      lines: 51,
    },
  },
}
