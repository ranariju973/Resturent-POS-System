/**
 * Tenant isolation — the guarantee the whole multi-restaurant design rests on.
 *
 * ── What this proves ───────────────────────────────────────────────────────
 * Everything else about multi-tenancy is arrangement; this is the property.
 * Two restaurants share one deployment, one database and one set of
 * collections, and neither can see, change or block the other.
 *
 * The concrete bug it exists to prevent is the staff PIN. Before tenant
 * scoping, `pinLookup` carried a GLOBALLY unique index and
 * `User.findActiveByPin` searched every user: restaurant A issuing PIN 1234
 * stopped restaurant B from ever using it, and worse, B's cashier tapping
 * their PIN could match A's row. That is a cross-restaurant authentication
 * failure, not a scaling limit, and §"the PIN case" below is the test that
 * says it is fixed.
 *
 * ── Why these run against a real database ──────────────────────────────────
 * The plugin's guarantees are enforced by MongoDB indexes and by Mongoose
 * middleware, neither of which exists in a unit test. A source-text assertion
 * could confirm the plugin is applied; only a real duplicate-key error can
 * confirm that uniqueness is per-restaurant.
 *
 * Run with:  npm run test:integration
 */
import mongoose from 'mongoose';
import { connect, wipe, disconnect, createReporter } from './setup.mjs';

process.env.JWT_ACCESS_SECRET ??= 'a'.repeat(64);
process.env.JWT_REFRESH_SECRET ??= 'b'.repeat(64);
process.env.PIN_PEPPER ??= 'c'.repeat(64);
process.env.INVOICE_TOKEN_PEPPER ??= 'v'.repeat(64);
process.env.DEVICE_TOKEN_PEPPER ??= 'd'.repeat(64);
process.env.GOOGLE_CLIENT_ID ??= 'test-client.apps.googleusercontent.com';
process.env.CORS_ORIGIN ??= 'http://localhost:5173';
process.env.CLOUDINARY_CLOUD_NAME ??= 'test';
process.env.CLOUDINARY_API_KEY ??= 'test';
process.env.CLOUDINARY_API_SECRET ??= 'test';
process.env.LOG_LEVEL = 'error';

const { t, section, finish } = createReporter();

await connect();
await wipe();

const { tenantScoped } = await import('../../src/models/plugins/tenantScoped.js');
const {
  runInTenant,
  runUnscoped,
  TenantContextMissing,
} = await import('../../src/utils/tenantContext.js');

/*
 * A purpose-built model rather than a real one.
 *
 * The real models carry their own validators, hooks and required fields, all
 * of which would need satisfying on every line and none of which is what is
 * under test here. This isolates the plugin: if one of these fails, the
 * failure is the plugin's, not a Category's colour regex.
 *
 * The real models are covered by their own suites and by the guard test that
 * asserts every one of them applies this plugin.
 */
const widgetSchema = new mongoose.Schema(
  { name: String, isActive: { type: Boolean, default: true } },
  {
    toJSON: {
      virtuals: true,
      transform(_doc, ret) {
        delete ret.__v;
        delete ret._id;
        return ret;
      },
    },
  },
);
widgetSchema.virtual('id').get(function idGetter() {
  return this._id?.toHexString?.() ?? this._id;
});
widgetSchema.plugin(tenantScoped, { unique: [{ fields: { name: 1 } }] });

const Widget = mongoose.models.TenantIsolationWidget
  ?? mongoose.model('TenantIsolationWidget', widgetSchema);

await Widget.collection.drop().catch(() => {});
await Widget.syncIndexes();

/** Two restaurants on one deployment. */
const RESTAURANT_A = new mongoose.Types.ObjectId();
const RESTAURANT_B = new mongoose.Types.ObjectId();

// ---------------------------------------------------------------------------
section('the PIN case — uniqueness is per-restaurant, not global');
// ---------------------------------------------------------------------------
/*
 * `name` here stands in for `pinLookup`. The shape is identical: a value that
 * must be unique WITHIN one restaurant and must not constrain any other.
 */
const aPizza = await runInTenant(RESTAURANT_A, async () => Widget.create({ name: '1234' }));
t('a value can be claimed in restaurant A', String(aPizza.tenantId) === String(RESTAURANT_A));

