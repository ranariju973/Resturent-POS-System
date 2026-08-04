# Verdant Café POS — Backend Build Plan

A phase-by-phase prompt kit for building the backend in a new `Backend/` folder next to
`Resturent-POS-System-Frontend/`. Each phase below is a copy-paste prompt for Claude
(Opus 5 for architecture/security-critical phases, Sonnet 5 or Fable 5 for repetitive CRUD
phases). Run one phase at a time, review the diff, run the app, then move to the next —
don't chain all 12 into one mega-prompt, since RBAC and validation bugs compound if you
can't verify each layer before the next is built on top of it.

Stack locked in for all phases: Node.js + Express, MongoDB + Mongoose, Cloudinary for
image storage, JWT for auth, bcrypt/argon2 for hashing.

---

## 1. Role-Based Access Control — the actual matrix

This fills in every "if you suggest anything" from your brief. Reference this table in
every phase prompt below (or attach this whole file) so the model implements permissions
consistently instead of improvising per-endpoint.

| Module | Admin | Cashier | Kitchen Staff |
|---|---|---|---|
| **Dashboard** | Full — all KPIs, revenue trends, comparisons | Limited — see below | No access |
| **POS Billing** | Full, incl. void/refund, unlimited discount | Full create/charge/print/send. Void or refund of an *already-paid* order and discounts above a threshold require Admin re-auth (recommended) | No access |
| **Menu Management** | Full CRUD — items, categories, prices, images | View only + toggle available/sold-out (stock in/out) | View only + toggle available/sold-out (stock in/out) |
| **Table Management** | Full CRUD — add/edit/delete tables, custom seat count, zone | View floor plan, select/seat tables, transfer/merge/split-bill, mark vacated. No add/edit/delete tables, no seat/zone config | No access |
| **Kitchen Management** | Full | Full — view tickets, advance pending→preparing→ready→served | Full — view tickets, advance status |
| **Customers** | Full CRUD | Full CRUD | No access |
| **Reports** | Full | No access | No access |

**Dashboard restriction detail (your open question):** a cashier doesn't need — and
shouldn't see — profit margins, expense totals, or period-over-period revenue trends;
that's commercially sensitive and belongs to Reports. What a cashier *does* need for their
shift is exactly the four cards already built in `Dashboard.tsx`:

- Today's Sales (today only, not compared to last month)
- Today's Orders (count)
- Pending Orders (kitchen queue depth)
- Completed Orders
- Recent Orders table

So: same dashboard UI, but the API response for a Cashier-role token omits any field
outside "today," and the endpoint should 403 on any `?range=month` / comparison query
param regardless of what the client sends — never trust the client to just not ask.

**Menu restriction detail:** cashiers and kitchen staff hit the same restricted endpoint —
`PATCH /menu/items/:id/availability` (body: `{ available: boolean }`) — nothing else on
the menu router. Price, name, category, image, description, delete all require Admin.

**Table restriction detail:** cashiers can call seating/transfer/merge/split-bill actions
(these mutate `order`/`status`/`merge` on an existing table document) but never
`POST /tables`, `PUT /tables/:id` (seats/zone/name), or `DELETE /tables/:id`.

**POS void/discount note:** this wasn't in your original list, but it's a standard POS
fraud control worth adding — cashiers processing their own voids/refunds with no second
factor is one of the most common ways restaurant staff skim cash. Cheap to build now
(an `adminOverride` PIN field on the void/refund/high-discount endpoints), painful to
retrofit later. Flagged as recommended, not required — drop it if you'd rather keep
cashier POS access unrestricted.

### Permission strings to use in code

```
dashboard:view:full        dashboard:view:limited
pos:create_order  pos:apply_discount  pos:void_order  pos:override
menu:view  menu:create  menu:edit  menu:delete  menu:toggle_stock
table:view  table:create  table:edit  table:delete  table:manage_seating
kitchen:view  kitchen:advance_status
customer:view  customer:create  customer:edit  customer:delete
reports:view
```

