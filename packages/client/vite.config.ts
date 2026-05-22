import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    host: true,
    proxy: {
      // Colyseus matchmaking + WebSocket — same origin in dev for nicer URLs.
      '/matchmake': {
        target: 'http://localhost:2567',
        changeOrigin: true,
      },
      '/colyseus': {
        target: 'ws://localhost:2567',
        ws: true,
        changeOrigin: true,
      },
      '/monitor': {
        target: 'http://localhost:2567',
        changeOrigin: true,
      },
    },
  },
  build: {
    target: 'esnext',
    outDir: 'dist',
    sourcemap: true,
  },
  define: {
    __APP_VERSION__: JSON.stringify('0.1.0'),
  },
});
