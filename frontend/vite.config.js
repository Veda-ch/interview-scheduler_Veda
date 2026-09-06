import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// The `shared/` folder lives outside this workspace, so Vite must be told it is
// allowed to serve from there.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(process.cwd(), 'src'),
      '@shared': path.resolve(process.cwd(), '../shared'),
    },
  },
  server: {
    port: 5173,
    fs: { allow: [path.resolve(process.cwd(), '..')] },
    proxy: {
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
      '/uploads': { target: 'http://localhost:4000', changeOrigin: true },
    },
  },
  test: { environment: 'jsdom', globals: true, setupFiles: './src/test/setup.js' },
});
