import { defineConfig, type Plugin } from 'vite';
import httpProxy from 'http-proxy-3';

const GAME_SERVER = process.env.GAME_SERVER_URL || 'http://localhost:2567';

/**
 * Routes Colyseus's WebSocket upgrades to the game server while leaving
 * Vite's own HMR socket intact.
 *
 * Vite HMR uses path "/" (or "/?token=...") on the dev server.  Colyseus
 * upgrades land on "/<roomId>?sessionId=..." where roomId is a short
 * alphanumeric token.  Anything else (asset modules etc.) doesn't even
 * trigger a WS upgrade.  So: if the upgrade path is not the root, we
 * forward it to the game server.
 */
function colyseusWsProxy(): Plugin {
  const proxy = httpProxy.createProxyServer({
    target: GAME_SERVER,
    ws: true,
    changeOrigin: true,
  });
  proxy.on('error', (err) => {
    // eslint-disable-next-line no-console
    console.error('[colyseus-ws-proxy]', err.message);
  });
  return {
    name: 'colyseus-ws-proxy',
    configureServer(server) {
      server.httpServer?.on('upgrade', (req, socket, head) => {
        const url = req.url ?? '/';
        // Vite HMR sits at "/" (with optional vite-specific query).
        // Anything else with a non-trivial path is a Colyseus room upgrade.
        if (url === '/' || url.startsWith('/?') || url.startsWith('/@')) return;
        proxy.ws(req, socket, head);
      });
    },
    configurePreviewServer(server) {
      server.httpServer?.on('upgrade', (req, socket, head) => {
        const url = req.url ?? '/';
        if (url === '/' || url.startsWith('/?') || url.startsWith('/@')) return;
        proxy.ws(req, socket, head);
      });
    },
  };
}

export default defineConfig({
  plugins: [colyseusWsProxy()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      // HTTP matchmaking + monitor.  The WS upgrade is handled by the
      // colyseusWsProxy plugin above (Vite's built-in proxy regex is
      // unreliable for matching the dynamic /<roomId> path).
      '/matchmake': { target: GAME_SERVER, changeOrigin: true },
      '/monitor':   { target: GAME_SERVER, changeOrigin: true },
    },
  },
  preview: {
    port: 4173,
    host: true,
    proxy: {
      '/matchmake': { target: GAME_SERVER, changeOrigin: true },
      '/monitor':   { target: GAME_SERVER, changeOrigin: true },
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
