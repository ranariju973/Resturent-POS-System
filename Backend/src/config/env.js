/**
 * Environment loading + validation.
 *
 * Imported before anything else (see server.js). If a required variable is
 * missing or malformed, the process exits here with a readable report instead
 * of booting into a half-configured, insecure state.
 */
import dotenv from 'dotenv';
import { z } from 'zod';

// dotenv never overwrites a variable that is already set, so precedence is:
// real process env > .env > .env.development.local. The second file is where
// managed dev environments (e.g. v0 / Vercel sandboxes) mirror the project's
// environment variables — without it the server can only boot when someone
// hand-copies .env.example, even though every value is already on disk.
dotenv.config();
dotenv.config({ path: '.env.development.local' });

const isProd = process.env.NODE_ENV === 'production';

const bytes = z.coerce.number().int().positive();

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    // 5001 matches .env.example and the frontend dev proxy's default target
    // (vite.config.ts). 5000 collides with macOS AirPlay Receiver anyway.
    PORT: z.coerce.number().int().min(1).max(65535).default(5001),

    MONGO_URI: z
      .string()
      .min(1, 'MONGO_URI is required')
      .refine(
        (v) => v.startsWith('mongodb://') || v.startsWith('mongodb+srv://'),
        'MONGO_URI must start with mongodb:// or mongodb+srv://',
      ),

    // 32 chars is the floor for a secret that is not trivially brute-forced.
    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
    JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
    JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

    // Peppers the deterministic PIN lookup hash (see src/models/User.js).
    // Rotating this invalidates every stored pinLookup — staff PINs must be
    // re-set afterwards, so treat it as permanent once staff exist.
    PIN_PEPPER: z.string().min(32, 'PIN_PEPPER must be at least 32 characters'),

    // Peppers the invoice-link token hash (see src/models/Order.js). Rotating
    // this invalidates every invoice link already sent to a customer, so treat
    // it as permanent once a single bill has been shared.
    INVOICE_TOKEN_PEPPER: z
      .string()
      .min(32, 'INVOICE_TOKEN_PEPPER must be at least 32 characters'),

    /**
     * Peppers the terminal device-binding token hash (see src/models/Device.js).
     *
     * A terminal proves WHICH RESTAURANT it belongs to with this token, which
     * is what keeps one restaurant's staff PINs from ever being matched
     * against another's. Rotating it un-links every terminal — each needs an
     * owner to link it again — so treat it as permanent once terminals exist.
     */
    DEVICE_TOKEN_PEPPER: z
      .string()
      .min(32, 'DEVICE_TOKEN_PEPPER must be at least 32 characters'),

    /**
     * Google OAuth 2.0 Web client ID — the audience every admin ID token is
     * verified against.
     *
     * Public by design: it is embedded in the frontend page. The client SECRET
     * is deliberately absent — ID tokens are verified against Google's
     * published keys, so this flow never needs it, and not storing a secret is
     * one fewer thing that can leak.
     */
    GOOGLE_CLIENT_ID: z
      .string()
      .min(1, 'GOOGLE_CLIENT_ID is required')
      .refine(
        (v) => v.endsWith('.apps.googleusercontent.com'),
        'GOOGLE_CLIENT_ID must end with .apps.googleusercontent.com — that is the '
          + 'Web client ID from the Google console, not the client secret or project id',
      ),

    CORS_ORIGIN: z.string().min(1, 'CORS_ORIGIN is required'),

    /**
     * Where the FRONTEND lives — the origin a customer's browser will open.
     *
     * Not the backend's own address: in a split deployment the two differ, and
     * this is the one printed into a WhatsApp message. Optional here because
     * development derives it from CORS_ORIGIN; production refuses to boot
     * without it (see below).
     */
    PUBLIC_APP_URL: z
      .string()
      .url('PUBLIC_APP_URL must be a full URL, e.g. https://pos.example.com')
      .optional(),

    CLOUDINARY_CLOUD_NAME: z.string().min(1, 'CLOUDINARY_CLOUD_NAME is required'),
    CLOUDINARY_API_KEY: z.string().min(1, 'CLOUDINARY_API_KEY is required'),
    CLOUDINARY_API_SECRET: z.string().min(1, 'CLOUDINARY_API_SECRET is required'),

    JSON_BODY_LIMIT: z.string().default('100kb'),
    /*
     * 4MB, not 5.
     *
     * The frontend is served by Vercel, whose rewrite proxies /api to the
     * backend — and that proxy caps a request body at ~4.5MB. A 5MB ceiling
     * here meant images in the 4.5-5MB gap were killed at the proxy, which
     * answers with its own HTML rather than this API's JSON envelope. The
     * client could not parse it, so a perfectly ordinary "too big" turned
     * into an unreadable failure with no actionable message.
     *
     * Capping below the proxy's limit means multer rejects the file first,
     * with the clear 413 it already knows how to produce.
     */
    UPLOAD_MAX_BYTES: bytes.default(4 * 1024 * 1024),

    LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  })
  /*
   * Every secret must be a DIFFERENT value from every other.
   *
   * Two reasons, and they are separate. Reusing one key across the access and
   * refresh signatures would let a refresh token be replayed as an access
   * token. Reusing one across a signature and a hash pepper means a single
   * leak compromises two unrelated things at once.
   *
   * Written as an all-pairs sweep rather than a chain of hand-written
   * comparisons: pairwise refinements grow quadratically, and the fourth
   * secret is exactly where someone adds three of the four checks and the
   * missing one goes unnoticed. Adding a secret here is now a one-line edit
   * that cannot be half-done.
   */
  .superRefine((e, ctx) => {
    const secrets = [
      'JWT_ACCESS_SECRET',
      'JWT_REFRESH_SECRET',
      'PIN_PEPPER',
      'INVOICE_TOKEN_PEPPER',
      'DEVICE_TOKEN_PEPPER',
    ];

    for (let i = 0; i < secrets.length; i += 1) {
      for (let j = i + 1; j < secrets.length; j += 1) {
        if (e[secrets[i]] && e[secrets[i]] === e[secrets[j]]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `${secrets[j]} must be a different value from ${secrets[i]} — `
              + 'one leaked secret must not compromise a second, unrelated use',
            path: [secrets[j]],
          });
        }
      }
    }
  });

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  • ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n');

  // Written straight to stderr — the logger itself depends on this config, so
  // it does not exist yet at this point in the boot sequence.
  process.stderr.write(
    `\nEnvironment validation failed. The server will not start.\n\n${issues}\n\n` +
      `Copy .env.example to .env and fill in the missing values.\n\n`,
  );
  process.exit(1);
}

