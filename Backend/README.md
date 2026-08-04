# Verdant Café POS — Backend

Node.js + Express + MongoDB + Cloudinary API for the restaurant POS.
Build plan and RBAC matrix: [`BACKEND-BUILD-PLAN.md`](./BACKEND-BUILD-PLAN.md).

**Status: all 12 phases complete.** 55 routes, 858 contract assertions, an integration
suite, generated API docs and a deployment guide.

| Document | What it is |
| --- | --- |
| [`API.md`](./API.md) | Generated route reference — 55 routes, permissions, validation |
| [`SECURITY-REVIEW.md`](./SECURITY-REVIEW.md) | What the Phase 11 sweep found, accepted risks, open gaps |
| [`DEPLOYMENT.md`](./DEPLOYMENT.md) | Pre-production checklist, ordered by what breaks worst |
| [`BACKEND-BUILD-PLAN.md`](./BACKEND-BUILD-PLAN.md) | The original 12-phase plan and RBAC matrix |

**The one thing to know before trusting this:** the 858 assertions cover contracts and
guards, not behaviour end to end. The integration suite that would close that gap exists
but **has never been run** — there was no MongoDB in the environment where it was written.
`npm run test:integration` is the first real test of this system.

## Setup

```bash
cd Backend
npm install
cp .env.example .env       # then fill in the values below
npm run dev                # http://localhost:5000
```

Generate the three secrets (`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `PIN_PEPPER` —
all must be different values):

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

You need a MongoDB connection string (local `mongodb://127.0.0.1:27017/verdant_pos`
or an Atlas SRV URI) and a free Cloudinary account for the three `CLOUDINARY_*` values.
The server refuses to start if any required variable is missing — that's deliberate,
so a misconfigured deploy fails loudly instead of running without auth secrets.

## Seeding

```bash
npm run seed                    # admin account only, from SEED_ADMIN_* in .env
npm run seed -- --demo          # + demo menu, tables, staff, customers, expenses
npm run seed -- --demo --reset  # wipe first (refused when NODE_ENV=production)
```

Demo staff PINs are randomly generated and printed **once**. They are stored hashed and
cannot be recovered — note them down or re-seed with `--reset`.

## Tests

```bash
npm run verify            # 858 assertions, no database needed — all passing
npm run test:integration  # needs MongoDB. NEVER YET EXECUTED — see below
```

858 assertions across 17 suites. Six boot the real app on an ephemeral port and make real
HTTP requests against it.

**What they do NOT cover.** No MongoDB ran in the environment where this was built, so
nothing that reads or writes a document has been executed: order transactions, Cloudinary
cleanup, concurrency under real load, successful authentication. `tests/integration/`
covers exactly those things and is written but unrun. It rewrites the database name to a
`_test` suffix and refuses to start otherwise, so pointing it at your Atlas URI is safe.
Expect its first run to surface bugs in the tests as well as the code.

| Suite | Covers |
| --- | --- |
| `money` | Minor-unit conversion, exact line totals, single-point rounding, split-bill remainder conservation |
| `enums` | Ticket and table state machines are forward-only and total |
| `order-totals` | Real `recalculate()` lifted from `Order.js` — discount/tax ordering, negative-total clamping, tamper guard |
| `schema-audit` | No model leaks a credential through `toJSON`; indexes and integrity constraints present |
| `auth-security` | 53 static checks on the auth surface — algorithm pinning, cookie flags, generic failure messages, reuse detection, rate limits |
| `session-rotation` | Executable model of the session policy — single-use tokens, reuse revoking one session, logout-all reaching live access tokens |
| `lockout` | Brute-force arithmetic against the real constants |
| `rbac-matrix` | Runs the real `hasPermission` — 75 role/permission cells and 66 route/role combinations against the agreed spec, plus fail-closed behaviour |
| `client-permission-parity` | Frontend and backend permission strings cannot drift apart |
| `http-security` | **Live requests against the real app** — headers, CORS rejection, body limits, NoSQL operator stripping, `alg:none` forgery, rate limiting |
| `menu-api` | Real zod schemas and the real magic-byte detector; every menu route rejects an anonymous caller over live HTTP |
| `table-api` | Seat-count bounds, transition legality, split-bill conservation across 42 total/ways combinations, auth wall, atomic-update audit |
| `order-api` | Price-tampering rejection, discount-ceiling arithmetic, void authority, state guards, transaction audit |
| `kitchen-api` | **Event bus run end to end in-process**; real stream-token round trip proving the three token types cannot substitute for one another |
| `customer-api` | Phone normalisation, a real ReDoS timing test on the escaped search term, pagination bounds, PII redaction |
| `reports-api` | The cashier dashboard payload is built independently, not filtered; date-range and span caps; voids excluded from revenue but counted |
| `route-coverage` | **Parses every route file and fails if any route lacks auth, a permission or validation.** Exemptions must be declared with a reason |

## API — Phase 2

