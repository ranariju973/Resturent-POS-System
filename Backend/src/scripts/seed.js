/**
 * Database seed.
 *
 *   npm run seed              admin account only
 *   npm run seed -- --demo    admin + demo menu, tables, staff, customers
 *   npm run seed -- --reset   wipe the collections it manages first
 *
 * Safety rules:
 *   • No credential is ever hardcoded. The admin password comes from
 *     SEED_ADMIN_PASSWORD; demo staff PINs are generated and printed once.
 *   • --reset refuses to run against NODE_ENV=production without --force.
 *   • Re-running without --reset is idempotent: existing records are left
 *     alone rather than duplicated.
 */
import mongoose from 'mongoose';
import { randomInt } from 'node:crypto';
import { env } from '../config/env.js';
import { connectDB, disconnectDB } from '../config/db.js';
import { logger } from '../utils/logger.js';
import { toMinor } from '../utils/money.js';
import { ROLES, TABLE_STATUS, EXPENSE_CATEGORY } from '../constants/enums.js';
import { User, Category, MenuItem, Table, Customer, Expense } from '../models/index.js';

const args = new Set(process.argv.slice(2));
const WITH_DEMO = args.has('--demo');
const RESET = args.has('--reset');
const FORCE = args.has('--force');

const out = (msg) => process.stdout.write(`${msg}\n`);

// --- Demo fixtures (mirrors the frontend's src/data/seed.ts) ---------------

const DEMO_CATEGORIES = [
  { name: 'Beverages', color: '#00754A', sortOrder: 1 },
  { name: 'Rice', color: '#cba258', sortOrder: 2 },
  { name: 'Salads', color: '#2b5148', sortOrder: 3 },
  { name: 'Soup', color: '#1E3932', sortOrder: 4 },
  { name: 'Pizza', color: '#8a6a24', sortOrder: 5 },
];

const DEMO_ITEMS = [
  { name: 'Cold Brew', price: 4.25, cat: 'Beverages' },
  { name: 'Vanilla Latte', price: 4.75, cat: 'Beverages' },
  { name: 'Iced Matcha', price: 5.25, cat: 'Beverages' },
  { name: 'Shrimp Basil Salad', price: 10.0, cat: 'Salads' },
  { name: 'Garden Greens', price: 8.5, cat: 'Salads' },
  { name: 'Miso Soup', price: 5.5, cat: 'Soup' },
  { name: 'Tomato Bisque', price: 6.25, cat: 'Soup' },
  { name: 'Chicken Fried Rice', price: 9.75, cat: 'Rice' },
  { name: 'Veg Biryani', price: 9.0, cat: 'Rice' },
  { name: 'Margherita Pizza', price: 11.5, cat: 'Pizza' },
  { name: 'Pepperoni Pizza', price: 12.75, cat: 'Pizza' },
];

const DEMO_TABLES = [
  { name: 'T1', seats: 2, zone: 'Indoor' },
  { name: 'T2', seats: 4, zone: 'Indoor' },
  { name: 'T3', seats: 4, zone: 'Indoor' },
  { name: 'T4', seats: 6, zone: 'Indoor' },
  { name: 'T5', seats: 2, zone: 'Indoor' },
  { name: 'T6', seats: 4, zone: 'AC' },
  { name: 'T7', seats: 8, zone: 'AC' },
  { name: 'T8', seats: 4, zone: 'AC' },
  { name: 'P1', seats: 4, zone: 'Outdoor' },
  { name: 'P2', seats: 2, zone: 'Outdoor' },
  { name: 'P3', seats: 6, zone: 'Outdoor' },
  { name: 'P4', seats: 2, zone: 'Outdoor' },
];

const DEMO_STAFF = [
  { name: 'Priya Nair', role: ROLES.CASHIER },
  { name: 'Marco Reyes', role: ROLES.KITCHEN_STAFF },
  { name: 'Nahid Zaman', role: ROLES.CASHIER },
];

const DEMO_CUSTOMERS = [
  { name: 'Aarav Mehta', phone: '+91 98200 41122', email: 'aarav.mehta@mail.com', notes: 'Prefers window seat. No coriander.' },
  { name: 'Sana Kapoor', phone: '+91 99870 30456', email: '', notes: 'Allergic to shellfish.' },
  { name: 'Devan Rao', phone: '+91 90040 88213', email: 'devan@rao.co', notes: '' },
  { name: 'Meera Iyer', phone: '+91 98455 77310', email: 'meera.iyer@mail.com', notes: 'Regular — always takeaway.' },
  { name: 'Karan Bhatt', phone: '+91 97110 26644', email: '', notes: '' },
];

const DEMO_EXPENSES = [
  { date: '2026-08-01', category: EXPENSE_CATEGORY.INGREDIENTS, description: 'Produce & dairy — weekly market run', amount: 1840.5 },
  { date: '2026-07-30', category: EXPENSE_CATEGORY.SALARY, description: 'Kitchen staff — July payroll', amount: 6200 },
  { date: '2026-07-28', category: EXPENSE_CATEGORY.UTILITIES, description: 'Electricity and water', amount: 742.35 },
  { date: '2026-07-25', category: EXPENSE_CATEGORY.RENT, description: 'Storefront lease — August', amount: 3400 },
  { date: '2026-07-22', category: EXPENSE_CATEGORY.INGREDIENTS, description: 'Coffee beans — 40kg', amount: 1290 },
];

/** Cryptographically random 4-digit PIN — never Math.random() for a credential. */
const generatePin = () => String(randomInt(0, 10000)).padStart(4, '0');

// --- Steps -----------------------------------------------------------------