```js
// role -> permissions map (single source of truth, used by RBAC middleware)
const ROLE_PERMISSIONS = {
  admin: ['*'], // every permission
  cashier: [
    'dashboard:view:limited',
    'pos:create_order', 'pos:apply_discount',
    'menu:view', 'menu:toggle_stock',
    'table:view', 'table:manage_seating',
    'kitchen:view', 'kitchen:advance_status',
    'customer:view', 'customer:create', 'customer:edit', 'customer:delete',
  ],
  kitchen_staff: [
    'kitchen:view', 'kitchen:advance_status',
    'menu:view', 'menu:toggle_stock',
  ],
};
```

---

## 2. Folder structure to target

```
Backend/
  src/
    config/        db.js, cloudinary.js, env.js
    models/        User.js, MenuItem.js, Category.js, Table.js, Order.js,
                    Ticket.js, Customer.js, Expense.js, AuditLog.js
    middleware/     auth.js, rbac.js, validate.js, rateLimit.js, errorHandler.js, sanitize.js
    controllers/
    routes/
    validators/     zod/joi schemas per resource
    utils/          jwt.js, logger.js, apiResponse.js
    sockets/        (Phase 8, optional — live kitchen ticket push)
  app.js
  server.js
  .env.example
  package.json
```

Auth model: mirrors the login screen you already built — Admin signs in with
email + password; Cashier/Kitchen Staff sign in with a numeric PIN tied to their staff
record. Both issue the same JWT shape (`{ sub, role, staffId }`), so downstream RBAC
middleware doesn't care which path was used.

---

## 3. The phases

Each phase is a self-contained prompt. Paste the whole block into a fresh Claude session
(or continue the same one) with the `Backend/` folder open. Attach this file, or at least
the RBAC table, to Phase 3 onward, since permission logic touches almost every route.

### Phase 0 — Project scaffold & environment (Opus 5)

```
Set up a new Node.js + Express backend in the Backend/ folder of this repo, sibling to
Resturent-POS-System-Frontend/. Use ES modules. Install and configure: express, mongoose,
dotenv, cors, helmet, express-rate-limit, express-mongo-sanitize, jsonwebtoken, bcrypt,
multer, cloudinary, zod, winston (or pino), cookie-parser, compression, morgan (dev only).

Deliverables:
- package.json with scripts: dev (nodemon), start, lint
- .env.example listing every required var (MONGO_URI, JWT_ACCESS_SECRET,
  JWT_REFRESH_SECRET, CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET, PORT, CORS_ORIGIN,
  NODE_ENV) — no real secrets, .env itself must be gitignored
- src/config/env.js that validates all required env vars are present at boot and
  crashes with a clear error if any are missing (fail fast, don't silently run insecure)
- src/config/db.js — Mongoose connection with retry/backoff and connection event logging
- app.js — Express app wiring (helmet, cors with an explicit allow-list from
  CORS_ORIGIN, json body parser with a size limit, compression, request logging)
- server.js — starts the HTTP server, handles SIGTERM/SIGINT graceful shutdown
- A health check route GET /api/health

Do not implement any business routes yet. Confirm the server boots against a local or
Atlas MongoDB URI before moving on.
```

### Phase 1 — Data models (Opus 5)

