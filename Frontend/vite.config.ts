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

  /*
   * ── A bundle that cannot sign anyone in ──────────────────────────────────
   * Vite inlines VITE_* at build time. A production bundle built without
   * VITE_GOOGLE_CLIENT_ID deploys perfectly happily and then cannot sign
   * anybody in — administrators have no other door, so the whole POS is
   * unusable, and the only symptom is a message on a screen nobody is
   * watching during a deploy.
   *
   * ── Why this is not always fatal ─────────────────────────────────────────
   * The first version of this check threw on every production build, which
   * broke CI. That was wrong, and the distinction it missed is real:
   *
   *   • A DEPLOY produces a bundle that real staff will be served. Shipping
   *     one nobody can sign into is worse than not shipping, so it throws.
   *   • CI runs the same command to prove the code COMPILES. That artifact is
   *     discarded. Demanding a Google credential there would mean putting one
   *     in CI for a bundle nobody will ever load, which buys nothing and adds
   *     a secret to leak.
   *
   * So it fails where the bundle is about to be served, and warns everywhere
   * else. `VERCEL` is set by Vercel's builder; `DEPLOY_BUILD=1` is the manual
   * lever for any other host.
   */
  if (mode === 'production' && !env.VITE_GOOGLE_CLIENT_ID) {
    const isDeploy = Boolean(
      process.env.VERCEL || process.env.VERCEL_ENV || process.env.DEPLOY_BUILD,
    );

    /*
     * What the build can actually see — evidence rather than a list of things
     * to go and check. Other names present means variables arrive fine and
     * this one is misnamed or scoped wrong; an empty list means none arrive,
     * so the problem is the project or environment, not the variable.
     */
    const visible = Object.keys({ ...env, ...process.env })
      .filter((k) => k.startsWith('VITE_'))
      .sort();

    const detail = [
      '',
      'VITE_GOOGLE_CLIENT_ID is not set, so this bundle cannot sign anyone in.',
      'Administrators authenticate with Google and have no other way in.',
      '',
      visible.length
        ? `VITE_* variables this build can see: ${visible.join(', ')}`
        : 'This build can see NO VITE_* variables at all.',
      visible.length
        ? 'Others got through, so this one is misnamed or scoped differently.'
          + ' The name is case-sensitive.'
        : 'None got through, so the problem is not this variable — check the'
          + ' deploy belongs to the project the variables were added to.',
      '',
      'On Vercel: Settings -> Environment Variables.',
      '  - PRODUCTION must be ticked. A variable scoped only to Preview is',
      '    invisible to a production build.',
      '  - It must NOT be marked Sensitive. Sensitive variables are withheld',
      '    from the build step, which is the only place Vite can read one.',
      '  - Redeploy afterwards. Changing a variable never rebuilds on its own.',
      '',
      'Locally: put it in Frontend/.env.local and restart the dev server.',
      '',
    ].join('\n');

    if (isDeploy) throw new Error(detail);

    // Not a deploy — the artifact is a compile check and will be thrown away.
    console.warn(
      `\n[vite] WARNING — this bundle is not deployable.${detail}`
        + 'Building anyway: this is not a deploy. Set DEPLOY_BUILD=1 to make it fatal.\n',
    );
  }

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
