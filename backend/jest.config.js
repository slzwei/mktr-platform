export default {
  testEnvironment: 'node',
  transform: {},
  verbose: false,
  testTimeout: 20000,
  // maxWorkers=1 avoids DB contention between test suites
  maxWorkers: 1,
  // forceExit needed: Express + morgan + process.on handlers keep Node alive
  forceExit: true,
  // Set env vars before any modules are loaded (JWT_SECRET, NODE_ENV)
  setupFiles: ['./test/setup.js']
}
