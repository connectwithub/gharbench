import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The Python golden-vector suite lives under stats-bridge/ and needs a
    // Python toolchain, so it is a separate opt-in run (`pnpm stats:test`).
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    restoreMocks: true,
  },
});
