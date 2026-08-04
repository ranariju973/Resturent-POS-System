# Deployment

## Before the first production deploy

Ordered by what breaks worst if skipped.

### 1. Rotate every credential

The values currently in `.env` were generated during development and one set was
pasted into a chat transcript. Regenerate all of them:

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"   # x3
```

- [ ] `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `PIN_PEPPER` — all three
      different. **Changing `PIN_PEPPER` invalidates every stored staff PIN**,
      so do it before staff exist or plan to re-seed.
- [ ] `SEED_ADMIN_PASSWORD` — still the generated placeholder
- [ ] `SEED_ADMIN_OVERRIDE_PIN` — currently `4417`
- [ ] MongoDB Atlas password
- [ ] Cloudinary API secret

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

- [ ] Connection string uses a user scoped to **this database only**, not a
      cluster admin
- [ ] Atlas Network Access allows the deployment's IP, not `0.0.0.0/0`
- [ ] **Build indexes explicitly.** `autoIndex` is off in production
      (`src/config/db.js`), so without this every query falls back to a
      collection scan:

```js
// Run once against production, after the first deploy
import './src/models/index.js';
import mongoose from 'mongoose';
await mongoose.connect(process.env.MONGO_URI);
for (const name of mongoose.modelNames()) {
  await mongoose.model(name).syncIndexes();
  console.log(`indexed ${name}`);
}
```

### 6. TLS and proxying

The app does **not** terminate TLS. Put it behind a proxy or platform that does.

- [ ] HTTPS enforced at the edge
- [ ] `trust proxy` in `app.js` matches the actual number of proxy hops
      (currently `1`). Too low and every client looks like the proxy, which
      makes per-IP rate limiting useless
- [ ] HSTS is sent automatically once `NODE_ENV=production`

### 7. Seed and verify

```bash
npm run seed                    # admin only — do NOT use --demo in production
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