| Method | Route | Auth | Notes |
| --- | --- | --- | --- |
| POST | `/api/auth/login/admin` | — | `{email, password}`. 5 failures/15min per IP |
| POST | `/api/auth/login/staff` | — | `{pin}`. Same limiter |
| POST | `/api/auth/refresh` | refresh cookie | Rotates the token; single-use |
| POST | `/api/auth/logout` | refresh cookie | `{allDevices?}`. Revokes server-side |
| GET | `/api/auth/me` | Bearer | Current user, read from the database |

```bash
# Sign in (admin)
curl -s -c jar.txt -X POST localhost:5000/api/auth/login/admin \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@verdantcafe.local","password":"..."}'
# -> {"success":true,"data":{"accessToken":"eyJ...","user":{...}}}
#    the refresh token is in the cookie jar, NOT in this body

# Use it
curl -s localhost:5000/api/auth/me -H "Authorization: Bearer $TOKEN"

# Rotate
curl -s -b jar.txt -c jar.txt -X POST localhost:5000/api/auth/refresh

# Replay an old refresh token -> 401 and the whole session is revoked
curl -s -b old-jar.txt -X POST localhost:5000/api/auth/refresh
```

## Verify the phase

```bash
# 1. Boots and reports healthy
curl -s localhost:5000/api/health
# -> {"success":true,"data":{"status":"ok","db":"up","uptime":3,...}}

# 2. Security headers present, framework not advertised
curl -sI localhost:5000/api/health
# expect: content-security-policy, x-content-type-options: nosniff,
#         x-frame-options: DENY, referrer-policy: no-referrer, x-request-id
# expect NO: x-powered-by

# 3. Unknown routes return JSON, not an HTML stack trace
curl -s localhost:5000/api/does-not-exist
# -> {"success":false,"error":{"message":"Resource not found"},"requestId":"..."}

# 4. Disallowed origin is rejected (not reflected back)
curl -sI -H "Origin: https://evil.example" localhost:5000/api/health | grep -i access-control-allow-origin
# -> no output; the header must be absent

# 5. Oversized body rejected
curl -s -X POST localhost:5000/api/health -H 'Content-Type: application/json' \
  --data "$(node -e "console.log(JSON.stringify({x:'a'.repeat(200000)}))")"
# -> 413 payload too large (or 404 — the route has no POST; test again after Phase 2)

# 6. Fail-fast env validation
JWT_ACCESS_SECRET= npm start
# -> prints the missing/invalid vars and exits 1, does not start
```

## What Phase 0 established

| File | Role |
| --- | --- |
| `src/config/env.js` | Zod-validated env, fails fast at boot; rejects short/duplicate JWT secrets and localhost CORS in production |
| `src/config/db.js` | Mongoose connect with exponential backoff (5 attempts), `bufferCommands: false` so a dead DB errors instead of hanging, credentials stripped from logged URIs |
| `src/config/cloudinary.js` | Client + `uploadImageBuffer` / `deleteImage` helpers, streams buffers with no temp files (consumed in Phase 5) |
| `src/utils/logger.js` | Winston with a redaction format — password, pin, token, authorization, phone, email never reach log output |
| `src/utils/apiResponse.js` | `ApiError` + `sendSuccess` + `asyncHandler` — one response envelope, and async rejections reach the error handler |
| `src/middleware/requestId.js` | Per-request UUID, echoed as `X-Request-Id`, validated if client-supplied |
| `src/middleware/errorHandler.js` | Normalises Zod / Mongoose / JWT / body-parser errors; generic message + request id to the client, full stack to the logs only |
| `src/routes/health.js` | Public health check, reports DB state, leaks no version or host info |
| `app.js` | helmet with a deny-all CSP, exact-match CORS allow-list, body size caps, compression, morgan through winston |
| `server.js` | Boot sequence, graceful SIGTERM/SIGINT shutdown with a 15s force-exit, slowloris timeouts |

Deliberately deferred: rate limiting and `express-mongo-sanitize` are installed but wired
in Phase 4; `app.js` marks the insertion point. Route mounts for later phases are listed
as comments in `app.js`.

## What Phase 1 established

| File | Role |
| --- | --- |
| `src/constants/enums.js` | Every string union in one place — roles, statuses, order/payment/discount types, expense and audit-action catalogues, plus the table and ticket transition maps |
| `src/utils/money.js` | The minor-unit convention and its helpers, including remainder-conserving `splitMinor` for split-bill |
| `src/models/User.js` | Staff accounts, dual sign-in (admin email+password / staff PIN), bcrypt cost 12, lockout, `tokenVersion` for real logout revocation |
| `src/models/Category.js` | Menu categories, soft delete, case-insensitive unique names among live rows |
| `src/models/MenuItem.js` | Items with Cloudinary refs; `available` (stock toggle) kept separate from `isActive` (soft delete) |
| `src/models/Table.js` | Floor plan with bounded custom seat counts and a `canTransitionTo` state machine |
| `src/models/Order.js` | The money document — price/name snapshots per line, server-derived totals, tamper guard |
| `src/models/Ticket.js` | Kitchen board with append-only `statusHistory` and one-step-forward `advance()` |
| `src/models/Customer.js` | Unique normalised phone, escaped-regex search, no unbounded embedded history |
| `src/models/Expense.js` | P&L input, admin-only data |
| `src/models/AuditLog.js` | Immutable trail, self-redacting `meta`, `record()` that never throws into its caller |
| `src/models/Counter.js` | Atomic daily sequences for order and ticket numbers |
| `src/scripts/seed.js` | Admin from env; `--demo` fixtures mirroring the frontend seed; random staff PINs printed once |

