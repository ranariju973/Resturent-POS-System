# POS reliability rollout

This release is implemented and tested locally. No production database migration, deployment, account change, or credential rotation has been performed. Use the existing Render, Vercel, Atlas and Cloudinary services.

## Behavior

- The operational day begins at **04:00 Asia/Kolkata**, independently of the server timezone. Recent Orders includes the current and previous service days, with **50 rows per page** and Load More. This is roughly 24–48 hours, not a rolling 48-hour window.
- Kitchen tickets expire at the next 04:00 after placement. Expired tickets immediately disappear from board/detail/advance/recall APIs. Status changes never extend expiry. The single-field `Ticket.expiresAt` TTL index uses `expireAfterSeconds: 0`.
- TTL deletes **tickets only**. Orders, invoice data, payments, reports and table occupancy survive. MongoDB TTL deletion is asynchronous; deleting documents does not guarantee an immediate reduction in allocated database storage. See [MongoDB TTL indexes](https://www.mongodb.com/docs/v8.0/core/index-ttl/).
- Sales totals and daily order/invoice numbering continue to use **midnight in India**, not the operational reset. Expense dates are returned as India calendar dates.
- Draft table selection supports Confirm/Cancel and up to 50 tables. Confirmation does not reserve anything. Submission claims the entire group in one transaction or fails without partial changes.
- One group has one order and one kitchen ticket. Transfer replaces one member; replacing the primary promotes its replacement. Merge refuses separate open bills. Unmerge refuses an open shared bill. Payment detaches every member but keeps seats occupied until staff clear them. Voiding an unpaid bill releases all members.
- New order submissions carry a UUID. A retry by the same cashier with the same contents returns the original order. Different contents or another cashier cannot reuse it. The browser retains an uncertain submission for retry while the page remains open; it does not persist customer drafts across a full reload. After a reload, check the floor/Recent Orders before reconstructing an uncertain sale.
- Open bills display server price snapshots. Their draft controls are disabled; settle or void before starting another. API item updates use optimistic concurrency and accept an optional `version`. Payments and voids send the displayed version. A lost payment response is reconciled by reading the order before another attempt.
- A payment replay returns the existing order with `invoice: null`: only the invoice token hash is stored, so a lost share URL cannot be reconstructed. Receipt printing remains available. Printing never creates or settles another order.
- Reset/visibility refresh, stream renewal and disconnected polling update open screens. API responses are `no-store`; dashboard cache keys include both India date and service day. Ordinary dashboard/report cache staleness remains bounded at 30 seconds for current data.

## API additions and compatibility

`GET /api/dashboard/recent-orders?cursor=...` uses existing dashboard permissions. Response data contains `recentOrders`, `recentNextCursor`, `recentSince`, `nextResetAt`. Treat the cursor as opaque. An obsolete service-day cursor returns 409; discard it and reload. Every query is tenant scoped.

`POST /api/orders` accepts either legacy `tableId` or new `tableIds`, never both. Dine-in needs a selection; takeaway/delivery reject one. `clientRequestId` is an optional UUID for compatibility, supplied by the new frontend. Responses retain legacy `table` and add `tables`, `replayed`; orders expose `tableIds`, `tableNames`, `version`. A creation replay can have `ticketId: null` after ticket expiry.

`POST /api/orders/:id/pay` accepts optional `version`. Identical payment retries return 200 with `replayed: true`; changed payment details conflict. Void and item-edit requests also accept optional `version`. Legacy clients still receive database-level optimistic concurrency protection, but should send versions to reject edits based on an old screen.

Kitchen stream credentials now travel in an Authorization header using fetch streaming. Legacy short-lived `?token=` clients remain supported; application URL logs omit queries. Streams verify active users, token versions, active tenants and kitchen permissions, and close at credential expiry.

## Before deployment

1. Schedule maintenance and stop all writers, including old browser tabs and scripts. Keep the service unavailable to staff until migration and both deployments are ready.
2. Take a **verified, restorable backup** of the database. Keep the backup encrypted and outside the repository. Record collection counts and current indexes. Test restoration on a disposable database; do not assume a free plan has automated backups.
3. Follow [the credential rotation runbook](CREDENTIAL-ROTATION.md). The credentials pasted into chat are exposed. Rotation has intentional effects on sessions, PINs, terminal bindings and old invoice links.
4. Install from lockfiles with `npm ci` in each project. Use a supported Node version satisfying the installed packages' engine requirements; the local validation environment used Node 26.4.0.
5. Configure Render using separate secret environment entries. Do not paste Markdown links as values:

```dotenv
NODE_ENV=production
CORS_ORIGIN=https://pos-resturent-system.vercel.app
PUBLIC_APP_URL=https://pos-resturent-system.vercel.app
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
UPLOAD_MAX_BYTES=4194304
JSON_BODY_LIMIT=100kb
LOG_LEVEL=info
```

Retain Render's assigned `PORT`; provide the rotated `MONGO_URI`, signing secrets, peppers and Cloudinary credentials privately. Production writes and shared-table operations require a replica set. Atlas provides the required deployment topology. `TZ=Asia/Kolkata` is optional: business dates no longer depend on it.

Keep Vercel's existing `/api` rewrite in `Frontend/vercel.json`. Leave `VITE_API_URL` empty for the same-origin proxy. `VITE_GOOGLE_CLIENT_ID` must exactly match backend `GOOGLE_CLIENT_ID`, with the deployed frontend origin authorized in Google. No database, JWT, pepper or Cloudinary secret belongs in a `VITE_*` variable. Production cookies are secure and HttpOnly; verify their behavior through the Vercel proxy.

## Dry-run-first migration

From `Backend`, using the intended environment loaded privately:

```sh
npm run migrate:reliability
```

This reports counts and inconsistent record IDs, with **no database writes or index creation**. Resolve all reported missing tenants, invalid dates, conflicting table claims, invalid primary/member IDs, and table links to settled/missing bills. Never blindly delete a conflicting financial order to make an index build pass.

After reviewing the dry run, verifying the backup and stopping writers:

```sh
npm run migrate:reliability -- --apply --maintenance-confirmed
```

The migration backfills order membership and name snapshots, reconstructs live legacy merged groups, and repairs their table links. Closed historical groups with no recorded membership cannot be reconstructed; the known primary is retained. Order scans and ticket operations use batches of 250; order version checks stop if writers interfere. The operation is rerunnable after correcting a partial failure.

Tickets receive expiry derived from their original placement. Expired tickets are physically deleted in batches **before** TTL is enabled. The script then adds only these targeted indexes:

| Collection | Keys | Options |
| --- | --- | --- |
| orders | `tenantId: 1, tableIds: 1` | unique; partial open orders with a nonempty membership |
| orders | `tenantId: 1, clientRequestId: 1` | unique; partial string request IDs |
| orders | `tenantId: 1, createdAt: -1, _id: -1` | recent-order pagination |
| tickets | `expiresAt: 1` | TTL, `expireAfterSeconds: 0` |

Keep the existing primary-table uniqueness index for compatibility. Do not use a broad `syncIndexes()` as a substitute: it can drop unrelated indexes. Production `autoIndex` is off, so deploying code alone does not install these indexes. If an index with the same name has different options, investigate it during maintenance rather than dropping indexes blindly.

Deploy the compatible backend, then frontend, while maintenance remains active. Reload all terminals. Do not allow old and new writers to overlap during backfill.

## Smoke test and rollback

Check owner login, staff PIN login, session refresh, terminal linking, menu image upload, single/group order creation, a conflicting second terminal, receipt/KOT rendering, cash/card/UPI settlement, kitchen advance/recall, Recent Orders pagination and reports. Confirm a paid table remains occupied and can then be cleared. Check invoice links with a newly paid test bill. Use controlled test records and void them with an audit reason when appropriate.

Monitor errors, duplicate-key conflicts, transaction retries and TTL backlog. A credential or stream token must not appear in application request logs. Provider-level logs need separate review, especially historical query-token URLs.

If rollout fails, keep writers stopped. Diagnose and rerun the migration when possible. Do not roll back to old table-writing code while new shared groups are live. Restoring a backup discards all writes made after it; coordinate that explicitly and restore into a separate database for verification first. Expired tickets deleted by migration/TTL are recoverable only from backup. Never restore exposed credentials as a rollback shortcut.

Render's free service can spin down while idle and take time to wake. These changes improve warm application behavior; they cannot remove that hosting delay. See [Render free services](https://render.com/docs/free).

## Local validation

The fixed local runner and benchmark never inherit an Atlas URI. Start a disposable replica set in a separate terminal:

```sh
mkdir -p /private/tmp/restaurant-pos-reliability-db
mongod --dbpath /private/tmp/restaurant-pos-reliability-db --port 27029 --bind_ip 127.0.0.1 --replSet pos-reliability
```

Then, from `Backend`:

```sh
node scripts/local-replica.mjs
npm run lint
npm run verify:local
node scripts/benchmark-billing.mjs
```

From `Frontend`, run `npm run build`. The generic `verify:all` runner uses configured database credentials and writes test databases; prefer `verify:local` for isolation.

See [validation, performance and security results](RELIABILITY-RESULTS.md). Hardware printer output, real Google/Cloudinary provider calls, and production network latency require deployment smoke tests; local verification does not certify those services.
