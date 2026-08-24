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
    build: {
      rolldownOptions: {
        output: {
          /*
           * Motion in its own chunk.
           *
           * It is ~40KB gzipped and none of it is needed to paint the first
           * screen — a till that loads the login form fast matters more than
           * one whose transitions are ready a beat earlier. Splitting it lets
           * the browser fetch it in parallel and cache it separately, so a
           * deploy that only changes app code does not re-download it.
           */
          // Rolldown (Vite 8) wants a function here, not the object form
          // Rollup accepted.
          manualChunks: (id: string) => {
            if (id.includes('node_modules/motion') || id.includes('node_modules/framer-motion')) {
              return 'motion';
            }
            if (id.includes('node_modules/react')) return 'react';
            return undefined;
          },
        },
      },
    },
    server: {
      /*
       * Pinned, and strict about it.
       *
       * Google will only issue a credential to an origin registered against
       * the OAuth client — this project registers http://localhost:8080. Vite
       * defaults to 5173 and silently walks to 5174, 5175… when a port is
       * busy, which produces an origin Google refuses and an error that looks
       * like a broken network rather than a wrong port.
       *
       * `strictPort` makes a busy 8080 a loud failure at startup instead of a
       * quiet move to a port that cannot sign anyone in. The root `npm run
       * dev` already passed these flags; having them here means running vite
       * directly from this directory behaves the same way.
       */
      port: 8080,
      strictPort: true,
      proxy: {
        '/api': {
          target,
          changeOrigin: false, // keep the Host header so cookie scoping is unchanged
          secure: false,
          // The proxy exists to make /api same-origin, but browsers still
          // attach an Origin header on POSTs (and on any cross-origin preview
          // host). Forwarding it makes the backend's strict CORS allow-list
          // reject requests that are, by this proxy's design, same-origin.
          // Stripping it here means the backend sees them the same way it
          // sees a same-origin request in production behind one domain.
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              proxyReq.removeHeader('origin');
            });
          },
        },
      },
    },
  };
});
