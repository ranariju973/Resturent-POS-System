# Deployment

## Before the first production deploy

Ordered by what breaks worst if skipped.

### 1. Rotate every credential

The values currently in `.env` were generated during development and one set was
pasted into a chat transcript. Regenerate all of them:

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"   # x3
```

- [ ] `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `PIN_PEPPER`,
      `INVOICE_TOKEN_PEPPER`, `DEVICE_TOKEN_PEPPER` — all five different. The
      server refuses to start if any two match.

      Three of them are effectively permanent once in use:
      `PIN_PEPPER` invalidates every stored staff PIN, `INVOICE_TOKEN_PEPPER`
      breaks every receipt link already sent to a customer, and
      `DEVICE_TOKEN_PEPPER` un-links every terminal.
- [ ] MongoDB Atlas password
- [ ] Cloudinary API secret

There is no admin password to rotate. Administrators sign in with Google, and
the OAuth client *secret* is not used anywhere in this project.

### 2. Replace `bcrypt` with `bcryptjs`

`bcrypt` compiles a native binary per platform. A `node_modules` built on macOS
**cannot run on Linux** — the loader reports `invalid ELF header`. This will
break any Docker build, CI runner, or Linux teammate.

```bash
npm uninstall bcrypt && npm install bcryptjs
```

Then change the import in `src/models/User.js` and
`src/controllers/authController.js`. Same `hash`/`compare` API, ~30% slower per
hash (irrelevant at a few logins a shift), and existing hashes stay valid.

### 3. Confirm MongoDB is a replica set

Order creation writes three documents in one transaction, and **transactions
require a replica set**. Atlas provides one on every tier, so you are fine — but
verify it, because the fallback is silent-ish:

```bash
npm run dev 2>&1 | grep -i "STANDALONE"
```

If that warning appears, order writes are **not atomic** and can half-commit —
an order with no kitchen ticket means the customer is charged and the kitchen
never cooks.

### 4. Environment

- [ ] `NODE_ENV=production`
- [ ] `CORS_ORIGIN` set to the real frontend domain. The server **refuses to
      start** if it contains `localhost` or `*` in production
- [ ] `PORT` matches what the host expects
- [ ] `LOG_LEVEL=info` (not `debug` — debug logs more request context)

### 5. Database

> **Upgrading to the multi-tenant release?** Running `sync-indexes` is not
> optional. The old database carries a GLOBAL unique index on `pinLookup` and
> `email`; until those are replaced by the tenant-scoped ones, two restaurants
> still cannot issue the same staff PIN — the exact bug the release exists to
> fix. `syncIndexes()` drops what the schemas no longer declare, so one run
> reconciles both directions.

- [ ] Connection string uses a user scoped to **this database only**, not a
      cluster admin
- [ ] Atlas Network Access allows the deployment's IP, not `0.0.0.0/0`
- [ ] **Build indexes explicitly.** `autoIndex` is off in production
      (`src/config/db.js`), so without this every query falls back to a
      collection scan — the database reads every document to answer what an
      index would have answered in one seek. On a shared/free-tier cluster
      that is the single biggest source of avoidable load, and it gets worse
      as order history grows.

```bash
MONGO_URI="<production uri>" npm run sync-indexes
```

Run it once after the first deploy, and again whenever a schema's indexes
change. It is safe to re-run: `syncIndexes()` also drops indexes that are no
longer declared, so the database ends up matching the schemas rather than
accumulating whatever every past version created.

### 6. TLS and proxying

The app does **not** terminate TLS. Put it behind a proxy or platform that does.

- [ ] HTTPS enforced at the edge
- [ ] `trust proxy` in `app.js` matches the actual number of proxy hops
      (currently `1`). Too low and every client looks like the proxy, which
      makes per-IP rate limiting useless
- [ ] HSTS is sent automatically once `NODE_ENV=production`

### 7. Seed and verify

```bash
# No admin seed exists. The first person to sign in with Google is asked to
# name a restaurant and becomes its administrator — see the root DEPLOYMENT.md.
npm run dev
curl -s https://your-domain/api/health      # expect "db":"up"
```

---

## Known limitations at this scale

These are fine for one restaurant on one server and become problems the moment
that changes.

**Rate limiters are in-memory.** Two instances behind a load balancer each
enforce their own separate budget, so the effective limit doubles. Needs a
shared store (Redis) to scale horizontally.

**The SSE event bus is in-process.** Two instances would each only notify the
kitchen boards connected to them — a ticket advanced on instance A never reaches
a board on instance B. Same fix, same trigger.

**No user-management endpoints.** Staff PINs and the manager override PIN can
only be set by re-seeding. There is no way to add a cashier, rotate a PIN, or
deactivate someone who has left. This is an operational hole, not just a missing
feature — plan for it before real staff turnover.

---

## Running the tests

```bash
npm run verify           # 858 assertions, no database needed
npm run test:integration # requires MongoDB — see below
```

The integration suite **rewrites the database name to a `_test` suffix** and
refuses to run unless it ends that way, so pointing it at your Atlas URI is
safe: it uses `restaurant_pos_test`, never `restaurant_pos`. It also refuses to
run with `NODE_ENV=production`.

**It has never been executed.** It was written in an environment with no
MongoDB available. Treat the first run as debugging the tests as much as the
code — expect failures that are the suite's fault, not the API's.

---

## Regenerating docs

```bash
npm run docs    # rewrites API.md from src/routes/
```

`API.md` is generated, never hand-edited. A hand-maintained API reference is
wrong within a month, and a wrong reference is worse than none because it gets
trusted.