### Three decisions worth knowing about

**Money is stored as integers in minor units.** `priceMinor: 425` means $4.25. Field names
carry the unit, so no call site has to guess. Floats accumulate error across a day of
adding prices and applying percentage discounts, and the symptom is a till that never
reconciles. The frontend currently works in major units (`4.25`) — Phase 5's serialiser
exposes a read-only `price` virtual for that, but all arithmetic stays on `priceMinor`.

**`Table` references its open `Order` rather than carrying its own line items.** The brief
had both; two writable copies of the same cart drift the moment one write succeeds and the
other fails, and then nobody can say which is right.

**`Customer` has no embedded `orderHistory` array.** History is queried from `Order` by
reference and paginated. An unbounded array grows until a regular customer's document hits
MongoDB's 16MB ceiling and can no longer be saved at all.

### One addition beyond the brief

Staff PINs carry **two** hashes: `pinHash` (bcrypt, verifies) and `pinLookup`
(HMAC-SHA256 peppered with `PIN_PEPPER`, indexed, finds). The brief's approach —
bcrypt-compare against every active staff row — is O(n) deliberately-slow hashes per
attempt on an unauthenticated endpoint, which is a free CPU-exhaustion vector. The lookup
hash makes it one indexed query plus one bcrypt verify. It's unsalted by necessity, which
is exactly why it's peppered from the environment: a stolen database dump alone can't
brute-force the 10,000 possible 4-digit PINs without also holding `PIN_PEPPER`.

This adds a required env var. **Changing `PIN_PEPPER` after staff exist invalidates every
stored PIN.**

## What Phase 2 established

| File | Role |
| --- | --- |
| `src/utils/jwt.js` | Token minting/verification, algorithm pinned to HS256, `typ` claim checked, refresh cookie options |
| `src/models/RefreshToken.js` | Hashed token storage, session families, TTL cleanup, family revocation |
| `src/middleware/auth.js` | `requireAuth()` — verifies the token, then reads the user from the database |
| `src/middleware/validate.js` | Zod validation that rejects unknown keys rather than stripping them |
| `src/middleware/rateLimit.js` | Login (5/15min), refresh (30/15min) and the general API limiter Phase 4 mounts |
| `src/validators/auth.js` | Strict schemas for both login shapes |
| `src/controllers/authController.js` | Login, refresh with rotation + reuse detection, logout, me |
| `src/routes/auth.js` | Route wiring |

### The design decisions that matter

**Authorisation reads the database on every request, not the token.** A JWT is
self-contained, so the tempting design is to trust `payload.role` and skip the lookup.
`requireAuth` does the lookup anyway. A token minted 14 minutes ago asserts what was true
14 minutes ago — long enough for a cashier to be demoted or an account disabled after a
till discrepancy, and a stale token would keep working until it expired. The token proves
*identity*; the database decides *authorisation*. Phase 3's RBAC reads `req.user`, so this
guarantee propagates to every permission check. Cost is one indexed `findById` per request.

**Refresh tokens are single-use, with reuse detection.** Every refresh issues a new token
and revokes the old one. If an already-rotated token is presented again, either an attacker
stole it or the legitimate client is replaying after the attacker rotated — and there's no
way to tell which. So the entire session family is revoked and both parties re-authenticate.
That's the intended outcome, not collateral damage. Blast radius is one session: other
terminals signed in as the same user are untouched.

**Logout revokes server-side.** Clearing the cookie alone is theatre — anyone who copied
the token keeps it working for 7 days. `allDevices` additionally bumps `tokenVersion`,
which is what reaches live *access* tokens that the refresh records can't touch.

**Failed logins are indistinguishable.** Unknown account, wrong password, and locked
account all return the same message, and an unknown account still burns a real bcrypt
comparison against a decoy hash — otherwise the ~250ms timing gap tells an attacker which
emails are registered.

### One finding worth knowing about

Writing the brute-force test surfaced a real weakness in the plan's flat lockout. At
5 attempts per 15 minutes, a 4-digit PIN keyspace (10,000 values) falls in **~21 days** of
patient unattended attack — and sooner in expectation, since several staff share that
keyspace. That's not a comfortable margin.

Lockout is now **progressive**: each consecutive lockout doubles the next one, capped at 24
hours and reset by any successful login. A full sweep now takes ~5.5 years; expected time
to a first hit with three staff is ~1.4 years. A staff member who mistypes twice is
unaffected. The schedule is 15min → 30min → 1h → 2h → 4h → … → 24h.

If you want more margin, raising the PIN to 6 digits multiplies all of it by 100 — but
that's a frontend change too (`CONFIG.pinLength` and the keypad), so it's your call.

## What Phase 3 established

| File | Role |
| --- | --- |
| `src/constants/permissions.js` | The permission catalogue and the role → permission map. The only place authorisation is decided |
| `src/middleware/rbac.js` | `requirePermission` / `requireAnyPermission` / `requireAllPermissions` factories, plus `can` / `assertCan` for in-handler branching |