const raw = parsed.data;

/** Exact-match origin allow-list. No wildcards, no regex, no Origin reflection. */
const corsOrigins = raw.CORS_ORIGIN.split(',')
  .map((o) => o.trim())
  .filter(Boolean);

if (isProd && corsOrigins.some((o) => o.includes('localhost') || o === '*')) {
  process.stderr.write(
    `\nRefusing to start: CORS_ORIGIN contains "*" or a localhost origin while NODE_ENV=production.\n` +
      `Set CORS_ORIGIN to the real frontend domain(s).\n\n`,
  );
  process.exit(1);
}

/*
 * A development build serving an HTTPS front end cannot hold a session.
 *
 * The refresh and device cookies take `secure` and `sameSite` from
 * `isProd` (see utils/jwt.js). Under NODE_ENV=development that is
 * `secure: false, sameSite: 'strict'` — correct for http://localhost, and
 * silently fatal for an https origin: the browser withholds the cookie, every
 * POST /api/auth/refresh sees nothing, and the user is signed out on each page
 * reload with no error anywhere to explain it.
 *
 * That symptom costs hours to trace, so it is a boot failure instead. The
 * mirror of the production check above, and deliberately narrow: it fires only
 * when EVERY origin is https, so a mixed local/staging list still starts.
 */
if (!isProd && corsOrigins.length > 0 && corsOrigins.every((o) => o.startsWith('https://'))) {
  process.stderr.write(
    `\nRefusing to start: NODE_ENV is "${raw.NODE_ENV}" but every CORS_ORIGIN is https.\n\n` +
      `  ${corsOrigins.join('\n  ')}\n\n` +
      `Session cookies would be issued without "Secure" and with SameSite=Strict,\n` +
      `which browsers withhold from an https site — so signing in would appear to\n` +
      `work and every page refresh would silently log the user out.\n\n` +
      `Either set NODE_ENV=production (deployed), or point CORS_ORIGIN at your\n` +
      `local dev origin, e.g. CORS_ORIGIN=http://localhost:8080\n\n`,
  );
  process.exit(1);
}

/**
 * The public origin, without a trailing slash so URL building is a plain join.
 *
 * Falls back to the first CORS origin, which in development is already the
 * Vite dev server — so a developer needs no new configuration. The fallback is
 * deliberately NOT allowed in production: guessing the origin would silently
 * send customers to the wrong domain, and nobody would notice until one of
 * them complained that their receipt link was broken.
 */
const publicAppUrl = (raw.PUBLIC_APP_URL ?? corsOrigins[0] ?? '').replace(/\/+$/, '');

if (isProd && !raw.PUBLIC_APP_URL) {
  process.stderr.write(
    `\nRefusing to start: PUBLIC_APP_URL must be set explicitly while NODE_ENV=production.\n` +
      `Invoice links are printed into messages sent to customers; deriving the origin\n` +
      `from CORS_ORIGIN would quietly point them at the wrong host.\n\n`,
  );
  process.exit(1);
}

export const env = Object.freeze({
  ...raw,
  corsOrigins,
  publicAppUrl,
  isProd,
  isDev: raw.NODE_ENV === 'development',
  isTest: raw.NODE_ENV === 'test',
});

export default env;