```
In Backend/src/models, create Mongoose schemas for this restaurant POS. Match these
frontend shapes (from src/data/types.ts in the frontend) so the API contract lines up:

- User (staff): name, role (enum: admin | cashier | kitchen_staff), email (admin only,
  unique+sparse), passwordHash (admin only), pin (cashier/kitchen only — store as a
  bcrypt hash, never plaintext), avatarUrl, isActive, createdAt
- Category: name (unique), color
- MenuItem: name, price, category (ref), imageUrl, imagePublicId (cloudinary), desc,
  available (bool)
- Table: name, seats, zone, status (available|occupied|reserved), order (array of
  {menuItem: ref, qty}), startedAt, mergedWith (ref to Table, nullable)
- Order (POS billing transaction — new concept not in the frontend mock, needed for a
  real backend): table (ref, nullable for takeaway/delivery), type (dine-in|takeaway|
  delivery), items [{menuItem: ref, qty, priceAtSale}], subtotal, discount, tax, total,
  status (open|paid|voided), paymentMethod, customer (ref, nullable), createdBy (ref
  User), voidedBy (ref User, nullable), createdAt
- Ticket (kitchen view of an Order): order (ref), no (sequential display number),
  source, status (pending|preparing|ready|served), placedAt, statusHistory
  [{status, at, by}]
- Customer: name, phone (unique), email, notes, lastVisit, orderHistory (ref array to
  Order, or embed a lightweight summary)
- Expense: date, category (Ingredients|Utilities|Salary|Rent|Other), desc, amount,
  createdBy
- AuditLog: actor (ref User), action, resource, resourceId, meta, ip, at — used for
  Phase 11 logging, create the schema now so later phases can write to it

Add indexes for fields queried often (Table.status, Order.status+createdAt, Ticket.status,
Customer.phone). Store all monetary values as numbers in the smallest currency unit or
with a fixed decimal convention — pick one and note it in a comment, don't mix.

No routes/controllers yet — schemas and model exports only, plus a seed script
(src/scripts/seed.js) that creates one admin user from env vars (never hardcode a
default admin password in source).
```

### Phase 2 — Authentication (Opus 5 — security-critical, review carefully)

```
Implement authentication in Backend/. Two login paths feeding the same token shape:

1. POST /api/auth/login/admin — { email, password } -> bcrypt.compare against
   User.passwordHash
2. POST /api/auth/login/staff — { pin } -> bcrypt.compare against each active
   cashier/kitchen_staff User.pin (PINs are short, so also rate-limit this route hard
   and lock an account for N minutes after 5 failed attempts — brute force on a 4-digit
   PIN is trivial otherwise)

On success, issue:
- a short-lived access JWT (15 min), payload { sub: userId, role }, returned in the
  response body
- a long-lived refresh token (7d), stored as an httpOnly, Secure, SameSite=Strict cookie
  — never returned in the JSON body

Endpoints:
- POST /api/auth/refresh — reads the refresh cookie, rotates it, issues a new access
  token
- POST /api/auth/logout — clears the refresh cookie, invalidates the refresh token
  server-side (store a hash of active refresh tokens or a token-version field on User
  so logout actually revokes, not just deletes the client's cookie)
- GET /api/auth/me — returns the current user's public profile from a valid access
  token

Password/PIN rules: bcrypt with cost factor >=12. Never log raw passwords/PINs, even
in debug mode. Never return passwordHash or pin in any API response — add a toJSON
transform on the User schema that strips them by default.

Middleware: src/middleware/auth.js — requireAuth() verifies the access token from the
Authorization: Bearer header, attaches req.user = { id, role }, 401s on missing/invalid/
expired token with a generic message (don't reveal whether the user exists or the
token expired vs. was tampered with).
```

### Phase 3 — RBAC middleware (Opus 5 — security-critical)

```
Implement role-based access control in Backend/src/middleware/rbac.js using the
permission map below (also see the RBAC table — attach BACKEND-BUILD-PLAN.md if
available).

[paste the ROLE_PERMISSIONS object and permission-string list from section 1 above]

Build requirePermission(permission) as an Express middleware factory:
router.patch('/menu/items/:id/availability', requireAuth(), requirePermission('menu:toggle_stock'), handler)

It must:
- 403 with a generic "insufficient permissions" message (don't leak the required
  permission name or role hierarchy to the client)
- check req.user.role against the map — admin short-circuits to allow everything
- be enforced on EVERY route that touches data, with no exceptions "because it's just
  a GET" — read access needs checking too (e.g. cashiers must never GET /reports)
- for the dashboard specifically, don't just gate the route — shape the response
  server-side: a cashier's token hitting GET /api/dashboard should get back only
  {todaySales, todayOrders, pendingOrders, completedOrders, recentOrders}, with any
  range/comparison query params silently ignored, not honored

Also add a small integration test (or a documented curl/Postman set) proving: admin
can hit every route, cashier is blocked from /reports and from menu/table mutations
beyond toggle-stock, kitchen_staff is blocked from everything except kitchen + menu
view/toggle. Do this test before moving to Phase 4 — it's the contract every later
phase depends on.
```

