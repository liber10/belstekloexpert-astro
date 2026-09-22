import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    restoreMocks: true,
    // Integration suites use one explicitly isolated TEST_DATABASE_URL.
    fileParallelism: false,
    clearMocks: true,
    testTimeout: 15_000,
    hookTimeout: 30_000,
  },
});
