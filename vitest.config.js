import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    // Test environment
    environment: 'node',

    // Global test timeout (increased for server startup)
    testTimeout: 60000,

    // Exclude Playwright tests (*.spec.js) - they run separately with Playwright
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/tests/browser/**/*.spec.js', // Playwright tests
    ],

    // Setup files
    setupFiles: ['./tests/setup.js'],

    // Coverage
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json'],
      include: ['src/**/*.js'],
      exclude: [
        'node_modules',
        'tests',
        '.next',
        'open-sse'
      ]
    },

    // Reporters
    reporters: ['verbose'],

    // Globals (optional - enables describe, it, expect without imports)
    globals: true,

    // Run tests sequentially to avoid port conflicts when starting multiple servers
    // In Vitest 4, these are top-level options (not in poolOptions)
    fileParallelism: false,
    pool: 'threads',
    poolThreads: 1, // Run in single thread
    isolate: false,
  },

  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@/lib': path.resolve(__dirname, './src/lib'),
      '@/models': path.resolve(__dirname, './src/models'),
      '@/shared': path.resolve(__dirname, './src/shared'),
    }
  }
});
