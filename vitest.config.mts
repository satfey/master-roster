import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // This repo also contains backend/ (Jest) and frontend/ (its own vitest
    // config) — scope this root-level runner to just the root src/ CLI tool
    // it actually covers, so it never picks up either of those.
    include: ['src/**/*.test.ts'],
  },
});