let bClaimedSame = true;
let bError = '';
try {
  await runInTenant(RESTAURANT_B, async () => Widget.create({ name: '1234' }));
} catch (err) {
  bClaimedSame = false;
  bError = err.message.slice(0, 120);
}
t('THE REQUIREMENT: restaurant B may claim the same value', bClaimedSame, bError);

let duplicateRefused = false;
try {
  await runInTenant(RESTAURANT_A, async () => Widget.create({ name: '1234' }));
} catch (err) {
  duplicateRefused = err.code === 11000;
}
t('but a duplicate WITHIN one restaurant is still refused', duplicateRefused);

// ---------------------------------------------------------------------------
section('reads cannot cross');
// ---------------------------------------------------------------------------
const seenByA = await runInTenant(RESTAURANT_A, async () => Widget.find({}));
t('find returns only this restaurant\'s rows',
  seenByA.length === 1 && String(seenByA[0].tenantId) === String(RESTAURANT_A),
  `saw ${seenByA.length}`);

const bDoc = await runInTenant(RESTAURANT_B, async () => Widget.findOne({ name: '1234' }));
const stolen = await runInTenant(RESTAURANT_A, async () => Widget.findById(bDoc._id));
t('another restaurant\'s document is invisible even by direct id', stolen === null);

const counted = await runInTenant(RESTAURANT_A, async () => Widget.countDocuments({}));
t('countDocuments counts only this restaurant', counted === 1, `counted ${counted}`);

const grouped = await runInTenant(RESTAURANT_A, async () =>
  Widget.aggregate([{ $group: { _id: null, n: { $sum: 1 } } }]));
t('aggregate pipelines are scoped too', grouped[0]?.n === 1, `summed ${grouped[0]?.n}`);

/*
 * A $or at the top level must be ANDed with the tenant clause, not placed
 * beside it. Getting this wrong is subtle and total: `{$or: [...]}` sitting
 * next to a tenant filter still matches, but a filter REPLACED by an $or
 * matches every restaurant at once.
 */
const ored = await runInTenant(RESTAURANT_A, async () =>
  Widget.find({ $or: [{ name: '1234' }, { name: 'anything' }] }));
t('a top-level $or stays ANDed with the tenant clause', ored.length === 1, `saw ${ored.length}`);

/*
 * A caller supplying someone else's tenantId must not reach it. The plugin
 * overrides the supplied value, so this returns THIS restaurant's rows — not
 * the other's, and not an empty set that might look like a working filter.
 */
const widened = await runInTenant(RESTAURANT_A, async () =>
  Widget.find({ tenantId: RESTAURANT_B }));
t('a caller cannot widen scope by passing another restaurant\'s id',
  widened.length === 1 && widened.every((d) => String(d.tenantId) === String(RESTAURANT_A)),
  `saw ${widened.length}`);

// ---------------------------------------------------------------------------
section('writes cannot cross');
// ---------------------------------------------------------------------------
const updated = await runInTenant(RESTAURANT_A, async () =>
  Widget.updateOne({ _id: bDoc._id }, { $set: { name: 'overwritten' } }));
t('cannot update another restaurant\'s document', updated.matchedCount === 0);

const deleted = await runInTenant(RESTAURANT_A, async () =>
  Widget.deleteOne({ _id: bDoc._id }));
t('cannot delete another restaurant\'s document', deleted.deletedCount === 0);

let foreignWriteRefused = false;
try {
  await runInTenant(RESTAURANT_A, async () =>
    Widget.create({ name: 'smuggled', tenantId: RESTAURANT_B }));
} catch (err) {
  foreignWriteRefused = /another restaurant/i.test(err.message);
}
t('a document carrying a foreign tenantId is refused, not silently corrected',
  foreignWriteRefused);

await runInTenant(RESTAURANT_A, async () =>
  Widget.updateOne({ name: 'upserted' }, { $set: { isActive: true } }, { upsert: true }));
const upserted = await runUnscoped('test: verify upsert stamping', async () =>
  Widget.findOne({ name: 'upserted' }));
t('an upsert that inserts is stamped with the tenant',
  String(upserted?.tenantId) === String(RESTAURANT_A));

await runInTenant(RESTAURANT_B, async () =>
  Widget.insertMany([{ name: 'bulk-1' }, { name: 'bulk-2' }]));
const bAfterBulk = await runInTenant(RESTAURANT_B, async () => Widget.find({}));
t('insertMany stamps every document',
  bAfterBulk.length === 3 && bAfterBulk.every((d) => String(d.tenantId) === String(RESTAURANT_B)),
  `saw ${bAfterBulk.length}`);

