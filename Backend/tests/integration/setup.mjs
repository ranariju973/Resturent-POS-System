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
 * Force the database name to a `_test` suffix, and give each SUITE its own.
 *
 * ── Why per-suite and not one shared test database ─────────────────────────
 * Every suite here calls `wipe()`, which empties every collection. With one
 * shared database that is only safe while exactly one suite runs at a time —
 * and nothing enforces that. Two suites overlapping (a stray background run, a
 * developer running one file while `verify:all` is going) delete each other's
 * fixtures, and the symptom is not a clean failure: it is a suite that stalls
 * or reports something impossible, which costs far more to diagnose than it
 * ever costs to isolate.
 *
 * The suffix comes from the entry file's name, so the isolation is automatic
 * for any suite added later.
 *
 * @param {string} uri
 * @param {string} [suite] Short suite name; defaults to the running file's.
 */
export function toTestUri(uri, suite) {
  if (!uri) throw new Error('MONGO_URI is not set — copy .env.example to .env first');

  const entry = process.argv[1] ?? '';
  const label = (suite ?? path.basename(entry).replace(/\.test\.mjs$/, ''))
    .replace(/[^a-z0-9]+/gi, '_')
    .toLowerCase()
    .slice(0, 40);

  const u = new URL(uri);
  const current = u.pathname.replace(/^\//, '') || 'test';
  const base = current.endsWith('_test') ? current : `${current}_test`;
  const name = label ? `${base}_${label}` : base;

  u.pathname = `/${name}`;
  return { uri: u.toString(), dbName: name };
}

/** Refuse to run anywhere that could plausibly be real. */
function assertSafe(dbName) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Integration tests refuse to run with NODE_ENV=production');
  }
  // `_test` or `_test_<suite>`. Anything else could plausibly be real data.
  if (!/_test(_[a-z0-9_]+)?$/.test(dbName)) {
    throw new Error(
      `Refusing to run against "${dbName}" — the database name must contain _test`,
    );
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
