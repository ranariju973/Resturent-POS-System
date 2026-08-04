# Security review — Phase 11

Run against the codebase at Phase 11. The sweep is executable
(`tests/route-coverage.test.mjs`) and runs as part of `npm run verify`, so this
document records what it found rather than replacing it.

**Scope caveat, stated first:** no MongoDB was available in the environment
where this was performed. Everything below concerns code structure, request
handling and configuration. Nothing that reads or writes a document has been
executed. Phase 12's integration tests are where that gap closes, and until
they exist this review should not be read as "the system was tested".

---

## What the sweep checks

| # | Check | Result |
| --- | --- | --- |
| 1 | Every route requires authentication | 53 routes, 5 declared exemptions |
| 2 | Every data route names a permission — reads included | Pass, 17/17 GETs |
| 3 | Every input-taking route validates | Pass, 36/36 |
| 4 | Schemas are allow-lists (`.strict()`) | 44 objects, 44 strict |
| 5 | No authorisation logic outside the permission map | Pass |
| 6 | Credentials/PII cannot reach a response | Pass |
| 7 | Rate limits and payload caps mounted | Pass |
| 8 | Errors leak nothing in production | Pass |
| 9 | Audit trail covers the actions that matter | 13/13 |

---

## Findings

### 1. The sweep itself silently skipped a route file — fixed

The first run reported **zero routes in `health.js`** and passed every other
check anyway. The parser only recognised routes terminating in `\n);` (a
middleware chain) and missed `\n});` (an inline arrow handler).

This is the most instructive finding in the review, and it is about the review
rather than the code. **A file that parses to zero routes looks identical to a
file where every route is guarded.** An audit tool that can fail open is worse
than no audit tool, because it produces confidence rather than absence of it.

Fixed two ways: the parser now handles both terminators, and a file yielding
zero routes is an explicit failure rather than a silent pass.

### 2. Three assertions in the sweep were wrong, not the code

Worth recording because the pattern recurred all build:

- `no controller returns a raw user document` flagged `kitchenController.js`.
  The regex matched `req.user.id` inside a payload. Not a leak.
- `both login routes carry the strict limiter` expected 2 occurrences of
  `loginLimiter` and found 3 — the third was the import statement.
- The schema count read 12 objects against 44 `.strict()` calls, because
  `z.object(` missed schemas formatted as `z\n  .object(`.

Across the whole build, **five** test failures turned out to be the test
misreading its own subject — usually a comment containing the string being
grepped for. Source-grepping assertions are fragile in a way their pass/fail
output does not advertise. Where it mattered they now strip comments first, but
this is the standing weakness of the approach.

### 3. No code defects found by this pass

Checks 1–9 found no unguarded route, no missing permission, no unvalidated
input, no credential reachable through a response, and no controller branching
on a role string.

That is a weaker statement than it looks. It says the structural rules hold —
not that the logic behind them is correct. A route can carry
`requirePermission(PERMISSIONS.MENU_VIEW)` and still be the wrong permission for
what it does; this sweep cannot tell.

---

## Defects found earlier and fixed at the time

Recorded here because a review that only lists a clean final run is not a useful
record.

| Phase | Defect | Fix |
| --- | --- | --- |
| 2 | Flat lockout (5 attempts / 15 min) let a 4-digit PIN keyspace fall in **~21 days** of unattended attack | Progressive backoff, doubling to a 24h cap. Full sweep now ~5.5 years |
| 4 | `X-Frame-Options` was helmet's default `SAMEORIGIN`, not `DENY` | Set explicitly |
| 4 | A plain `Error` carrying `status: 400` was answered as a **500** — client mistakes reported as server faults, and false bug reports in the logs | Guard throws `ApiError`; handler honours 4xx on plain errors as a backstop |
| 5 | `removeImage` transformed `undefined` into `false`, so the "at least one field" guard could never fire and an empty `PUT` was accepted | Transform preserves `undefined` |

---

## Accepted risks

Things that are deliberate, with the reasoning, so a future reader does not
"fix" them without understanding the trade.

**`requireAuth` hits the database on every request.** A JWT is self-contained
and this could be skipped. It is not, because a token minted 14 minutes ago
asserts what was true 14 minutes ago — long enough for a cashier to be demoted
and keep working. Cost: one indexed lookup per request.

**Refresh-token reuse revokes the whole session family**, logging out the
legitimate user along with the attacker. There is no way to tell them apart, and
the alternative is leaving a stolen session live.

**Rate limiters are in-memory.** Behind more than one instance each enforces its
own separate budget. Single-server deployments are unaffected; horizontal
scaling needs a shared store.

**The SSE event bus is in-process.** Two instances would each only notify their
own connected boards. Same fix (Redis pub/sub), same trigger.

**Transactions degrade on standalone MongoDB.** Atlas provides a replica set, so
production is fine. A local `mongod` is not, and the server warns loudly rather
than crashing every write. **If that warning appears in a real deployment, order
writes can half-commit.**

**A manager override PIN exists** so a manager can approve a void without typing
an email and password mid-service. It is a separate credential from the staff
login PIN and cannot start a session — `findActiveByPin` excludes admins.

---

## Open gaps

Ranked by what I would fix first.

1. **No integration tests.** Everything database-touching is unverified: order
   transactions, Cloudinary cleanup, the compare-and-swap behaviour under real
   concurrency, successful authentication. This is Phase 12 and it is the
   largest gap by a wide margin.

2. **No user-management endpoints.** Staff PINs and the manager override PIN can
   only be set by re-seeding. There is no way to add a cashier, rotate a PIN, or
   deactivate someone who left — which is a real operational hole, not just a
   missing feature.

3. **`bcrypt` is a native module.** A `node_modules` built on macOS cannot run
   on Linux. This will break any Docker build or CI runner. `bcryptjs` removes
   it entirely for a ~30% hashing cost that is irrelevant at a few logins a
   shift.

4. **Customer erasure is untested.** It is irreversible and exists to satisfy a
   DPDP/GDPR request. It should not be relied on until it has been run against
   a real database.

5. **TLS is assumed, not enforced.** The app does not terminate TLS; HSTS is
   only sent when `NODE_ENV=production`. Deploy behind a proxy that enforces
   HTTPS.

6. **Least-privilege database user.** The Atlas connection string should not be
   a cluster-admin account in production.

---

## Production checklist

- [ ] `NODE_ENV=production`
- [ ] `CORS_ORIGIN` set to the real frontend domain (the server refuses to start
      if it contains `localhost` or `*` in production)
- [ ] All three secrets regenerated — not the development values
- [ ] `SEED_ADMIN_PASSWORD` and `SEED_ADMIN_OVERRIDE_PIN` changed from their
      seeded values
- [ ] MongoDB user scoped to this database only
- [ ] Indexes built explicitly (`autoIndex` is off in production)
- [ ] Behind a TLS-terminating proxy
- [ ] `trust proxy` matches the actual number of hops
- [ ] Credentials pasted into any chat or ticket rotated