// ---------------------------------------------------------------------------
section('failure is closed, never open');
// ---------------------------------------------------------------------------
/*
 * The single most important assertion in this file. A scoped query with no
 * tenant in context must THROW — never fall back to returning everything,
 * which is the exact leak the design exists to prevent.
 */
let thrown = null;
try {
  await Widget.find({});
} catch (err) {
  thrown = err;
}
t('a query with no tenant context throws rather than reading every restaurant',
  thrown instanceof TenantContextMissing,
  thrown ? '' : 'IT RETURNED DATA — this is a cross-tenant leak');

let writeThrown = null;
try {
  await Widget.create({ name: 'contextless' });
} catch (err) {
  writeThrown = err;
}
t('a write with no tenant context throws', writeThrown instanceof TenantContextMissing);

const everything = await runUnscoped('test: verify unscoped reads all', async () => Widget.find({}));
t('runUnscoped deliberately sees every restaurant', everything.length === 5,
  `saw ${everything.length}`);

// ---------------------------------------------------------------------------
section('tenantId never reaches a client');
// ---------------------------------------------------------------------------
const serialised = aPizza.toJSON();
t('toJSON strips tenantId', serialised.tenantId === undefined);
t('toJSON preserves the model\'s own transform (_id and __v still stripped)',
  serialised._id === undefined && serialised.__v === undefined);
t('toJSON preserves virtuals declared by the model', typeof serialised.id === 'string');

await Widget.collection.drop().catch(() => {});

// ---------------------------------------------------------------------------
section('the real User model — staff PINs across restaurants');
// ---------------------------------------------------------------------------
/*
 * The section above proves the plugin in isolation. This one proves the thing
 * the customer actually asked for, on the real model, through the real lookup
 * path that authController.loginStaff uses.
 */
const { User } = await import('../../src/models/User.js');
const { Tenant } = await import('../../src/models/Tenant.js');
const { ROLES } = await import('../../src/constants/enums.js');

const makeTenant = (name) => runUnscoped('test: create a tenant', async () =>
  Tenant.create({ name, slug: await Tenant.generateSlug(name) }));

const makeCashier = (tenant, name, pin) => runInTenant(tenant._id, async () => {
  const user = new User({ name, role: ROLES.CASHIER });
  await user.setPin(pin);
  return user.save();
});

const alpha = await makeTenant('Restaurant Alpha');
const beta = await makeTenant('Restaurant Beta');
const gamma = await makeTenant('Restaurant Gamma');

await makeCashier(alpha, 'Alpha Cashier', '1234');

let betaTookSamePin = true;
let betaError = '';
try {
  await makeCashier(beta, 'Beta Cashier', '1234');
} catch (err) {
  betaTookSamePin = false;
  betaError = err.message.slice(0, 120);
}
t('two restaurants can issue the SAME staff PIN', betaTookSamePin, betaError);

let reusedInternally = false;
try {
  await makeCashier(alpha, 'Alpha Second', '1234');
} catch (err) {
  reusedInternally = err.code === 11000;
}
t('one restaurant still cannot issue the same PIN twice', reusedInternally);

/*
 * The authentication crux. Before scoping, findActiveByPin searched every user
 * on the deployment, so this lookup could return the OTHER restaurant's
 * cashier — a cross-restaurant sign-in.
 */
const viaAlpha = await runInTenant(alpha._id, async () => User.findActiveByPin('1234'));
const viaBeta = await runInTenant(beta._id, async () => User.findActiveByPin('1234'));

t('an Alpha terminal resolves Alpha\'s cashier',
  viaAlpha?.name === 'Alpha Cashier', `resolved ${viaAlpha?.name}`);
t('a Beta terminal resolves Beta\'s cashier',
  viaBeta?.name === 'Beta Cashier', `resolved ${viaBeta?.name}`);
t('the same four digits resolve to two different people',
  String(viaAlpha?._id) !== String(viaBeta?._id));
t('the resolved account verifies against the PIN', await viaBeta.verifyPin('1234'));
t('a restaurant that never issued that PIN matches nobody',
  (await runInTenant(gamma._id, async () => User.findActiveByPin('1234'))) === null);

await wipe();
await disconnect();

process.exit(finish() ? 0 : 1);
