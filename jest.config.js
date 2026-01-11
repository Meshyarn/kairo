export default {
  testEnvironment: 'node',
  testTimeout: 20000,
  transform: {},
  moduleNameMapper: {},
  setupFilesAfterEnv: ['<rootDir>/dist/tests/setup.js'],
  testMatch: ['**/dist/tests/**/*.test.js'],
  testPathIgnorePatterns: process.env.KAIRO_INCLUDE_PERF === 'true'
    ? []
    : ['/dist/tests/performance/'],
  verbose: true
};