### How to use it in Phases 5–10

```js
import { requireAuth } from '../middleware/auth.js';
import { requirePermission, assertCan } from '../middleware/rbac.js';
import { PERMISSIONS } from '../constants/permissions.js';

// Gating a whole route
router.patch(
  '/items/:id/availability',
  requireAuth(),
  requirePermission(PERMISSIONS.MENU_TOGGLE_STOCK),
  handler,
);

// Branching inside a handler — "how much may you do", not "may you be here"
if (discountPct > CASHIER_MAX_DISCOUNT) {
  assertCan(req, PERMISSIONS.POS_OVERRIDE, 'Discount requires manager approval');
}
```

Two rules that are not optional:

- **`requirePermission` always follows `requireAuth`.** Used alone it would read an
  undefined role and 403 — which looks like working authorisation while actually being a
  wiring bug. It detects that case and returns a 500 instead, so the mistake is loud.
- **Reads are guarded too.** There's no "it's only a GET" exemption. A cashier fetching
  `/api/reports` reads the margins just as effectively as an admin does.

### The permission matrix

| Module | Admin | Cashier | Kitchen Staff |
| --- | --- | --- | --- |
| Dashboard | Full | Limited — today only | — |
| POS Billing | Full + void + override | Create orders, apply discounts | — |
| Menu | Full CRUD | View + stock toggle | View + stock toggle |
| Tables | Full CRUD + seating | Seating only (seat/transfer/merge/split) | — |
| Kitchen | Full | Full | Full |
| Customers | Full CRUD | Full CRUD | — |
| Reports | Full | — | — |
| Users / Audit log | Full | — | — |

Kitchen staff hold exactly four permissions: `kitchen:view`, `kitchen:advance_status`,
`menu:view`, `menu:toggle_stock`.

### Design decisions

**Deny by default, no inheritance.** Each role lists exactly what it holds. There is no
"admin minus X" and no role hierarchy. Allow-lists fail closed — a permission added next
month is invisible to cashier and kitchen staff until someone deliberately grants it,
where a deny-list would hand it to everyone silently.

**`dashboard:view:full` and `dashboard:view:limited` are separate permissions**, not one
permission plus a flag. A cashier must not be able to reach the full payload by any route,
so the difference is structural rather than a conditional someone can get wrong. Phase 10
shapes the response on `dashboardScopeFor(role)`.

**Denials say nothing useful.** Every 403 is a bare "Insufficient permissions" — never the
permission required, never the caller's role. Detailed authorisation errors draw a map of
the system for whoever is probing it. The detail goes to the log and audit trail instead.

**The client is told its permissions, and it changes nothing.** `/auth/me` and both login
responses now include a `permissions` array so the UI can hide a Reports tab that would
403. It's derived from the role server-side, never read back as input. A user who edits
that array in memory makes the tab reappear and then gets a 403 from the route behind it.

## What Phase 4 established

| File | Role |
| --- | --- |
| `src/middleware/sanitize.js` | Strips `$`-prefixed and dotted keys from body/query/params, logging every attempt; plus a query-parameter count cap |
| `app.js` | Mounts `sanitizeRequest` → `limitQueryComplexity` → `apiLimiter` at the `/api` boundary; adds `Permissions-Policy`; `X-Frame-Options` corrected to `DENY` |
| `src/middleware/errorHandler.js` | Now honours an explicit 4xx `status` on a plain `Error` instead of reporting it as a 500 |

### Three layers against NoSQL injection

A JSON body is one decode away from being a MongoDB query. `{"email": {"$ne": null},
"password": {"$ne": null}}` posted at a naive `findOne(req.body)` matches the first user in
the collection — no quotes to escape, just a key starting with `$`.

1. **`sanitizeRequest`** removes those keys from every `/api` request. Broadest reach,
   needs no schema, covers routes someone adds later without thinking about it.
2. **Zod `.strict()`** rejects unknown keys outright, so on a validated route the attempt
   is a loud 400 rather than a silent strip.
3. **Mongoose `sanitizeFilter`** neutralises anything that reaches a query filter anyway.

None is redundant: layer 2 only covers routes that have a schema, layer 3 only covers
filters and not update payloads, layer 1 covers everything and understands nothing.

Keys are **removed**, not replaced. `replaceWith: '_'` would turn `$ne` into `_ne` — an
ordinary-looking field that then fails validation for a baffling reason.

### Two real bugs the live test caught

Both were invisible to source-reading and only showed up once real responses were
inspected:

- **`X-Frame-Options` was `SAMEORIGIN`, not `DENY`.** That's helmet's default. A JSON API
  should never be framed at all. The CSP already said `frame-ancestors 'none'`, but the
  legacy header is what older browsers read. Now set explicitly.
- **A plain `Error` carrying `status: 400` was answered as a 500.** `normalize()` only
  understood `ApiError`, so my own query-complexity guard reported a client mistake as a
  server fault — wrong status to the client, and a false bug report in the logs. The guard
  now throws `ApiError`, and the handler honours 4xx on plain errors as a backstop.

## API — Phase 5 (menu)

