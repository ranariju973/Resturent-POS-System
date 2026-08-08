/**
 * Installs the test loader hooks. Used only via `node --import`.
 *
 * ── Why env defaults live here ─────────────────────────────────────────────
 * Every test file opens with a `process.env.X = ...` stanza, but those run
 * AFTER its static imports: ESM hoists `import` above all statements, so a
 * file importing a validator loads `config/env.js` — and validates the
 * environment — before a single assignment has executed. The stanzas only
 * appeared to work because every variable they set already had a default or
 * was read lazily.
 *
 * `--import` runs this module before the test's graph is even resolved, which
 * is the only point early enough to be certain. `??=` so a test that wants a
 * different value still wins.
 */
process.env.NODE_ENV ??= 'development';
process.env.MONGO_URI ??= 'mongodb://127.0.0.1:27017/verdant_pos_test';
process.env.JWT_ACCESS_SECRET ??= 'a'.repeat(64);
process.env.JWT_REFRESH_SECRET ??= 'b'.repeat(64);
process.env.PIN_PEPPER ??= 'c'.repeat(64);
process.env.INVOICE_TOKEN_PEPPER ??= 'v'.repeat(64);
process.env.CORS_ORIGIN ??= 'http://localhost:5173';
process.env.CLOUDINARY_CLOUD_NAME ??= 'test';
process.env.CLOUDINARY_API_KEY ??= 'test';
process.env.CLOUDINARY_API_SECRET ??= 'test';
process.env.LOG_LEVEL ??= 'error';

import { register } from 'node:module';

register('./loader.mjs', import.meta.url);
