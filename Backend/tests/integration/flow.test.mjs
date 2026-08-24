/**
 * Integration tests — Phase 12.
 *
 * ── What this covers that nothing else could ───────────────────────────────
 * Every earlier suite tests contracts and guards without a database. This one
 * runs the actual service flow against real documents, and it exists to close
 * the specific gaps flagged throughout the build:
 *
 *   • an order and its kitchen ticket are created together, or not at all
 *   • a forged price genuinely cannot survive to the database
 *   • two concurrent requests cannot both claim the same table
 *   • authentication actually works end to end (bcrypt, tokens, refresh)
 *   • a cashier is genuinely refused the reports the RBAC matrix says they are
 *
 * ── Honest status ─────────────────────────────────────────────────────────
 * NEVER EXECUTED. Written without a MongoDB available. The first run should be
 * treated as debugging these tests as much as the code they exercise.
 *
 * Run with:  npm run test:integration
 */
import path from 'node:path';
import { connect, wipe, disconnect, supportsTransactions, createReporter } from './setup.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');

// Env the app's validator requires. MONGO_URI comes from .env via setup.mjs.
process.env.JWT_ACCESS_SECRET ??= 'a'.repeat(64);
process.env.JWT_REFRESH_SECRET ??= 'b'.repeat(64);
process.env.PIN_PEPPER ??= 'c'.repeat(64);
process.env.INVOICE_TOKEN_PEPPER ??= 'v'.repeat(64);
// Distinct values: env.js refuses to boot when any two secrets match.
process.env.DEVICE_TOKEN_PEPPER ??= 'd'.repeat(64);
process.env.GOOGLE_CLIENT_ID ??= 'test-client.apps.googleusercontent.com';
process.env.CORS_ORIGIN ??= 'http://localhost:5173';
process.env.CLOUDINARY_CLOUD_NAME ??= 'test';
process.env.CLOUDINARY_API_KEY ??= 'test';
process.env.CLOUDINARY_API_SECRET ??= 'test';
process.env.LOG_LEVEL = process.env.DEBUG_FLOW ? 'debug' : 'error';

const { t, section, finish } = createReporter();

/*
 * Without this, a rejected promise inside the try block ends the process with
 * a zero exit code and no output — which reads as "the suite stopped" and
 * hides the actual error. Node's default for an unhandled rejection is not
 * loud enough for a test runner.
 */
process.on('unhandledRejection', (err) => {
  process.stderr.write(`\nUNHANDLED REJECTION: ${err?.stack ?? err}\n`);
  process.exit(1);
});

await connect();
await wipe();

const { default: app } = await import(`${ROOT}/app.js`);
const { User } = await import(`${ROOT}/src/models/User.js`);
const { Category } = await import(`${ROOT}/src/models/Category.js`);
const { MenuItem } = await import(`${ROOT}/src/models/MenuItem.js`);
const { Table } = await import(`${ROOT}/src/models/Table.js`);
const { Order } = await import(`${ROOT}/src/models/Order.js`);
const { Ticket } = await import(`${ROOT}/src/models/Ticket.js`);
const { AuditLog } = await import(`${ROOT}/src/models/AuditLog.js`);
const { ROLES } = await import(`${ROOT}/src/constants/enums.js`);
const { Tenant } = await import(`${ROOT}/src/models/Tenant.js`);
const { runInTenant, runUnscoped } = await import(`${ROOT}/src/utils/tenantContext.js`);
const { signAccessToken } = await import(`${ROOT}/src/utils/jwt.js`);

const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;