All routes require a session. `menu:view` is held by every role; `menu:toggle_stock` by
every role; everything else is admin-only.

| Method | Route | Permission |
| --- | --- | --- |
| GET | `/api/menu/items` | `menu:view` |
| GET | `/api/menu/items/:id` | `menu:view` |
| POST | `/api/menu/items` | `menu:create` |
| PUT | `/api/menu/items/:id` | `menu:edit` |
| DELETE | `/api/menu/items/:id` | `menu:delete` |
| PATCH | `/api/menu/items/:id/availability` | `menu:toggle_stock` |
| GET | `/api/menu/categories` | `menu:view` |
| POST | `/api/menu/categories` | `menu:create` |
| PUT | `/api/menu/categories/:id` | `menu:edit` |
| DELETE | `/api/menu/categories/:id` | `menu:delete` |

Create and update take `multipart/form-data` with an optional `image` field. Everything
else is JSON.

```bash
# Create, with an image
curl -X POST localhost:5001/api/menu/items \
  -H "Authorization: Bearer $TOKEN" \
  -F 'name=Cold Brew' -F 'price=4.25' -F "category=$CATEGORY_ID" \
  -F 'image=@coldbrew.jpg'

# Mark sold out — the one menu write a cashier or kitchen staffer can make
curl -X PATCH localhost:5001/api/menu/items/$ID/availability \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"available": false}'
```

### What Phase 5 established

| File | Role |
| --- | --- |
| `src/middleware/upload.js` | multer in memory, size/field caps, MIME allow-list **and** magic-byte verification |
| `src/validators/menu.js` | Strict schemas; `price` accepted in major units, converted to `priceMinor` at the edge |
| `src/controllers/menuController.js` | Item CRUD, Cloudinary lifecycle, soft delete, stock toggle, price-change auditing |
| `src/controllers/categoryController.js` | Category CRUD, guarded delete, single-aggregation item counts |
| `src/routes/menu.js` | Route wiring — one permission per endpoint, reads included |

### Design decisions

**The Content-Type header is not trusted.** Renaming `shell.php` to `shell.jpg` and
declaring `image/jpeg` costs an attacker nothing, so the MIME check is only a cheap first
pass. The real check reads the first bytes and confirms a JPEG/PNG/WebP signature. The test
suite feeds it a PHP shell, an ELF binary, HTML, SVG, a ZIP and a PDF — all declared as
JPEG, all rejected. (SVG is refused deliberately: it is scriptable, so it is not an image
format this API accepts.) One documented limitation: a real JPEG header glued in front of a
payload still reads as a JPEG. Signature checking is not content scanning.

**Uploads never touch disk.** multer's default writes to a temp directory — untrusted bytes
on the filesystem, a cleanup obligation on every error path, and a route to execution if
that directory is ever served. `memoryStorage` plus the size cap avoids all of it.

**Cloudinary cleanup has three sites, and the third is the one that gets forgotten:**
replacing an image, deleting an item, and *a failed save after a successful upload*. The
last leaves an asset that no document references, so nothing can ever find it again. It's
handled explicitly, and the old asset is deleted only **after** the new document saves —
the reverse order destroys the existing image on a save that then fails.

**`price` in, `priceMinor` out.** Requests carry major units because that's what a person
types; the schema converts once, at the boundary, and renames the key. Keeping the name
`price` on a value that is now `425` rather than `4.25` is exactly the ambiguity the naming
convention exists to prevent.

**Deleting a category with items in it is refused, not cascaded.** Cascading would remove
products from the POS mid-service on one click. A 409 naming the count lets the admin move
the items first.

### A bug the tests caught

`removeImage` used `.optional().transform(v => v === true || v === 'true')`. The transform
runs on `undefined` too, turning "absent" into `false` — so the key was always present, and
the schema's "at least one field to update" check could never fail. An empty `PUT` was
accepted as a valid no-op. The transform now preserves `undefined`.

## API — Phase 6 (tables)

The split is **configuring** the floor plan (admin) versus **operating** it (cashier).
Kitchen staff hold neither permission, so every route here 403s for them.

| Method | Route | Permission |
| --- | --- | --- |
| GET | `/api/tables` | `table:view` |
| GET | `/api/tables/zones` | `table:view` |
| GET | `/api/tables/:id` | `table:view` |
| POST | `/api/tables` | `table:create` |
| PUT | `/api/tables/:id` | `table:edit` |
| DELETE | `/api/tables/:id` | `table:delete` |
| PATCH | `/api/tables/:id/seat` | `table:manage_seating` |
| PATCH | `/api/tables/:id/reserve` | `table:manage_seating` |
| PATCH | `/api/tables/:id/release` | `table:manage_seating` |
| POST | `/api/tables/:id/transfer` | `table:manage_seating` |
| POST | `/api/tables/:id/merge` | `table:manage_seating` |
| POST | `/api/tables/:id/unmerge` | `table:manage_seating` |
| POST | `/api/tables/:id/split` | `table:manage_seating` |