async function reset() {
  if (env.isProd && !FORCE) {
    throw new Error('--reset refused: NODE_ENV=production. Re-run with --force if this is intended.');
  }
  out('Wiping seeded collections…');
  await Promise.all([
    User.deleteMany({}),
    Category.deleteMany({}),
    MenuItem.deleteMany({}),
    Table.deleteMany({}),
    Customer.deleteMany({}),
    Expense.deleteMany({}),
  ]);
}

async function seedAdmin() {
  const email = (process.env.SEED_ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD || '';
  const name = process.env.SEED_ADMIN_NAME || 'Administrator';

  if (!email || !password) {
    throw new Error('SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD must be set in .env to seed an admin');
  }
  if (password.length < 12) {
    throw new Error('SEED_ADMIN_PASSWORD must be at least 12 characters');
  }

  const existing = await User.findOne({ email });
  if (existing) {
    out(`Admin already exists: ${email} (left unchanged)`);
    return existing;
  }

  const admin = new User({ name, email, role: ROLES.ADMIN, isActive: true });
  await admin.setPassword(password);

  // Optional manager-override PIN — authorises voids and large discounts at a
  // cashier's terminal. It cannot be used to log in (see User.js).
  const overridePin = (process.env.SEED_ADMIN_OVERRIDE_PIN || '').trim();
  if (overridePin) {
    if (!/^\d{4}$/.test(overridePin)) {
      throw new Error('SEED_ADMIN_OVERRIDE_PIN must be exactly 4 digits');
    }
    await admin.setOverridePin(overridePin);
  }

  await admin.save();
  out(`Created admin: ${email}${overridePin ? ' (override PIN set)' : ''}`);
  if (!overridePin) {
    out('  No override PIN set — cashiers cannot get manager approval at the terminal.');
    out('  Set SEED_ADMIN_OVERRIDE_PIN in .env and re-seed if you want that.');
  }
  return admin;
}

async function seedCategories() {
  const map = new Map();
  for (const spec of DEMO_CATEGORIES) {
    const doc =
      (await Category.findOne({ name: spec.name, isActive: true })) ||
      (await Category.create(spec));
    map.set(spec.name, doc._id);
  }
  out(`Categories ready: ${map.size}`);
  return map;
}

async function seedMenu(categoryMap) {
  let created = 0;
  for (const spec of DEMO_ITEMS) {
    const category = categoryMap.get(spec.cat);
    const exists = await MenuItem.findOne({ name: spec.name, category, isActive: true });
    if (exists) continue;
    await MenuItem.create({
      name: spec.name,
      priceMinor: toMinor(spec.price),
      category,
      available: true,
    });
    created += 1;
  }
  out(`Menu items created: ${created} (of ${DEMO_ITEMS.length})`);
}

async function seedTables() {
  let created = 0;
  for (const spec of DEMO_TABLES) {
    const exists = await Table.findOne({ name: spec.name, isActive: true });
    if (exists) continue;
    await Table.create({ ...spec, status: TABLE_STATUS.AVAILABLE });
    created += 1;
  }
  out(`Tables created: ${created} (of ${DEMO_TABLES.length})`);
}

async function seedStaff() {
  const issued = [];
  for (const spec of DEMO_STAFF) {
    const exists = await User.findOne({ name: spec.name, role: spec.role });
    if (exists) continue;

    // Retry on the (rare) chance the generated PIN collides with one already
    // in use — pinLookup is unique across active staff.
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const pin = generatePin();
      const user = new User({ name: spec.name, role: spec.role, isActive: true });
      await user.setPin(pin);
      try {
        await user.save();
        issued.push({ name: spec.name, role: spec.role, pin });
        break;
      } catch (err) {
        if (err?.code !== 11000) throw err;
      }
    }
  }

  if (issued.length) {
    out('\n  Staff PINs — shown once, not recoverable afterwards:');
    for (const s of issued) out(`    ${s.pin}   ${s.name} (${s.role})`);
    out('');
  } else {
    out('Staff already exist (left unchanged)');
  }
}

async function seedCustomers() {
  let created = 0;
  for (const spec of DEMO_CUSTOMERS) {
    const exists = await Customer.findOne({ name: spec.name });
    if (exists) continue;
    await Customer.create(spec);
    created += 1;
  }
  out(`Customers created: ${created} (of ${DEMO_CUSTOMERS.length})`);
}

async function seedExpenses(adminId) {
  let created = 0;
  for (const spec of DEMO_EXPENSES) {
    const exists = await Expense.findOne({ description: spec.description });
    if (exists) continue;
    await Expense.create({
      date: new Date(spec.date),
      category: spec.category,
      description: spec.description,
      amountMinor: toMinor(spec.amount),
      createdBy: adminId,
    });
    created += 1;
  }
  out(`Expenses created: ${created} (of ${DEMO_EXPENSES.length})`);
}

// --- Entrypoint ------------------------------------------------------------

async function run() {
  await connectDB();
  out(`\nSeeding ${mongoose.connection.name} (NODE_ENV=${env.NODE_ENV})\n`);

  if (RESET) await reset();

  const admin = await seedAdmin();

  if (WITH_DEMO) {
    if (env.isProd && !FORCE) {
      throw new Error('--demo refused: NODE_ENV=production. Re-run with --force if this is intended.');
    }
    const categories = await seedCategories();
    await seedMenu(categories);
    await seedTables();
    await seedStaff();
    await seedCustomers();
    await seedExpenses(admin._id);
  } else {
    out('Demo data skipped — pass --demo to include it.');
  }

  out('\nSeed complete.\n');
}

run()
  .then(async () => {
    await disconnectDB();
    process.exit(0);
  })
  .catch(async (err) => {
    logger.error('Seed failed', { message: err.message, stack: err.stack });
    process.stderr.write(`\nSeed failed: ${err.message}\n\n`);
    await disconnectDB().catch(() => {});
    process.exit(1);
  });
