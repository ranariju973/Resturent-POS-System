/**
 * The whole Phase 2 flow, over real HTTP: Google sign-in → naming a restaurant
 * → linking a terminal → staff signing in with a PIN. Twice, for two
 * restaurants, proving neither can reach the other.
 *
 * ── What this covers that the isolation suite does not ─────────────────────
 * tenant-isolation.test.mjs proves the database cannot leak across
 * restaurants. This proves the SEQUENCE a real owner walks through actually
 * works end to end — that a session with no restaurant can reach exactly two
 * endpoints, that naming one retires the old token, and that a terminal's
 * cookie is what lets a PIN resolve at all.
 *
 * Google itself is not called. Verifying an ID token is Google's job and is
 * covered by asserting the handler rejects a bad one; what this needs is the
 * account that a verified token WOULD produce, which it creates directly.
 *
 * Run with:  npm run test:integration
 */
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

const { default: app } = await import('../../app.js');
const { User } = await import('../../src/models/User.js');
const { Category } = await import('../../src/models/Category.js');
const { runUnscoped, runInTenant } = await import('../../src/utils/tenantContext.js');
const { signAccessToken } = await import('../../src/utils/jwt.js');
const { ROLES } = await import('../../src/constants/enums.js');

/*
 * ── Stubbing Google, and only Google ──────────────────────────────────────
 * `verifyIdToken` makes a network call to fetch Google's signing keys and
 * checks a real signature. That is Google's job, it needs live credentials no
 * test can hold, and it is asserted separately below by confirming a forged
 * credential is refused.
 *
 * Everything AFTER verification is ours — find-or-create, the onboarding
 * branch, session issue — and it was previously untested over HTTP because
 * this suite minted its own tokens and skipped the endpoint entirely. That gap
 * hid a 500 on the very first Google sign-in.
 *
 * So the prototype method is replaced, and nothing else is.
 */
const { OAuth2Client } = await import('google-auth-library');
const realVerify = OAuth2Client.prototype.verifyIdToken;

/** Credentials this stub accepts, keyed by the string the client sends. */
const googleIdentities = new Map();

OAuth2Client.prototype.verifyIdToken = async function stubVerify({ idToken }) {
  const identity = googleIdentities.get(idToken);
  // Anything not registered behaves exactly as a forged token does.
  if (!identity) throw new Error('Invalid token signature');
  return { getPayload: () => identity };
};

const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;

/**
 * A per-terminal cookie jar.
 *
 * The device cookie is the whole point of this suite, so cookies cannot be
 * shared between the two restaurants' terminals — that would be one browser
 * standing in two restaurants, which is exactly the confusion under test.
 */
const jars = new Map();
const cookiesFor = (key) => jars.get(key) ?? [];

async function call(method, path, { token, body, jar } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const jarCookies = jar ? cookiesFor(jar) : [];
  if (jarCookies.length) headers.Cookie = jarCookies.join('; ');

  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    // A hung request must fail the suite, not stall it forever with no output.
    signal: AbortSignal.timeout(10_000),
  });

  if (jar) {
    const next = [...cookiesFor(jar)];
    for (const raw of res.headers.getSetCookie?.() ?? []) {
      const pair = raw.split(';')[0];
      const name = (c) => c.split('=')[0];
      const at = next.findIndex((c) => name(c) === name(pair));
      if (at >= 0) next[at] = pair;
      else next.push(pair);
    }
    jars.set(jar, next);
  }

  let json = null;
  try {
    json = await res.json();
  } catch {
    /* 204 and friends */
  }
  return { status: res.status, body: json };
}

/**
 * The account a verified Google token would produce, and a session for it.
 * Stands in for POST /auth/google, whose own job — verifying the token — is
 * Google's and is asserted separately below.
 */
async function googleAccount(email, name) {
  const user = await runUnscoped('test: create a google account', async () =>
    User.create({
      name,
      email,
      googleId: `google-sub-${email}`,
      authProvider: 'google',
      role: ROLES.ADMIN,
      tenantId: null,
      isActive: true,
    }));
  return signAccessToken({ id: user._id, role: user.role, tokenVersion: 0, tenantId: null });
}

// ---------------------------------------------------------------------------
section('signing in with Google for the very first time');
// ---------------------------------------------------------------------------
/*
 * The real endpoint, with only Google's signature check stubbed. This is the
 * first thing a new customer ever does, and it was reaching a 500: the handler
 * writes a last-login timestamp, that write is tenant-scoped, and a brand-new
 * account has no restaurant for it to be scoped by.
 */
googleIdentities.set('token-newcomer', {
  sub: 'google-sub-newcomer',
  email: 'newcomer@test.invalid',
  email_verified: true,
  name: 'Newcomer Owner',
  given_name: 'Newcomer',
  picture: 'https://example.invalid/a.png',
});