```bash
# Admin creates a 6-top in the garden
curl -X POST localhost:5001/api/tables -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"name":"G1","seats":6,"zone":"Garden"}'

# Cashier seats a party
curl -X PATCH localhost:5001/api/tables/$ID/seat -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{}'

# Split-bill preview — computes, persists nothing
curl -X POST localhost:5001/api/tables/$ID/split -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"ways":3}'
```

### The decision that matters: every transition is a compare-and-swap

The obvious way to write "seat table T3" is load it, check `status === 'available'`, set
it to occupied, save. That's a read-then-write race, and a POS is exactly where it loses:
two terminals, two cashiers, one walk-in. Both read `available`, both save `occupied`, and
the second silently overwrites the first. The party at T3 ends up on someone else's bill.

Every mutating handler therefore puts the precondition in the *filter*:

```js
Table.findOneAndUpdate(
  { _id, status: { $in: ['available', 'reserved'] } },   // precondition
  { $set: { status: 'occupied', occupiedAt: new Date() } },
);
```

MongoDB applies that atomically. Whoever loses gets `null` back, which becomes a 409
saying the table was just taken — true, and arriving before any damage is done. Transfer
uses the same pattern to claim the *destination* before releasing the source; the reverse
order can strand an order attached to no table if the second write fails.

### Other decisions

**Split-bill persists nothing.** It returns the proposed shares for the cashier to read
off the screen while the party decides; nothing is committed until settlement in Phase 7.
The arithmetic uses `splitMinor`, which distributes the remainder one minor unit at a time
— `$10` three ways is `[3.34, 3.33, 3.33]`, not three of `3.33`. The response includes a
`checksumMinor` so the caller can see nothing was lost or invented.

**Merge refuses when both tables hold bills.** Combining two orders means merging line
items and recomputing totals — order logic, which belongs with the order endpoints. If
only one table has a bill it moves to the target. Chains are refused too: merging A into B
when B is already merged into C would leave the bill somewhere neither terminal is looking.

**Reconfiguring an occupied table is refused.** Renaming T3 mid-service would rename it on
kitchen tickets already on the board, and changing the seat count under a seated party
describes a room that no longer matches.

**Party size is advisory.** It's recorded, not enforced against the seat count. Refusing to
seat five at a four-top would be the software overruling the person standing in the room,
who can see that they pulled up a chair.

### Not yet wired

`/split` and the order-moving half of `/transfer` and `/merge` read `table.currentOrder`,
which nothing populates until Phase 7 creates orders. They return a 409 ("no open bill")
until then — correct behaviour, but untested against real data.

## API — Phase 7 (POS billing)

| Method | Route | Permission |
| --- | --- | --- |
| GET | `/api/orders` | `pos:create_order` — cashiers see today only |
| POST | `/api/orders` | `pos:create_order` |
| GET | `/api/orders/:id` | `pos:create_order` |
| PATCH | `/api/orders/:id/items` | `pos:create_order` |
| PATCH | `/api/orders/:id/discount` | `pos:apply_discount` (+ ceiling) |
| POST | `/api/orders/:id/pay` | `pos:create_order` |
| POST | `/api/orders/:id/void` | `pos:create_order` (paid bills need more — see below) |

```bash
# Place a dine-in order. Note what is NOT in this body: any price at all.
curl -X POST localhost:5001/api/orders -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{
    "type": "dine-in",
    "tableId": "'"$TABLE"'",
    "items": [{"menuItemId": "'"$ITEM"'", "qty": 2, "note": "no ice"}]
  }'

# Discount above the ceiling — needs a manager's PIN at the terminal
curl -X PATCH localhost:5001/api/orders/$ID/discount -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"type":"percent","value":50,"adminOverridePin":"4417"}'

# Settle
curl -X POST localhost:5001/api/orders/$ID/pay -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"paymentMethod":"card"}'
```

### The client has no vocabulary for money

There is no `price` field in any order schema. No `subtotal`, no `total`, no `priceMinor`.
A client physically cannot express a price to this API — the schema rejects the key, the
controller reads prices from the database, and `Order.recalculate()` derives every total
from the lines. The model's pre-validate hook then refuses to save a document whose totals
don't follow. Four layers, and the first is "the word doesn't exist".

The tests confirm this by inspection as well as rejection: a parsed order line contains
exactly `menuItemId`, `qty`, `note`.

### Discounts are where money actually leaks

Not through forged prices — through comps. A cashier who can zero any bill can hand out
free meals indefinitely and it reconciles perfectly, because the till agrees with the
(discounted) orders. So there's a ceiling, checked on **both** limbs:

| Limit | Value | Why both are needed |
| --- | --- | --- |
| `CASHIER_MAX_DISCOUNT_PERCENT` | 20% | Blocks the obvious comp |
| `CASHIER_MAX_DISCOUNT_MINOR` | $20.00 | 15% of a $400 party bill passes the percentage check but is $60 of real money |

Above either, the request needs `pos:override` (admin) or a manager's override PIN, and
`approvedBy` records who authorised it.

### Voids are graded by what's at stake

- **Open tab** — any cashier. Nothing was taken; it's abandoning a bill.
- **Paid, within 30 minutes** — cashier + manager override PIN. This is a mistake being
  fixed while the customer is still there.
- **Paid, after 30 minutes** — admin only. The customer has gone; this is a different act.

