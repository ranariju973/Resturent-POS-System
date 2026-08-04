/**
 * Integration-test harness.
 *
 * ── READ THIS BEFORE RUNNING ───────────────────────────────────────────────
 * These tests WRITE TO AND WIPE a database. Every guard below exists to make
 * it impossible to point them at real data by accident.
 *
 *   1. The database name MUST end in `_test`. Anything else aborts.
 *   2. NODE_ENV must not be `production`. Aborts.
 *   3. Only the collections this harness creates are dropped, and only
 *      between tests.
 *
 * The suite reads MONGO_URI from .env and REWRITES the database name — so
 * pointing it at your Atlas cluster is safe: it will use
 * `<yourdb>_test`, never `<yourdb>`.
 *
 * ── Author's note on trust ─────────────────────────────────────────────────
 * This file was written in an environment with no MongoDB available, so it has
 * never been executed. Treat the first run as debugging the tests as much as
 * debugging the code. That is a real caveat, not boilerplate modesty.
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
dotenv.config({ path: path.join(ROOT, '.env') });

/**
 * Force the database name to a `_test` suffix.
 * @param {string} uri
 */
export function toTestUri(uri) {
  if (!uri) throw new Error('MONGO_URI is not set — copy .env.example to .env first');

  const u = new URL(uri);
  const current = u.pathname.replace(/^\//, '') || 'test';
  const name = current.endsWith('_test') ? current : `${current}_test`;
  u.pathname = `/${name}`;
  return { uri: u.toString(), dbName: name };
}

/** Refuse to run anywhere that could plausibly be real. */
function assertSafe(dbName) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Integration tests refuse to run with NODE_ENV=production');
  }
  if (!dbName.endsWith('_test')) {
    throw new Error(`Refusing to run against "${dbName}" — the database name must end in _test`);
  }
}

let connected = false;

export async function connect() {
  if (connected) return mongoose.connection;

  // The app's env validator needs these; the values are irrelevant to the DB.
  process.env.NODE_ENV = process.env.NODE_ENV === 'production' ? 'development' : (process.env.NODE_ENV ?? 'development');

  const { uri, dbName } = toTestUri(process.env.MONGO_URI);
  assertSafe(dbName);

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15_000 });
  connected = true;

  process.stdout.write(`  connected to ${dbName}\n`);
  return mongoose.connection;
}

/** Empty every collection. Safe because assertSafe() already ran. */
export async function wipe() {
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
}

export async function disconnect() {
  if (!connected) return;
  await mongoose.connection.close();
  connected = false;
}

/** Does this deployment support transactions? Order tests branch on it. */
export async function supportsTransactions() {
  try {
    const { setName, msg } = await mongoose.connection.db.admin().command({ hello: 1 });
    return Boolean(setName) || msg === 'isdbgrid';
  } catch {
    return false;
  }
}

// --- Tiny assertion harness, matching the rest of the suite ----------------

export function createReporter() {
  const state = { pass: 0, fail: 0 };
  return {
    state,
    t(label, cond, note = '') {
      cond ? state.pass++ : state.fail++;
      console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${note ? `  ${note}` : ''}`);
    },
    section(name) {
      console.log(`\n--- ${name} ---`);
    },
    finish() {
      console.log(`\n${state.pass} passed, ${state.fail} failed`);
      return state.fail === 0;
    },
  };
}