### Phase 4 — Global security middleware (Opus 5)

```
Harden Backend/app.js with defense-in-depth middleware, applied globally before routes:

- helmet() with an explicit CSP (no wildcard sources), and remove X-Powered-By
- CORS restricted to CORS_ORIGIN from env, credentials: true (needed for the refresh
  cookie), explicit allowed methods/headers — no reflecting arbitrary origins
- express-rate-limit: a general limiter (e.g. 100 req/min per IP) on all /api routes,
  and a much stricter limiter (e.g. 5 req/15min per IP) specifically on
  /api/auth/login/* to blunt credential/PIN stuffing
- express-mongo-sanitize (or equivalent) to strip $ and . operators from
  req.body/query/params before they reach Mongoose — prevents NoSQL injection via
  query operator injection
- body size limit on express.json() (e.g. 1mb; separate, larger limit only on the
  Cloudinary upload route)
- src/middleware/errorHandler.js as the final error-handling middleware: in
  production, respond with a generic { error: message } and a request id, never a
  stack trace; log the full stack + stack trace server-side only. In development,
  it's fine to include more detail.
- src/utils/logger.js (winston/pino) — structured logs, redact any field named
  password/pin/token/authorization before writing

Confirm 404s on unknown routes return a generic JSON body, not an HTML stack trace
page (Express's default).
```

### Phase 5 — Menu Management API + Cloudinary (Sonnet 5 / Fable 5)

```
Build Backend/src/routes/menu.js and categories.js on top of the auth+RBAC middleware
from Phases 2-3.

Routes:
- GET /api/menu/items — menu:view (all roles)
- GET /api/menu/categories — menu:view
- POST /api/menu/items — menu:create (admin only) — multipart/form-data with an
  optional image file
- PUT /api/menu/items/:id — menu:edit (admin only)
- DELETE /api/menu/items/:id — menu:delete (admin only)
- PATCH /api/menu/items/:id/availability — menu:toggle_stock (admin, cashier,
  kitchen_staff) — body validated to accept ONLY { available: boolean }, reject any
  other field in the body even if the sender has more permissions, to keep this
  endpoint's blast radius fixed
- POST/PUT/DELETE for categories — admin only

Image upload: use multer memoryStorage with a strict fileFilter (image/jpeg, image/png,
image/webp only) and a size limit (e.g. 5MB), then stream the buffer to Cloudinary
(no temp files written to disk). Store the returned secure_url and public_id on the
MenuItem. On item delete or image replace, also delete the old Cloudinary asset
(cloudinary.uploader.destroy) so orphaned images don't accumulate.

Validate every body with a zod schema (src/validators/menu.js) before it touches
Mongoose — reject unknown fields, enforce price > 0, name length limits, etc. Return
Mongoose validation errors as a clean 400 with field-level messages, not a raw
Mongoose error object.
```

### Phase 6 — Table Management API (Sonnet 5 / Fable 5)

```
Build Backend/src/routes/tables.js.

- GET /api/tables — table:view (admin, cashier)
- POST /api/tables — table:create (admin only) — { name, seats, zone }, seats must be
  a positive integer with a sane upper bound (validate, don't trust client)
- PUT /api/tables/:id — table:edit (admin only) — name/seats/zone
- DELETE /api/tables/:id — table:delete (admin only) — block deletion if the table has
  an open order, return 409 with a clear message instead
- PATCH /api/tables/:id/seat — table:manage_seating (admin, cashier) — starts service,
  sets status=occupied, startedAt=now
- PATCH /api/tables/:id/order — table:manage_seating — add/update items on the table's
  open order
- POST /api/tables/:id/transfer — table:manage_seating — move an open order to
  another table (must be status=available on the target, else 409)
- POST /api/tables/:id/merge — table:manage_seating
- POST /api/tables/:id/split — table:manage_seating — split-bill, returns the proposed
  split, doesn't have to persist a new document unless you want split history

All mutating routes: re-verify current table status server-side before applying the
transition (e.g. can't "seat" a table that's already occupied) — this is standard
state-machine validation, not just RBAC.
```