const firstSignIn = await call('POST', '/api/auth/google', {
  body: { credential: 'token-newcomer' },
});
t('a brand-new Google account can sign in', firstSignIn.status === 200,
  `status ${firstSignIn.status} ${JSON.stringify(firstSignIn.body?.error ?? '')}`);
t('...and is told to name a restaurant', firstSignIn.body?.data?.onboarding?.required === true);
t('...with a real session, not an error', typeof firstSignIn.body?.data?.accessToken === 'string');
t('...and a suggested name from their Google profile',
  firstSignIn.body?.data?.onboarding?.suggestedName === "Newcomer's Restaurant",
  firstSignIn.body?.data?.onboarding?.suggestedName);

/*
 * Signing in again must find the SAME account rather than minting a second —
 * googleId is globally unique, so a duplicate would be a hard failure.
 */
const secondSignIn = await call('POST', '/api/auth/google', {
  body: { credential: 'token-newcomer' },
});
t('signing in again returns the same account', secondSignIn.status === 200,
  `status ${secondSignIn.status}`);
t('...and does not create a duplicate',
  secondSignIn.body?.data?.user?.id === firstSignIn.body?.data?.user?.id);

/*
 * An unverified address is refused. Google says whether it verified the
 * mailbox; we decide whether that is good enough, because email is how a
 * person is recognised.
 */
googleIdentities.set('token-unverified', {
  sub: 'google-sub-unverified',
  email: 'unverified@test.invalid',
  email_verified: false,
  name: 'Unverified',
});
const unverified = await call('POST', '/api/auth/google', {
  body: { credential: 'token-unverified' },
});
t('an unverified Google email is refused', unverified.status === 401,
  `status ${unverified.status}`);

// ---------------------------------------------------------------------------
section('a session with no restaurant can reach almost nothing');
// ---------------------------------------------------------------------------
const preTokenA = await googleAccount('owner-a@test.invalid', 'Owner A');

const me = await call('GET', '/api/auth/me', { token: preTokenA });
t('it reaches /auth/me', me.status === 200, `status ${me.status}`);
t('...and is told onboarding is required', me.body?.data?.onboarding?.required === true);
t('...with no restaurant attached', me.body?.data?.restaurant === null);

/*
 * The important half. This is not enforced by a check in the route — it falls
 * out of the model plugin refusing any scoped query with no tenant, which is
 * why it holds for every endpoint rather than the ones someone remembered.
 */
const blocked = await call('GET', '/api/menu/items', { token: preTokenA });
t('it CANNOT reach the menu', blocked.status >= 400, `status ${blocked.status}`);

const blockedOrders = await call('GET', '/api/orders', { token: preTokenA });
t('it CANNOT reach orders', blockedOrders.status >= 400, `status ${blockedOrders.status}`);

// ---------------------------------------------------------------------------
section('naming a restaurant');
// ---------------------------------------------------------------------------
const createdA = await call('POST', '/api/tenants', {
  token: preTokenA,
  body: { name: 'Alpha Diner' },
  jar: 'terminal-a',
});
t('the restaurant is created', createdA.status === 201, `status ${createdA.status}`);
t('...and comes back named', createdA.body?.data?.restaurant?.name === 'Alpha Diner');

const tokenA = createdA.body?.data?.accessToken;
const tenantA = createdA.body?.data?.restaurant?.id;
t('a fresh access token is issued', typeof tokenA === 'string' && tokenA !== preTokenA);

/*
 * The old token carried an empty restaurant claim. requireAuth compares that
 * claim against the database on every request, so leaving it valid would mean
 * a live session whose token disagrees with the account it belongs to.
 */
const stale = await call('GET', '/api/menu/items', { token: preTokenA });
t('the pre-onboarding token is now rejected', stale.status === 401, `status ${stale.status}`);

const withNew = await call('GET', '/api/menu/items', { token: tokenA });
t('the new token reaches the menu', withNew.status === 200, `status ${withNew.status}`);

const second = await call('POST', '/api/tenants', { token: tokenA, body: { name: 'Another' } });
t('a second restaurant on one account is refused', second.status === 409, `status ${second.status}`);

// ---------------------------------------------------------------------------
section('linking a terminal');
// ---------------------------------------------------------------------------
const beforeLink = await call('GET', '/api/auth/terminal', { jar: 'terminal-a' });
t('an unlinked terminal reports itself as such', beforeLink.body?.data?.linked === false);

const pinBeforeLink = await call('POST', '/api/auth/login/staff', {
  body: { pin: '1234' },
  jar: 'terminal-a',
});
t('a PIN at an unlinked terminal is refused', pinBeforeLink.status === 401);
t('...with a code the client can distinguish from a wrong PIN',
  pinBeforeLink.body?.error?.code === 'TERMINAL_NOT_LINKED',
  pinBeforeLink.body?.error?.code);