A reason is mandatory in all cases. A void with no explanation is indistinguishable in the
audit log from theft.

### The manager override PIN

Cashiers can't void paid bills, but a manager standing at the terminal shouldn't have to
type an email and password mid-service. So admins may hold an **override PIN** — a
separate credential from the staff login PIN, and deliberately so:

- It's stored in `overridePinHash` / `overridePinLookup`, not `pinHash`.
- `findActiveByPin` (the login path) restricts itself to `PIN_ROLES`, which excludes admin.
  **Possessing an override PIN cannot start a session.**
- It's domain-separated (`override:` prefix) so the same four digits used for both purposes
  don't produce the same hash.

A single shared field would have quietly turned every override PIN into a login credential.
Set it via `SEED_ADMIN_OVERRIDE_PIN`; rotating it needs the Phase 11 user-management
endpoints, which don't exist yet — that's a real gap.

### Atomicity, and the standalone-MongoDB caveat

Placing an order writes three documents — Order, Ticket, Table link — in one transaction.
Any partial success is a broken restaurant: an order with no ticket means the customer is
charged and the kitchen never cooks; a ticket with no order means food goes out unbilled.

**MongoDB transactions require a replica set.** Atlas provides one on every tier including
free, so production is fine. A bare local `mongod` is a standalone and does *not* support
them. `src/utils/transaction.js` detects the topology, logs a loud warning, and continues
without a session rather than crashing every write in development. If you see that warning
in a real deployment, the atomicity guarantee is absent and order writes can half-commit.

## API — Phase 8 (kitchen)

| Method | Route | Permission |
| --- | --- | --- |
| GET | `/api/kitchen/board` | `kitchen:view` |
| GET | `/api/kitchen/tickets` | `kitchen:view` |
| GET | `/api/kitchen/tickets/:id` | `kitchen:view` |
| PATCH | `/api/kitchen/tickets/:id/advance` | `kitchen:advance_status` |
| PATCH | `/api/kitchen/tickets/:id/recall` | `kitchen:recall` (admin) |
| POST | `/api/kitchen/stream-token` | `kitchen:view` |
| GET | `/api/kitchen/stream?token=…` | verified in-handler |

```bash
# The board, pre-grouped into its four columns
curl -s localhost:5001/api/kitchen/board -H "Authorization: Bearer $TOKEN"

# Advance one step. Note the EMPTY body — the destination is not the caller's to choose.
curl -X PATCH localhost:5001/api/kitchen/tickets/$ID/advance \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{}'
```

### The advance endpoint takes no body

Not a target status, not a "from" status — nothing. The destination is derived server-side
from what's stored, via `NEXT_TICKET_STATUS`.

If a client could name a target it could send `{status: 'served'}` on a pending ticket and
mark food served that was never cooked. The board clears, the order leaves the line, and
nobody notices until a customer asks where their meal is. Removing the field removes the
possibility. The schema is `.strict()`, so an attempt shows up as a 400 in the logs rather
than being silently ignored.

A double-tap is safe too: the update filters on the status just read, so the second tap
matches nothing and gets a 409 instead of jumping the ticket two stages.

### Recall — new, admin-only

A kitchen is a place where people tap the wrong card with wet hands, and a board that can't
be corrected is one staff stop trusting. So tickets can move backwards — but as a separate
`kitchen:recall` permission held only by admin, because reversing rewrites what the line
believes about an order that may already be plated.

`statusHistory` stays **append-only** either way: the mis-tap and the correction both
remain visible, flagged with `recalled: true`, so prep-time reporting sees what actually
happened rather than a tidied version. A stale `readyAt` is cleared, since leaving it would
report a prep time that never occurred.

This adds one permission to the catalogue (25 → 26), mirrored in the frontend and the RBAC
matrix spec. Kitchen staff still hold exactly four.

### Live updates: SSE, not WebSockets

The board only ever needs server → client messages. Advancing a ticket is a normal
authenticated `PATCH`; nothing flows back over the socket. That's exactly what Server-Sent
Events are for, and SSE needs no dependency and reconnects on its own. WebSockets would be
a heavier transport for a one-way problem.

**The authentication wrinkle:** the browser's `EventSource` cannot set an `Authorization`
header. The options were to put the access token in the query string — where it lands in
proxy logs and browser history, valid for 15 minutes against every endpoint — or to mint
something narrower. So `POST /stream-token` returns a **60-second token valid only for
opening a stream**. If it leaks into a log it's already expired, and even fresh it cannot
read an order or move a ticket. The tests confirm all three token types reject one
another's tokens.

The stream handler re-loads the user and re-checks `kitchen:view` itself rather than
trusting the token's claims — the same rule the rest of the API follows.

**Two limitations worth knowing:**

- The event bus lives in **one Node process**. Two instances behind a load balancer would
  each only notify their own clients. Fine for one restaurant on one server; the fix if
  that changes is Redis pub/sub behind the same `emitEvent` call.
- Treat the stream as an optimisation. If it drops, the board reloads from `GET /board` —
  nothing is only reachable through it.

### The kitchen sees no prices

