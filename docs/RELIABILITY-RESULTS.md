# Reliability, performance and security results

## Verification

Baseline before this change: frontend production build passed; 28 backend suites and 1,492 assertions passed. Database integration tests had not been run.

Final backend verification: **29 unit suites, 1,506 assertions passed; 4 integration suites, 218 assertions passed**. ESLint passed. Frontend TypeScript checking and production build passed. `git diff --check` passed. Tests use a disposable localhost MongoDB replica set, not Atlas.

The added coverage exercises:

- 03:59:59/04:00 boundaries, India midnight, year/leap-month transitions and UTC/Los Angeles/India hosts.
- TTL definition, expiry anchored to placement, advance/recall preserving lifetime, immediate rejection of expired ticket operations, and preservation of financial records/table occupancy.
- More than 100 recent orders, 50-row pagination, equal-timestamp ordering, no duplicates, expired cursors, tenant isolation and limited-dashboard permissions.
- Legacy/new table input, duplicate/mixed selections, grouped create/merge/primary transfer/unmerge refusal, overlapping terminals and transaction rollback after an injected failure following table claims.
- Same-UUID concurrent retries, changed-payload refusal, payment replays, one customer visit/audit entry, stale item/payment versions, competing payment/void operations, all-member release/detach and shared receipt labels.
- Authenticated tenant-isolated streams and listener cleanup; simultaneous refresh-token reuse and descendant revocation.
- Dry-run migration with no writes, applying legacy membership/expiry backfill, preserving bills, and installing the TTL index.
- Table purge refusal with open bills, cashier purge denial, atomic financial purge cleanup and cross-tenant preservation.

Local Chrome checks used fabricated credentials/data: multi-table Cancel/Confirm, shared-order creation, recovery from the floor, payment, occupied-until-cleared behavior, and network-response-loss recovery. A lost creation response retried the same UUID and returned the same bill; a lost payment response was reconciled without another payment request. A simulated printer failure surfaced an error without another financial mutation. Kitchen labels retained every table name after payment, and a simulated later service day plus visibility restoration hid expired tickets. No hardware printer or real Google/Cloudinary account was used.

## Warm billing measurements

Same local replica set and HTTP benchmark, takeaway with one line of quantity two, cash payment, no customer, five warmups followed by 30 samples. Model operations are counted through Mongoose's debug hook; they are **not** low-level wire command counts and exclude transaction control commands. Results are local observations, not production latency guarantees.

| Path | Baseline p50 / p95 | Final p50 / p95 | Model operations before → after |
| --- | --- | --- | --- |
| Create, legacy request shape | 16.89 / 20.82 ms | 11.01 / 16.17 ms | 5 → 5 |
| Pay | 14.92 / 17.14 ms | 9.99 / 11.08 ms | 3 → 3 |
| Create, new UUID-protected path | not available | 13.24 / 32.42 ms | 7 |
| Pay after UUID-protected create | not available | 10.65 / 18.49 ms | 3 |

The UUID path adds two indexed replay checks. Its p95 is higher in this small sample; do not describe every path as faster. Grouped bills perform additional transactional table claims proportional to group size. Transactional safety, retry protection and audit writes are retained. Repeat on staging with realistic customer/table distributions before setting an SLA.

Run `node scripts/benchmark-billing.mjs` from Backend for the comparable legacy shape; add `--idempotent` for the new client shape. Both commands use a hard-coded disposable local database.

The frontend now applies table state from create/pay/void/merge/transfer responses, coalesces concurrent board/dashboard loads, and coalesces kitchen events with one trailing refresh. A visibility-aware fallback polls only while streaming is disconnected. Menu/cart indexes and screen/printer lazy loading are retained. Render idle wake-up time is unchanged.

## Frontend size and dependencies

| Asset | Before | Final |
| --- | --- | --- |
| Emitted CSS | 38.74 KB (19.91 KB gzip) | 4.72 KB (1.55 KB gzip) |
| Main application JS chunk | 169.97 KB (45.89 KB gzip) | 178.61 KB (48.37 KB gzip) |

Five Manrope weights now import the Latin subset rather than all script subsets. Main JS grew with the reliability features; React, animation, screens and printer transport remain separate chunks. These are build-reported decimal KB, not total page-transfer measurements.

Every declared runtime dependency has a verified import/use. No runtime dependency was added or removed merely because its purpose was unclear. Compatible advisory fixes were applied to both lockfiles; Zod was upgraded to 4.x with validation options updated and the full suite run. Final `npm audit` reported **0 known vulnerabilities in both projects**, compared with 9 backend and 2 frontend findings initially. Audit results are a point-in-time check, not a guarantee against undisclosed vulnerabilities.

## Security findings and fixes

| Finding | Resolution / evidence |
| --- | --- |
| Kitchen events lacked tenant filtering; stream identity lookup could execute without tenant context | Events now carry internal tenant scope, subscribers filter it, stream identity is loaded inside the token's tenant, and active tenant/user/permissions/version are checked. Two-tenant stream tests pass. |
| Concurrent refresh requests could create two valid descendants from one credential | Reproduced with simultaneous HTTP requests. Claim/replacement now commit atomically; reuse revokes the family. Regression passes. |
| Query credentials and invoice slugs could reach URL logs | Application request logging strips queries and masks public invoice slugs. Stream clients use headers. Structured/text redaction covers secrets, token strings and MongoDB userinfo. Provider logs need separate operational review. |
| Payment, edits, voiding or table operations could overwrite a concurrent change | Transactions, conditional claims, optimistic Order versions, optional client versions and unique membership/request indexes protect the write paths. Race/rollback regressions pass. |
| Audits could fail after a successful create/void/delete | These audits now commit in the same transaction as their order mutations; payment audit/customer visit are also transactional. Injected audit failure rolls back a group claim. |
| Financial purge left dangling tickets/table links | Related cleanup and audit now commit together; table purge refuses open bills. Permissions and tenant boundaries are regression-tested. |
| Unbounded date-keyed cache growth | Expired entries are swept and the cache is capped at 2,048 entries; concurrent misses share computation, invalidation prevents stale repopulation. |
| Shared receipts/floor totals could omit members or multiply a bill | Membership/name snapshots are carried through billing, kitchen, floor panels, receipts and order detail. Group totals count each order ID once. |
| Secret backup filenames were insufficiently ignored | Root/backend/frontend ignore `.env.*`, with `.env.example` explicitly allowed. No actual secret files were modified or committed. |

Reviewed existing controls: tenant-scoped model hooks fail closed without context; route permissions cover data APIs and destructive endpoints; Google ID tokens use the configured audience and verified email; refresh records hold token hashes; uploads are memory/size bounded and checked by content signatures before Cloudinary; public invoices require a high-entropy peppered token and omit internal IDs/customer phone data. Existing coverage plus new integration scenarios passed. This is a focused application review, not a comprehensive penetration test.

The exposed credentials remain an outstanding production action. See [credential rotation](CREDENTIAL-ROTATION.md) and [migration/deployment](POS-RELIABILITY-ROLLOUT.md). Production deployment, account changes, provider log review and physical printer verification were not performed locally.