### Phase 7 — POS Billing / Orders API (Opus 5 — has the money logic)

```
Build Backend/src/routes/orders.js — this is the highest-value target for tampering
(prices, totals, discounts) so validate aggressively and trust nothing from the client
except item IDs and quantities.

- POST /api/orders — pos:create_order (admin, cashier) — body: { tableId?, type,
  items: [{menuItemId, qty}], customerId?, discount? }. Server MUST look up each
  menuItem's current price from the database and compute subtotal/tax/total itself —
  never accept a client-supplied price or total. Snapshot priceAtSale on each line so
  historical orders aren't affected by later price changes.
- GET /api/orders — pos:create_order permission implies view; admin sees all, cashier
  sees today's + their own
- GET /api/orders/:id
- PATCH /api/orders/:id/discount — pos:apply_discount — validate discount is a
  percentage or fixed amount within a configured max; if it exceeds the configured
  cashier ceiling, require pos:override (i.e. reject for cashier role, allow admin)
- POST /api/orders/:id/pay — mark status=paid, record paymentMethod
- POST /api/orders/:id/void — pos:void_order — admin only, OR cashier + a valid
  adminOverride PIN passed in the body and re-verified server-side against an active
  admin's PIN before the void is allowed (implements the fraud-control note from the
  RBAC section — skip this override branch entirely if you decided not to build it)

On order creation, also create the corresponding Ticket document (status=pending) so
Phase 8's kitchen board picks it up automatically — don't make the frontend create
both separately.

Wrap the create-order + create-ticket + decrement-table-availability sequence in a
Mongoose transaction (session) so a failure partway through can't leave a paid order
with no kitchen ticket, or vice versa.
```

### Phase 8 — Kitchen Management API (Sonnet 5 / Fable 5)

```
Build Backend/src/routes/kitchen.js.

- GET /api/kitchen/tickets — kitchen:view (admin, cashier, kitchen_staff) — filter by
  status via query param, default to all non-served
- PATCH /api/kitchen/tickets/:id/advance — kitchen:advance_status (all three roles) —
  moves status forward one step only (pending->preparing->preparing->ready->ready->
  served); reject any request that tries to skip a state or move backward, validate
  server-side against the current stored status, not whatever the client claims it is
- Append to statusHistory on every transition (status, at, by: req.user.id) — this
  becomes useful audit trail for kitchen timing metrics later

Optional but recommended given this is a live kitchen board: wire up Socket.IO (or
Server-Sent Events) so ticket status changes push to connected clients instead of
requiring polling. If you add this, the socket connection must also carry and verify
the JWT (via handshake auth), not be open to anyone who can reach the port.
```

### Phase 9 — Customer Management API (Sonnet 5 / Fable 5)

```
Build Backend/src/routes/customers.js — full CRUD, permission customer:view/create/
edit/delete, admin and cashier only.

- GET /api/customers — support search by name/phone (use a text index or regex-anchored
  query, not an unescaped regex built from raw user input — escape special regex
  characters before interpolating into a RegExp to avoid ReDoS)
- POST /api/customers — validate phone format and uniqueness
- PUT /api/customers/:id
- DELETE /api/customers/:id
- GET /api/customers/:id/history — pull related Orders (paginate — don't return a
  customer's entire order history unbounded)

Phone and email are PII — don't include them in any log line (check this against the
redaction list from Phase 4's logger).
```

### Phase 10 — Dashboard & Reports API (Opus 5 — role-shaping matters here)