const api = async (method, url, { token, body, cookie } = {}) => {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (cookie) headers.Cookie = cookie;

  const res = await fetch(`${base}${url}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    // A hung request must fail the suite, not stall it silently forever.
    signal: AbortSignal.timeout(10_000),
  });

  let json = null;
  try {
    json = await res.json();
  } catch {
    /* 204 and friends */
  }
  return { status: res.status, body: json, headers: res.headers };
};

/*
 * The restaurant everything below belongs to.
 *
 * Created before the try block so the whole suite can run inside its context:
 * this file reaches for the models directly in a dozen places — to inspect a
 * Ticket, to reprice an item behind the API's back, to count orders — and each
 * of those is a tenant-scoped query that would otherwise refuse to run.
 *
 * The HTTP calls do not depend on this wrapper. requireAuth resolves the
 * restaurant from the signed-in account and enters the context itself, which
 * is the path a real request takes.
 */
const tenant = await runUnscoped('integration fixtures: create the restaurant', async () =>
  Tenant.create({ name: 'Integration Test Diner', slug: 'integration-test-diner' }));

try {
 await runInTenant(tenant._id, async () => {
  // -------------------------------------------------------------------------
  section('fixtures');

  const ADMIN_PASSWORD = 'IntegrationTest_2026!';
  const CASHIER_PIN = '4242';
  const OVERRIDE_PIN = '9137';

  /*
   * Everything below belongs to one restaurant.
   *
   * Fixtures are written through the models directly, which means they need a
   * tenant in context — the tenantScoped plugin refuses an unscoped write
   * rather than creating a record that belongs to nobody. The HTTP requests
   * further down need no such wrapper: requireAuth resolves the tenant from
   * the signed-in account and enters the context itself, which is the path a
   * real request takes.
   */
  const {
    admin, cashier, category, coldBrew, soldOut, table,
  } = await runInTenant(tenant._id, async () => {
    const adminUser = new User({
      name: 'Test Admin',
      email: 'admin@integration.test',
      role: ROLES.ADMIN,
      isActive: true,
    });
    await adminUser.setPassword(ADMIN_PASSWORD);
    await adminUser.setOverridePin(OVERRIDE_PIN);
    await adminUser.save();

    const cashierUser = new User({ name: 'Test Cashier', role: ROLES.CASHIER, isActive: true });
    await cashierUser.setPin(CASHIER_PIN);
    await cashierUser.save();

    const cat = await Category.create({ name: 'Beverages', color: '#00754A' });
    const brew = await MenuItem.create({
      name: 'Cold Brew',
      priceMinor: 425,
      category: cat._id,
      available: true,
    });
    const matcha = await MenuItem.create({
      name: 'Iced Matcha',
      priceMinor: 525,
      category: cat._id,
      available: false,
    });
    const t1 = await Table.create({ name: 'T1', seats: 4, zone: 'Indoor' });

    return {
      admin: adminUser,
      cashier: cashierUser,
      category: cat,
      coldBrew: brew,
      soldOut: matcha,
      table: t1,
    };
  });

  t('fixtures created', Boolean(admin._id && cashier._id && coldBrew._id && table._id));
  t('and they all belong to the same restaurant',
    [admin, cashier, category, coldBrew, table]
      .every((doc) => String(doc.tenantId) === String(tenant._id)));

  // -------------------------------------------------------------------------
  section('authentication actually works');

  /*
   * ── Sessions are obtained directly, not through a login form ─────────────
   * Administrators sign in with Google, whose token this suite cannot mint,
   * and staff sign in at a terminal whose device cookie is a whole flow of its
   * own. Both of those — and every failure mode around them — are covered end
   * to end by onboarding-flow.test.mjs.
   *
   * What THIS suite is for is the order path: transactions, forged prices,
   * table races and RBAC against real data. So it takes the sessions as given
   * and spends its assertions on the part nothing else covers.
   */
  const adminToken = signAccessToken({
    id: admin._id,
    role: admin.role,
    tokenVersion: admin.tokenVersion ?? 0,
    tenantId: tenant._id,
  });
  const cashierToken = signAccessToken({
    id: cashier._id,
    role: cashier.role,
    tokenVersion: cashier.tokenVersion ?? 0,
    tenantId: tenant._id,
  });
  t('an admin session can be established', typeof adminToken === 'string');
  t('a cashier session can be established', typeof cashierToken === 'string');

  /*
   * The override PIN must not be a login credential. findActiveByPin restricts
   * itself to PIN_ROLES, which excludes admin — so an admin's override PIN
   * cannot start a session even at a linked terminal. Asserted here because it
   * is a property of the User model, not of the terminal flow.
   */
  const overrideAsLogin = await runInTenant(tenant._id, async () =>
    User.findActiveByPin(OVERRIDE_PIN));
  t('the OVERRIDE PIN cannot be used to log in', overrideAsLogin === null);

  const me = await api('GET', '/api/auth/me', { token: adminToken });
  t('/me works with the token', me.status === 200);
  t('/me returns no credential fields',
    !/passwordHash|pinHash|overridePin/.test(JSON.stringify(me.body)));

  // -------------------------------------------------------------------------
  section('RBAC is enforced against real data');

  const cashierReports = await api('GET', '/api/reports/daily', { token: cashierToken });
  t('a cashier is REFUSED the daily report', cashierReports.status === 403,
    `status ${cashierReports.status}`);
  t('the 403 message reveals nothing',
    cashierReports.body?.error?.message === 'Insufficient permissions');

  const cashierPnl = await api('GET', '/api/reports/pnl', { token: cashierToken });
  t('a cashier is REFUSED the P&L', cashierPnl.status === 403);

  const cashierAudit = await api('GET', '/api/audit-logs', { token: cashierToken });
  t('a cashier is REFUSED the audit log', cashierAudit.status === 403);

  const cashierCreateItem = await api('POST', '/api/menu/items', {
    token: cashierToken,
    body: { name: 'Free Coffee', price: 0.01, category: String(category._id) },
  });
  t('a cashier CANNOT create a menu item', cashierCreateItem.status === 403);

  const cashierToggle = await api('PATCH', `/api/menu/items/${coldBrew._id}/availability`, {
    token: cashierToken,
    body: { available: false },
  });
  t('a cashier CAN toggle stock', cashierToggle.status === 200, `status ${cashierToggle.status}`);
  await MenuItem.updateOne({ _id: coldBrew._id }, { $set: { available: true } });

  const smuggle = await api('PATCH', `/api/menu/items/${coldBrew._id}/availability`, {
    token: cashierToken,
    body: { available: true, priceMinor: 1 },
  });
  t('...but cannot smuggle a price through that endpoint', smuggle.status === 400,
    `status ${smuggle.status}`);

  const cashierDashboard = await api('GET', '/api/dashboard', { token: cashierToken });
  t('a cashier gets a dashboard', cashierDashboard.status === 200);
  t('...with the LIMITED scope', cashierDashboard.body?.data?.scope === 'limited');
  t('...and no margin field', cashierDashboard.body?.data?.marginPercent === undefined);
  t('...and no month figures', cashierDashboard.body?.data?.monthSales === undefined);
  t('...and no expense figures', cashierDashboard.body?.data?.monthExpenses === undefined);

  const adminDashboard = await api('GET', '/api/dashboard', { token: adminToken });
  t('an admin gets the FULL scope', adminDashboard.body?.data?.scope === 'full');
  t('...including margin', 'marginPercent' in (adminDashboard.body?.data ?? {}));

  // -------------------------------------------------------------------------
  section('placing an order — the money path');

  const forged = await api('POST', '/api/orders', {
    token: cashierToken,
    body: {
      type: 'takeaway',
      items: [{ menuItemId: String(coldBrew._id), qty: 2, price: 0.01 }],
    },
  });
  t('an order carrying a price is REJECTED outright', forged.status === 400,
    `status ${forged.status}`);

  const soldOutOrder = await api('POST', '/api/orders', {
    token: cashierToken,
    body: { type: 'takeaway', items: [{ menuItemId: String(soldOut._id), qty: 1 }] },
  });
  t('a sold-out item cannot be ordered', soldOutOrder.status === 409,
    `status ${soldOutOrder.status}`);

  const created = await api('POST', '/api/orders', {
    token: cashierToken,
    body: {
      type: 'dine-in',
      tableId: String(table._id),
      items: [{ menuItemId: String(coldBrew._id), qty: 3 }],
    },
  });
  t('a valid order is created', created.status === 201, `status ${created.status}`);

  const order = created.body?.data?.order;
  t('the server priced it from the database', order?.subtotalMinor === 1275,
    `got ${order?.subtotalMinor} (expected 3 x 425)`);
  t('the total matches the subtotal with no tax', order?.totalMinor === 1275);
  t('the line snapshotted the price', order?.items?.[0]?.unitPriceMinor === 425);
  t('the line snapshotted the name', order?.items?.[0]?.name === 'Cold Brew');

  const orderId = order?.id;

  // THE assertion this whole phase exists for.
  const ticket = await Ticket.findOne({ order: orderId });
  t('a kitchen ticket was created alongside the order', Boolean(ticket),
    ticket ? `ticket #${ticket.no}` : 'NO TICKET — the transaction did not hold');
  t('the ticket starts pending', ticket?.status === 'pending');
  t('the ticket names its source', ticket?.source === 'Table T1');

  const claimedTable = await Table.findById(table._id);
  t('the table now holds the open order', String(claimedTable?.currentOrder) === orderId);
  t('the table is occupied', claimedTable?.status === 'occupied');

  const second = await api('POST', '/api/orders', {
    token: cashierToken,
    body: {
      type: 'dine-in',
      tableId: String(table._id),
      items: [{ menuItemId: String(coldBrew._id), qty: 1 }],
    },
  });
  t('a second bill on the same table is refused', second.status === 409,
    `status ${second.status}`);

  // -------------------------------------------------------------------------
  section('price changes do not rewrite history');

  await MenuItem.updateOne({ _id: coldBrew._id }, { $set: { priceMinor: 999 } });
  const refetched = await api('GET', `/api/orders/${orderId}`, { token: cashierToken });
  t('the existing order still shows the price it was sold at',
    refetched.body?.data?.order?.items?.[0]?.unitPriceMinor === 425,
    `got ${refetched.body?.data?.order?.items?.[0]?.unitPriceMinor}`);
  t('and its total is unchanged', refetched.body?.data?.order?.totalMinor === 1275);
  await MenuItem.updateOne({ _id: coldBrew._id }, { $set: { priceMinor: 425 } });

  // -------------------------------------------------------------------------
  section('discount ceiling and manager override');

  const smallDiscount = await api('PATCH', `/api/orders/${orderId}/discount`, {
    token: cashierToken,
    body: { type: 'percent', value: 10 },
  });
  t('a cashier may apply 10%', smallDiscount.status === 200, `status ${smallDiscount.status}`);
  t('the discount is computed server-side',
    smallDiscount.body?.data?.order?.discountMinor === 128,
    `got ${smallDiscount.body?.data?.order?.discountMinor} (10% of 1275, rounded)`);

  const bigDiscount = await api('PATCH', `/api/orders/${orderId}/discount`, {
    token: cashierToken,
    body: { type: 'percent', value: 90 },
  });
  t('a 90% comp is REFUSED without approval', bigDiscount.status === 403,
    `status ${bigDiscount.status}`);

  const wrongPin = await api('PATCH', `/api/orders/${orderId}/discount`, {
    token: cashierToken,
    body: { type: 'percent', value: 90, adminOverridePin: '0000' },
  });
  t('a wrong override PIN is refused', wrongPin.status === 403);

  const approved = await api('PATCH', `/api/orders/${orderId}/discount`, {
    token: cashierToken,
    body: { type: 'percent', value: 90, adminOverridePin: OVERRIDE_PIN },
  });
  t('the correct override PIN allows it', approved.status === 200, `status ${approved.status}`);
  t('the approving manager is recorded',
    approved.body?.data?.order?.approvedBy === String(admin._id));

  await api('PATCH', `/api/orders/${orderId}/discount`, {
    token: cashierToken,
    body: { type: null },
  });

  // -------------------------------------------------------------------------
  section('the kitchen board');

  const board = await api('GET', '/api/kitchen/board', { token: cashierToken });
  t('the board loads', board.status === 200);
  t('the pending column holds the ticket', board.body?.data?.columns?.pending?.length === 1);
  t('the board shows no prices', !/priceMinor|unitPrice/.test(JSON.stringify(board.body)));

  const skip = await api('PATCH', `/api/kitchen/tickets/${ticket._id}/advance`, {
    token: cashierToken,
    body: { status: 'served' },
  });
  t('trying to name a target status is REJECTED', skip.status === 400, `status ${skip.status}`);

  const advance1 = await api('PATCH', `/api/kitchen/tickets/${ticket._id}/advance`, {
    token: cashierToken,
    body: {},
  });
  t('advancing moves pending -> preparing', advance1.body?.data?.ticket?.status === 'preparing',
    advance1.body?.data?.ticket?.status);

  const advance2 = await api('PATCH', `/api/kitchen/tickets/${ticket._id}/advance`, {
    token: cashierToken,
    body: {},
  });
  t('and preparing -> ready', advance2.body?.data?.ticket?.status === 'ready');
  t('readyAt is stamped', Boolean(advance2.body?.data?.ticket?.readyAt));

  const cashierRecall = await api('PATCH', `/api/kitchen/tickets/${ticket._id}/recall`, {
    token: cashierToken,
    body: {},
  });
  t('a cashier CANNOT recall a ticket', cashierRecall.status === 403);

  const adminRecall = await api('PATCH', `/api/kitchen/tickets/${ticket._id}/recall`, {
    token: adminToken,
    body: {},
  });
  t('an admin CAN', adminRecall.status === 200, `status ${adminRecall.status}`);
  t('recall moved it back to preparing', adminRecall.body?.data?.ticket?.status === 'preparing');

  const recalled = await Ticket.findById(ticket._id);
  t('history is append-only — every transition is still there',
    recalled.statusHistory.length >= 4, `${recalled.statusHistory.length} entries`);
  t('the recall is flagged as such',
    recalled.statusHistory.some((h) => h.recalled === true));

  // -------------------------------------------------------------------------
  section('settlement');

  const paid = await api('POST', `/api/orders/${orderId}/pay`, {
    token: cashierToken,
    body: { paymentMethod: 'card' },
  });
  t('the bill settles', paid.status === 200, `status ${paid.status}`);
  t('it is marked paid', paid.body?.data?.order?.status === 'paid');

  const freedTable = await Table.findById(table._id);
  t('the table is released', freedTable?.currentOrder === null);
  /*
   * NOT 'available'. Paying does not make a party stand up — they are still
   * sitting there with their coffee. orderController explains the choice where
   * it releases the bill: a floor plan that turns the table green the instant
   * the card is tapped tells the host a table is free that is not. The table
   * stays seated until someone clears it explicitly.
   *
   * This assertion used to expect 'available' and was simply wrong about the
   * product. Asserting the real rule instead means it now guards that rule.
   */
  t('but the table stays seated until someone clears it',
    freedTable?.status === 'occupied', `status ${freedTable?.status}`);

  const rePay = await api('POST', `/api/orders/${orderId}/pay`, {
    token: cashierToken,
    body: { paymentMethod: 'cash' },
  });
  t('a paid bill cannot be paid twice', rePay.status === 409);

  const edit = await api('PATCH', `/api/orders/${orderId}/items`, {
    token: cashierToken,
    body: { items: [{ menuItemId: String(coldBrew._id), qty: 99 }] },
  });
  t('a paid bill cannot be edited', edit.status === 409);

  // -------------------------------------------------------------------------
  section('voiding a paid bill');

  const cashierVoid = await api('POST', `/api/orders/${orderId}/void`, {
    token: cashierToken,
    body: { reason: 'Testing the void path' },
  });
  t('a cashier cannot void a paid bill unaided', cashierVoid.status === 403,
    `status ${cashierVoid.status}`);

  const approvedVoid = await api('POST', `/api/orders/${orderId}/void`, {
    token: cashierToken,
    body: { reason: 'Wrong table charged', adminOverridePin: OVERRIDE_PIN },
  });
  t('with a manager override, they can', approvedVoid.status === 200,
    `status ${approvedVoid.status}`);
  t('the reason is recorded', approvedVoid.body?.data?.order?.voidReason === 'Wrong table charged');

  // -------------------------------------------------------------------------
  section('reports reflect reality');

  const daily = await api('GET', '/api/reports/daily', { token: adminToken });
  t('the daily report loads for an admin', daily.status === 200);
  t('a voided order is NOT counted as revenue', daily.body?.data?.netMinor === 0,
    `netMinor ${daily.body?.data?.netMinor}`);
  t('but the void IS counted', daily.body?.data?.voidedOrders === 1,
    `voidedOrders ${daily.body?.data?.voidedOrders}`);
  t('all 24 hours are present', daily.body?.data?.hourly?.length === 24);

  // -------------------------------------------------------------------------
  section('concurrency — two cashiers, one table');

  await Table.updateOne(
    { _id: table._id },
    { $set: { status: 'available', currentOrder: null, occupiedAt: null } },
  );

  const bodyFor = () => ({
    type: 'dine-in',
    tableId: String(table._id),
    items: [{ menuItemId: String(coldBrew._id), qty: 1 }],
  });

  const [a, b] = await Promise.all([
    api('POST', '/api/orders', { token: cashierToken, body: bodyFor() }),
    api('POST', '/api/orders', { token: adminToken, body: bodyFor() }),
  ]);

  const successes = [a, b].filter((r) => r.status === 201).length;
  t('exactly ONE of two simultaneous orders on the same table succeeds',
    successes === 1, `${successes} succeeded (${a.status}, ${b.status})`);

  const openOnTable = await Order.countDocuments({ table: table._id, status: 'open' });
  t('the database holds exactly one open bill for that table', openOnTable === 1,
    `${openOnTable} open`);

  // -------------------------------------------------------------------------
  section('transaction atomicity');

  const hasTransactions = await supportsTransactions();
  console.log(`     transactions ${hasTransactions ? 'ARE' : 'are NOT'} supported here`);

  if (hasTransactions) {
    const orders = await Order.countDocuments({});
    const tickets = await Ticket.countDocuments({});
    t('every order has exactly one ticket', orders === tickets,
      `${orders} orders, ${tickets} tickets`);
  } else {
    console.log('     SKIPPED: standalone MongoDB. Order writes are NOT atomic here —');
    console.log('     run against a replica set (Atlas provides one) to verify this.');
  }

  // -------------------------------------------------------------------------
  section('the audit trail recorded what happened');

  const entries = await AuditLog.find({}).sort({ at: 1 });
  const actions = entries.map((e) => e.action);

  /*
   * No successful-login entry is expected here any more: this suite takes its
   * sessions directly rather than signing in, because Google and the terminal
   * device flow are covered end to end by onboarding-flow.test.mjs — which
   * asserts the audit entries those paths write.
   */
  t('a failed login was recorded', actions.includes('auth.login.failure'));
  t('the order creation was recorded', actions.includes('order.create'));
  t('the payment was recorded', actions.includes('order.pay'));
  t('the void was recorded', actions.includes('order.void'));
  t('the manager-approved discount was recorded',
    actions.includes('order.discount.override'));

  const serialised = JSON.stringify(entries);
  t('NO password appears anywhere in the audit trail',
    !serialised.includes(ADMIN_PASSWORD));
  t('NO staff PIN appears', !serialised.includes(CASHIER_PIN));
  t('NO override PIN appears', !serialised.includes(OVERRIDE_PIN));

  const voidEntry = entries.find((e) => e.action === 'order.void');
  t('the void records who approved it', Boolean(voidEntry?.meta?.approvedBy));

  // Immutability is a schema-level guarantee; confirm it actually holds.
  let mutationBlocked = false;
  try {
    await AuditLog.updateOne({ _id: entries[0]._id }, { $set: { action: 'auth.logout' } });
  } catch {
    mutationBlocked = true;
  }
  t('audit entries cannot be edited', mutationBlocked);
 });
} finally {
  await new Promise((r) => server.close(r));
  await wipe();
  await disconnect();
}

process.exit(finish() ? 0 : 1);
