import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // Integration tests share one test database and rebuild it (test/helpers/testDb.ts),
    // so test files run one at a time.
    fileParallelism: false,
    // Tests must not read the developer's .env; each test passes the config it needs.
    env: { NODE_ENV: 'test' },
  },
});
