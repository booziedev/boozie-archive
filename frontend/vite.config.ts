import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Static SPA build. Nothing here is host-specific, so the same `dist/` folder
 * works on Cloudflare Pages, Vercel, Netlify or any plain static host.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    /**
     * Dev convenience: with an empty VITE_API_BASE_URL the app talks to
     * same-origin `/api`, which Vite proxies to the backend on :1981.
     */
    proxy: {
      '/api': {
        target: 'http://localhost:1981',
        changeOrigin: true,
      },
    },
  },
  preview: { port: 4173, host: true },
  build: {
    target: 'es2020',
    sourcemap: false,
    // Keep the vendor chunk separate so app updates don't invalidate React.
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          query: ['@tanstack/react-query'],
        },
      },
    },
  },
});