const linked = await call('POST', '/api/devices', {
  token: tokenA,
  body: { name: 'Front counter' },
  jar: 'terminal-a',
});
t('an administrator can link the terminal', linked.status === 201, `status ${linked.status}`);
t('a device cookie was set', cookiesFor('terminal-a').some((c) => c.startsWith('vp_dev=')));

/*
 * The raw token must never appear in a body — same discipline as the refresh
 * token. A value in a response can be read by script, logged by a proxy, or
 * pasted into a support ticket; an httpOnly cookie cannot.
 */
const linkedBody = JSON.stringify(linked.body ?? {});
t('the device token is NOT in the response body',
  !linkedBody.includes('tokenHash') && !/[A-Za-z0-9_-]{32,}/.test(linkedBody));

const afterLink = await call('GET', '/api/auth/terminal', { jar: 'terminal-a' });
t('the terminal now names its restaurant',
  afterLink.body?.data?.restaurant?.name === 'Alpha Diner');
t('...and itself', afterLink.body?.data?.terminal?.name === 'Front counter');

// ---------------------------------------------------------------------------
section('staff sign in with a PIN');
// ---------------------------------------------------------------------------
await runInTenant(tenantA, async () => {
  const cashier = new User({ name: 'Alpha Cashier', role: ROLES.CASHIER });
  await cashier.setPin('1234');
  await cashier.save();
});

const pinA = await call('POST', '/api/auth/login/staff', { body: { pin: '1234' }, jar: 'terminal-a' });
t('the PIN now works', pinA.status === 200, `status ${pinA.status}`);
t('...and resolves the right person', pinA.body?.data?.user?.name === 'Alpha Cashier');
t('...at the right restaurant', pinA.body?.data?.restaurant?.name === 'Alpha Diner');
t('...on the named terminal', pinA.body?.data?.terminal?.name === 'Front counter');

// ---------------------------------------------------------------------------
section('a second restaurant, using the SAME staff PIN');
// ---------------------------------------------------------------------------
const preTokenB = await googleAccount('owner-b@test.invalid', 'Owner B');
const createdB = await call('POST', '/api/tenants', {
  token: preTokenB,
  body: { name: 'Beta Bistro' },
  jar: 'terminal-b',
});
t('a second restaurant can be created', createdB.status === 201, `status ${createdB.status}`);

const tokenB = createdB.body?.data?.accessToken;
const tenantB = createdB.body?.data?.restaurant?.id;

await call('POST', '/api/devices', { token: tokenB, body: { name: 'Till 1' }, jar: 'terminal-b' });

await runInTenant(tenantB, async () => {
  const cashier = new User({ name: 'Beta Cashier', role: ROLES.CASHIER });
  // The same four digits Alpha already issued.
  await cashier.setPin('1234');
  await cashier.save();
});

const pinB = await call('POST', '/api/auth/login/staff', { body: { pin: '1234' }, jar: 'terminal-b' });
t('THE REQUIREMENT: the same PIN works at the other restaurant',
  pinB.status === 200, `status ${pinB.status}`);
t('...and resolves BETA\'s cashier, not Alpha\'s',
  pinB.body?.data?.user?.name === 'Beta Cashier', `resolved ${pinB.body?.data?.user?.name}`);
t('...at Beta\'s restaurant', pinB.body?.data?.restaurant?.name === 'Beta Bistro');

// ---------------------------------------------------------------------------
section('neither restaurant can see the other');
// ---------------------------------------------------------------------------
await runInTenant(tenantA, async () => Category.create({ name: 'Alpha Drinks', color: '#00754A' }));
await runInTenant(tenantB, async () => Category.create({ name: 'Beta Drinks', color: '#00754A' }));

const catsA = await call('GET', '/api/menu/categories', { token: tokenA });
const namesA = (catsA.body?.data?.categories ?? []).map((c) => c.name);
t('Alpha sees only its own categories',
  namesA.length === 1 && namesA[0] === 'Alpha Drinks', namesA.join(', ') || 'none');

const catsB = await call('GET', '/api/menu/categories', { token: tokenB });
const namesB = (catsB.body?.data?.categories ?? []).map((c) => c.name);
t('Beta sees only its own categories',
  namesB.length === 1 && namesB[0] === 'Beta Drinks', namesB.join(', ') || 'none');

// Both restaurants opened on the same day; each should start at invoice 1.
t('the two restaurants are genuinely different', tenantA !== tenantB);

// ---------------------------------------------------------------------------
section('a Google token that does not verify is refused');
// ---------------------------------------------------------------------------
const badToken = await call('POST', '/api/auth/google', { body: { credential: 'not-a-real-token' } });
t('a forged credential is rejected', badToken.status === 401, `status ${badToken.status}`);
t('...with the generic message, revealing nothing',
  badToken.body?.error?.message === 'Invalid credentials', badToken.body?.error?.message);

OAuth2Client.prototype.verifyIdToken = realVerify;
await new Promise((r) => server.close(r));
await wipe();
await disconnect();

process.exit(finish() ? 0 : 1);
