/**
 * Build every declared index against the connected database.
 *
 * ── Why this has to be run by hand ─────────────────────────────────────────
 * `autoIndex` is off in production (src/config/db.js). Mongoose would
 * otherwise try to build indexes on every boot, which on a shared-tier
 * cluster means a slow, CPU-heavy operation running each time the process
 * restarts — and on a platform that sleeps idle instances, that is often.
 *
 * The cost of leaving it off is that a fresh deployment has NO indexes until
 * someone runs this. Every query then falls back to a collection scan: the
 * database reads every document to answer questions an index would have
 * answered in one seek. On a free-tier cluster with shared CPU that is the
 * difference between a responsive till and a slow one, and it degrades as the
 * order history grows.
 *
 * Run once after the first deploy, and again after changing any schema index:
 *
 *   MONGO_URI="<production uri>" npm run sync-indexes
 *
 * `syncIndexes()` also DROPS indexes that are no longer declared, which is
 * what makes it safe to re-run: the database ends up matching the schemas
 * rather than accumulating whatever every past version happened to create.
 */
import mongoose from 'mongoose';

import { env } from '../config/env.js';
import '../models/index.js';

async function main() {
  await mongoose.connect(env.MONGO_URI);

  const names = mongoose.modelNames().sort();
  console.log(`Syncing indexes for ${names.length} models…\n`);

  let created = 0;
  let dropped = 0;

  for (const name of names) {
    const model = mongoose.model(name);
    // Returns the names of indexes it removed; the ones it creates are not
    // reported, so they are counted from the resulting index list instead.
    const removed = await model.syncIndexes();
    const current = await model.collection.indexes();

    // Every collection has _id_ for free; it is not something we declared.
    const declared = current.filter((i) => i.name !== '_id_').length;

    created += declared;
    dropped += removed.length;

    const note = removed.length ? `  (dropped ${removed.length} stale)` : '';
    console.log(`  ${name.padEnd(18)} ${String(declared).padStart(2)} indexes${note}`);
  }

  console.log(`\nDone. ${created} indexes in place, ${dropped} stale removed.`);
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('\nIndex sync failed:', err.message);
  // Leaving the process connected would hang the exit.
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});
