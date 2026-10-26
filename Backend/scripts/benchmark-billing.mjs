/** Repeatable warm HTTP benchmark. Uses ONLY the disposable localhost database. */
import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
const idempotent = process.argv.includes('--idempotent');
process.on('uncaughtException', (error) => { console.error(error); process.exit(1); });
process.on('unhandledRejection', (error) => { console.error(error); process.exit(1); });
process.env.MONGO_URI = 'mongodb://127.0.0.1:27029/pos_benchmark_test?replicaSet=pos-reliability';
process.env.NODE_ENV = 'test';
await import('../tests/helpers/register.mjs');
const { default: mongoose } = await import('mongoose');
const { connectDB } = await import('../src/config/db.js');
await import('../src/models/index.js');
const { default: app } = await import('../app.js');
const { runInTenant } = await import('../src/utils/tenantContext.js');
const { signAccessToken } = await import('../src/utils/jwt.js');
await connectDB();
const { Tenant, User, Category, MenuItem } = mongoose.models;
const tenant = await Tenant.create({ name: 'Benchmark', slug: `benchmark-${Date.now()}` });
let server;
try {
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
  await runInTenant(tenant._id, async () => {
    const admin = await User.create({ name: 'Benchmark Admin', role: 'admin', authProvider: 'google', googleId: `benchmark-${tenant._id}`, email: `${tenant._id}@benchmark.test` });
    const category = await Category.create({ name: 'Benchmark' });
    const item = await MenuItem.create({ name: 'Coffee', category: category._id, priceMinor: 10000, available: true });
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const token = signAccessToken(admin);
    let queries = 0;
    mongoose.set('debug', () => { queries++; });
    const request = async (path, body) => {
      queries = 0;
      const started = performance.now();
      const response = await fetch(`${base}/api${path}`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: AbortSignal.timeout(10000),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(`Benchmark ${path}: ${response.status} ${json.error?.message}`);
      return { data: json.data, ms: performance.now() - started, queries };
    };
    const samples = { create: [], pay: [] };
    for (let n = 0; n < 35; n++) {
      const created = await request('/orders', { type: 'takeaway',
        ...(idempotent ? { clientRequestId: randomUUID() } : {}),
        items: [{ menuItemId: String(item._id), qty: 2 }] });
      const paid = await request(`/orders/${created.data.order.id}/pay`, { paymentMethod: 'cash' });
      if (n >= 5) {
        samples.create.push({ ms: created.ms, queries: created.queries });
        samples.pay.push({ ms: paid.ms, queries: paid.queries });
      }
    }
    const summary = Object.fromEntries(Object.entries(samples).map(([name, rows]) => {
      const times = rows.map((r) => r.ms).sort((a, b) => a - b);
      return [name, { samples: rows.length, p50Ms: +times[14].toFixed(2), p95Ms: +times[28].toFixed(2),
        averageModelOperations: rows.reduce((sum, r) => sum + r.queries, 0) / rows.length }];
    }));
    console.log(JSON.stringify({ environment: 'local replica set; warm takeaway/cash; 5 warmups', idempotent, ...summary }, null, 2));
  });
} finally {
  mongoose.set('debug', false);
  if (server) await new Promise((resolve) => server.close(resolve));
  // Only this run's fixtures; never drop a shared or external database.
  for (const model of Object.values(mongoose.models)) {
    if (model.schema.path('tenantId')) await model.collection.deleteMany({ tenantId: tenant._id });
  }
  await Tenant.deleteOne({ _id: tenant._id });
  await mongoose.models.Counter.deleteMany({ _id: new RegExp(`^order:${tenant._id}:`) });
  await mongoose.disconnect();
}
