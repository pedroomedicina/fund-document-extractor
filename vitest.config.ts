import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // Tests must not read the developer's .env; each test passes the config it needs.
    env: { NODE_ENV: 'test' },
  },
});
