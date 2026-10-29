import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://localhost:3001' } },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.js'],
    include: ['test/**/*.test.{js,jsx}'],
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: ['src/main.jsx'], // apenas monta o <App/> no DOM
      reporter: ['text'],
      thresholds: { lines: 100, branches: 100, functions: 100, statements: 100 },
    },
  },
});
