// Vitest config: node environment by default; DOM tests opt in to jsdom with a file docblock.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    testTimeout: 20000,
    hookTimeout: 60000,
  },
});
