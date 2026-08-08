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
    UPLOAD_MAX_BYTES: bytes.default(5 * 1024 * 1024),

    LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  })
  // The two token secrets signing with the same key would let a refresh token
  // be replayed as an access token.
  .refine((e) => e.JWT_ACCESS_SECRET !== e.JWT_REFRESH_SECRET, {
    message: 'JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different values',
    path: ['JWT_REFRESH_SECRET'],
  })
  .refine((e) => e.PIN_PEPPER !== e.JWT_ACCESS_SECRET && e.PIN_PEPPER !== e.JWT_REFRESH_SECRET, {
    message: 'PIN_PEPPER must be different from the JWT secrets',
    path: ['PIN_PEPPER'],
  })
  // Same reasoning as the PIN pepper: one leaked secret must not compromise a
  // second, unrelated hash.
  .refine(
    (e) =>
      e.INVOICE_TOKEN_PEPPER !== e.PIN_PEPPER &&
      e.INVOICE_TOKEN_PEPPER !== e.JWT_ACCESS_SECRET &&
      e.INVOICE_TOKEN_PEPPER !== e.JWT_REFRESH_SECRET,
    {
      message: 'INVOICE_TOKEN_PEPPER must be different from PIN_PEPPER and the JWT secrets',
      path: ['INVOICE_TOKEN_PEPPER'],
    },
  );

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
