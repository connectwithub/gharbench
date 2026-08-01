import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Golden vectors for the Python reference stats. Spawns python3, so it is
    // deliberately excluded from `pnpm test` and CI's default job.
    include: ['stats-bridge/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
  },
});