`populate` selects exactly `nameSnapshot`, `qty` and `note` from the order. What a dish
costs is not the line's business, and a kitchen display in a room customers can see
shouldn't be showing bill totals.

## API — Phase 10 (dashboard and reports)

| Method | Route | Permission |
| --- | --- | --- |
| GET | `/api/dashboard` | either dashboard grant — payload shaped by role |
| GET | `/api/reports/daily` | `reports:view` (admin) |
| GET | `/api/reports/monthly` | `reports:view` |
| GET | `/api/reports/pnl` | `reports:view` |
| GET | `/api/reports/expenses` | `reports:view` |
| POST | `/api/reports/expenses` | `reports:view` |
| DELETE | `/api/reports/expenses/:id` | `reports:view` |

### The dashboard split — the original question, finally answered in code

You asked at the very start what a cashier should be restricted from on the dashboard. The
answer implemented here: **today only, no commercial position.**

| Field | Cashier | Admin |
| --- | --- | --- |
| Today's sales / orders / pending / completed | ✅ | ✅ |
| Recent orders table | ✅ | ✅ |
| Month-to-date sales, prior month, % change | — | ✅ |
| Expenses, net, margin % | — | ✅ |
| Best-selling items | — | ✅ |

Three things make that hold, and the third is the one worth arguing about:

1. **Two separate permissions**, `dashboard:view:full` and `dashboard:view:limited` — not
   one permission plus a flag. A flag is a conditional somebody eventually gets backwards.
2. **The endpoint accepts no query parameters at all.** `.strict()` on an empty object
   means `?range=month` is a 400. "Today" isn't a default that can be overridden.
3. **The limited payload is built from scratch, not filtered.** This is the important one.
   Deleting fields from a rich object is how a metric added next year silently reaches a
   cashier — whoever adds it must remember a redaction list, and eventually nobody does.
   Here a new admin figure is invisible to cashiers *unless someone deliberately writes it
   into the limited branch too*. The test asserts the limited branch has exactly seven
   fields and returns before any admin query runs.

### Reports

Every route is `reports:view`, gated once router-wide. A cashier guessing the URL gets a
403 — the hidden nav tab is a convenience, not the control.

**Revenue excludes voided orders, but the void count is reported alongside.** A voided
order isn't revenue. But a day with fourteen voids deserves an owner's attention even when
the takings look normal — that pattern is what till-skimming looks like from outside.

**Aggregation runs in MongoDB.** Fetching a month of orders to reduce them in JavaScript
works fine on seed data and falls over in year two. Every figure comes from a pipeline.

**Ranges are capped at 366 days**, and an omitted range defaults to 30 days rather than all
time. An unvalidated range is the cheapest way to turn an indexed scan into a collection
scan.

**Charts have no gaps.** All 24 hours, every day of the month, every expense category —
present even at zero, because an absent row reads as missing data rather than as "nothing
happened".

**Percentages are null, not zero, when there's no basis.** "No change" and "no prior month
to compare against" are different facts, and a 0 would be read as the first.

## Notes

- `trust proxy` is set to `1`. If you deploy behind more than one proxy hop, raise it —
  otherwise Phase 4's per-IP rate limiting sees only the proxy's address and is useless.
- **`bcrypt` is a native module, and its binary is not portable.** `npm install` compiles
  it for the host platform, so a `node_modules` built on macOS fails to load on Linux with
  `invalid ELF header` — and vice versa. This already bites: it blocks running the test
  suite in a Linux container, and it will bite again on any Docker build, CI runner, or
  Linux teammate unless `npm install` runs on that machine. `tests/helpers/bcrypt-stub.mjs`
  works around it for the HTTP tests only.
  **Switching to `bcryptjs` removes the problem entirely** — pure JS, same `hash`/`compare`
  API, roughly 30% slower per hash, which is irrelevant at a few logins per shift. The only
  code change is the import in `src/models/User.js` and `src/controllers/authController.js`.
  Existing hashes stay valid; the formats are compatible.
- The API does not terminate TLS. In production put it behind a proxy or host that
  enforces HTTPS/TLS 1.3; the HSTS header is only sent when `NODE_ENV=production`.
- Use a least-privilege MongoDB user in production, not a cluster admin account.
- Unique constraints on `Category.name`, `MenuItem.name`, `Table.name` and the one-open-
  order-per-table rule are **partial** indexes scoped to live rows, so a soft-deleted
  record frees its name for reuse.
- `autoIndex` is off in production (`src/config/db.js`). Build indexes explicitly before
  the first production deploy, or MongoDB will fall back to collection scans.
- The four `_*.mjs` files at the project root are superseded scratch stubs — the real
  suite lives in `tests/`. They're inert one-line comments; delete them at your leisure.
- The refresh cookie is `sameSite: 'strict'` and scoped to `/api/auth`. If the frontend is
  ever served from a different site than the API, that has to become `'none'` + `secure`,
  and CSRF protection stops being free — worth keeping them same-site.
- `POST /api/auth/logout` is intentionally unauthenticated: an expired access token must
  not prevent a client from ending its session cleanly.
- Rate limiters are in-memory. Behind more than one server instance they'd need a shared
  store (Redis) or each instance enforces its own separate budget.