```
Build Backend/src/routes/dashboard.js and reports.js using Mongoose aggregation
pipelines (don't pull full collections into Node and reduce in memory — aggregate in
MongoDB).

Dashboard: GET /api/dashboard, dashboard:view:limited for cashier (returns only
today's sales, today's orders, pending orders, completed orders, recent orders — see
Phase 3's shaping rule), dashboard:view:full for admin (adds trends/comparisons/
expense summary). Same endpoint, response shaped by req.user.role — don't build two
separate endpoints that could drift out of sync.

Reports: reports:view, admin only, full 403 for cashier/kitchen_staff (not just a
hidden UI tab — the route itself must reject them even if they guess the URL).
- GET /api/reports/daily
- GET /api/reports/monthly
- GET /api/reports/expenses (+ POST to add an expense)
- GET /api/reports/pnl

Every date-range query param must be validated (parseable date, start <= end, range
capped to a sane max like 1 year) before being used in a Mongo query — an unvalidated
range is an easy way to force an expensive full-collection scan.
```

### Phase 11 — Security hardening pass & audit logging (Opus 5)

```
This is a review-and-close-gaps pass over everything built in Phases 0-10, plus audit
logging. Go through each item and fix what's missing:

Authentication & Authorization
- [ ] every route has requireAuth() + requirePermission() — grep for router.(get|post|
  put|patch|delete) and confirm none are missing middleware
- [ ] admin role check isn't just "role !== 'cashier'" anywhere (explicit allow-lists,
  not deny-lists)

Input validation
- [ ] every route with a body/query has a zod (or joi) schema and rejects unknown keys
- [ ] express-mongo-sanitize confirmed active on all routes

Rate limiting & payload limits
- [ ] auth routes have the strict limiter, general API has the broad limiter
- [ ] body size limits set on json/urlencoded/multipart

Data protection
- [ ] confirm the app is served behind HTTPS in deployment (document this — Express
  itself doesn't terminate TLS, that's the reverse proxy/host's job — but note it here
  so it isn't forgotten)
- [ ] User.toJSON strips passwordHash/pin everywhere, spot-check every endpoint that
  returns a User/Staff object
- [ ] no PII (phone/email) in logs

Error handling & headers
- [ ] production error responses never include a stack trace
- [ ] helmet headers present on every response (curl -I a live route and check)
- [ ] CORS doesn't reflect arbitrary Origin headers

Audit logging — implement now if not already:
- write an AuditLog entry (see Phase 1 schema) on: login, login failure, order void,
  discount override, menu price change, table delete, user role change. Never log the
  password/pin value itself, only the action and actor.
- GET /api/audit-logs — admin only, paginated, filterable by actor/action/date

Produce a short written summary of what was found and fixed — this becomes your
record that the checklist was actually run, not just pasted.
```

### Phase 12 — Testing, docs, deploy prep (Sonnet 5 / Fable 5, or Opus 5 if you want thorough test design)

```
Add:
- A README in Backend/ documenting setup, env vars, and how to run the seed script
- An OpenAPI/Swagger spec or a Postman collection covering every route with example
  requests per role (so you can hand this to someone testing RBAC manually)
- Integration tests (Jest + supertest, or similar) covering: auth happy path + failure
  path, RBAC denial for each role/route combination from the Phase 3 test matrix,
  order total computed server-side even if the client sends a bogus price, ticket
  status transition rejects an out-of-order jump
- A production checklist: NODE_ENV=production set, all secrets from env not hardcoded,
  MongoDB connection uses a least-privilege DB user (not an admin Mongo user), CORS
  origin locked to the real frontend domain, rate limits tuned for expected traffic
```

---

## 4. Suggested execution order

Phases 0-3 are the foundation (scaffold, models, auth, RBAC) — do these in order, and
don't skip the Phase 3 permission test matrix, since every later phase's `requirePermission`
calls depend on that map being correct. Phases 4-10 can mostly go in any order once 0-3
are solid (the frontend build order — menu, tables, billing, kitchen, customers, reports —
is a reasonable default). Do Phase 11 once, at the end, as a dedicated review pass rather
than trying to get everything perfect phase-by-phase — it's much easier to audit a
finished surface than a moving one. Phase 12 last.
