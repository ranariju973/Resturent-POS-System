/**
 * Adopt pre-multi-tenancy records into a restaurant.
 *
 * ── What this is for ──────────────────────────────────────────────────────
 * Every document written before tenant scoping has no `tenantId`, and every
 * query now filters on one — so the data is not corrupt, it is invisible. A
 * menu somebody spent an afternoon building, the tables, the customers and the
 * order history are all still there and none of it renders.
 *
 * This stamps those orphans with one restaurant's id, which makes them visible
 * again exactly as they were.
 *
 * ── Order of operations ───────────────────────────────────────────────────
 * The restaurant has to exist first, so sign in with Google and name it before
 * running this. Then:
 *
 *   node src/scripts/adoptLegacyData.js              # dry run — reports only
 *   node src/scripts/adoptLegacyData.js --apply      # actually writes
 *
 * Dry run is the default deliberately: this is a production data migration,
 * and the cost of looking first is a few seconds.
 *
 * Safe to re-run. It only ever touches documents with NO tenantId, so a second
 * run finds nothing to do rather than moving anything a second time.
 *
 * ── What it deliberately does NOT do ──────────────────────────────────────
 * It writes through the raw driver rather than the models. A migration must
 * not run decade-old documents through today's validators — a schema that has
 * since gained a required field would reject rows this is trying to rescue,
 * and the failure would look like a broken migration rather than expected
 * drift.
 */
import mongoose from 'mongoose';
import { env } from '../config/env.js';

/**
 * Collections that carry a tenantId, and are therefore invisible without one.
 *
 * `counters` is absent because its tenant lives inside the document key, and
 * `refreshtokens` because a session is looked up before any tenant is known.
 * `tenants` is the restaurant itself.
 */
const SCOPED_COLLECTIONS = [
  'attendances',
  'auditlogs',
  'categories',
  'customers',
  'devices',
  'expenses',
  'menuitems',
  'orders',
  'payrolls',
  'printersettings',
  'tables',
  'tickets',
  'users',
];

const apply = process.argv.includes('--apply');
const slugArg = process.argv.find((a) => a.startsWith('--tenant='))?.split('=')[1];

async function main() {
  await mongoose.connect(env.MONGO_URI, { serverSelectionTimeoutMS: 15_000 });
  const db = mongoose.connection.db;
  console.log(`\nDatabase: ${mongoose.connection.name}`);
  console.log(apply ? 'Mode:     APPLY — this will write\n' : 'Mode:     dry run — nothing will be written\n');

  const tenants = await db.collection('tenants').find({}).toArray();

  if (tenants.length === 0) {
    console.error(
      'No restaurant exists yet, so there is nothing to adopt the data INTO.\n'
        + 'Sign in with Google and name your restaurant first, then run this again.',
    );
    process.exitCode = 1;
    return;
  }

  let tenant;
  if (slugArg) {
    tenant = tenants.find((t) => t.slug === slugArg);
    if (!tenant) {
      console.error(`No restaurant with slug "${slugArg}". Found: ${tenants.map((t) => t.slug).join(', ')}`);
      process.exitCode = 1;
      return;
    }
  } else if (tenants.length === 1) {
    [tenant] = tenants;
  } else {
    // Refuses to guess: picking the wrong one hands one restaurant's history
    // to another, and nothing downstream would flag it.
    console.error(
      `${tenants.length} restaurants exist, so which one should own this data is ambiguous.\n`
        + `Re-run with --tenant=<slug>. Available: ${tenants.map((t) => t.slug).join(', ')}`,
    );
    process.exitCode = 1;
    return;
  }

  console.log(`Adopting into: ${tenant.name}  (${tenant.slug})\n`);

  let total = 0;
  for (const name of SCOPED_COLLECTIONS) {
    const collection = db.collection(name);
    // Absent only. A document that already has a tenantId — including null on
    // an account still part-way through onboarding — is left exactly alone.
    const filter = { tenantId: { $exists: false } };
    const count = await collection.countDocuments(filter);

    if (count === 0) {
      console.log(`  ${name.padEnd(16)} —`);
      continue;
    }

    if (apply) {
      const res = await collection.updateMany(filter, { $set: { tenantId: tenant._id } });
      console.log(`  ${name.padEnd(16)} ${String(res.modifiedCount).padStart(4)} adopted`);
    } else {
      console.log(`  ${name.padEnd(16)} ${String(count).padStart(4)} would be adopted`);
    }
    total += count;
  }

  console.log(`\n${total} document(s) ${apply ? 'adopted' : 'would be adopted'}.`);

  /*
   * Accounts that cannot authenticate any more.
   *
   * Administrators sign in with Google now, so a legacy admin holding only a
   * password has no way in. Reported rather than deleted: it is the customer's
   * record of who had access, and quietly removing rows during a data
   * migration is how history goes missing.
   */
  const strandedAdmins = await db.collection('users').countDocuments({
    role: 'admin',
    googleId: { $exists: false },
  });
  if (strandedAdmins > 0) {
    console.log(
      `\nNote: ${strandedAdmins} legacy admin account(s) have a password but no Google identity,\n`
        + '      so they can no longer sign in. They are left in place — deactivate them\n'
        + '      from the Employees screen if you do not want them on the roster.',
    );
  }

  const staff = await db.collection('users').countDocuments({
    role: { $in: ['cashier', 'kitchen_staff'] },
    isActive: true,
  });
  if (staff > 0) {
    console.log(
      `\nNote: ${staff} staff account(s) keep their existing PINs, which still work\n`
        + '      once a terminal is linked. Set fresh PINs from Employees if nobody\n'
        + '      remembers them.',
    );
  }

  if (!apply && total > 0) {
    console.log('\nRe-run with --apply to write these changes.');
  }
  if (apply) {
    console.log('\nNow rebuild the indexes:  npm run sync-indexes');
  }
}

try {
  await main();
} catch (err) {
  console.error(`\nMigration failed: ${err.message}`);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect().catch(() => {});
}
