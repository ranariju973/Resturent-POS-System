import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The dev proxy makes the API same-origin.
 *
 * Without it the browser sees http://localhost:5173 calling http://localhost:5001
 * — a cross-origin request, which drags in CORS preflights and puts the
 * refresh cookie at the mercy of third-party-cookie rules. Proxying /api
 * through Vite means the browser only ever talks to one origin, so the
 * httpOnly `sameSite: strict` cookie behaves in development exactly as it will
 * in production behind a single domain.
 *
 * Set VITE_API_URL only if you deliberately want to bypass this and call a
 * remote backend directly — in which case that backend's CORS_ORIGIN must
 * list this origin.
 *
 * The default target is port 5001, not 5000: on macOS port 5000 is taken by the
 * AirPlay Receiver service, which answers with a 403 and looks like a dead API.
 */
export default defineConfig(({ mode }) => {
  // loadEnv reads .env / .env.local from disk. process.env alone does NOT
  // contain them — Vite only injects VITE_* into the client bundle, never into
  // the config's process.env — so reading process.env here would silently fall
  // through to the default and ignore .env.local entirely.
  const env = loadEnv(mode, process.cwd(), '');
  const target = env.VITE_PROXY_TARGET ?? 'http://localhost:5001';

  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api': {
          target,
          changeOrigin: false, // keep the Host header so cookie scoping is unchanged
          secure: false,
        },
      },
    },
  };
});
