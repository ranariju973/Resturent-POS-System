# Plan — order types, phone-first customers, admin-only deletion

Scope: the five changes requested for POS Billing and Customers. Written to be
implemented in order; each phase leaves the tree compiling and the suite green.

---

## 0. What already exists (do not rebuild)

Worth reading before starting — four of these do most of the work already.

| Thing | Where | State |
| --- | --- | --- |
| Phone as the unique key | `Customer.phoneNormalized`, unique sparse index | **Done.** A `pre('save')` hook derives it from `phone`, so `+91 98200 41122`, `(982) 004-1122` and `9820041122` all resolve to one person. |
| Dine-in ⇄ table coupling | `validators/orders.js`, `createOrderSchema` | **Done.** Already refuses a dine-in order with no table, and refuses a table on takeaway/delivery. The UI change makes the screen agree with a rule the server enforces today. |
| Two-tier customer deletion | `customerController.deleteCustomer` | **Mostly done.** Soft delete needs `customer:delete`; irreversible erase needs `user:manage` (admin). |
| Reviving a soft-deleted customer | `createCustomer` | **Done.** Re-using a previously deleted phone number restores that record rather than colliding on the unique index. |
| Search by name or phone prefix | `Customer.search()` | **Done**, but see §2 — prefix matching on phone is exactly the thing we must *not* expose to lookup. |

### One bug found while surveying

`customerSchema.methods.recordVisit()` exists, is documented as "called on order
settlement", and **is never called from anywhere**. So `visitCount` is always 0
and `lastVisitAt` is always null — which means the Customers list's
"last visit" sort has never worked and every customer looks like a first-timer.

Fix it in Phase 3, where the order already has the customer in hand.

---

## 1. Order type pills, and the table only for dine-in

Frontend only. No backend change — the server already enforces this pairing.

**`src/store.tsx`**

- Add `orderType: OrderType` to state, default `'dine-in'`.
- Add a `setOrderType` action. When switching *away* from dine-in it must clear
  `orderTable`, otherwise a stale table id rides along and the server rejects
  the order with "Only dine-in orders may be attached to a table" — which reads
  as a bug rather than as the UI's own leftover state.
- `generateBill` stops inferring the type from `orderTable ? 'dine-in' : 'takeaway'`
  and sends `state.orderType` instead.

**`src/screens/Billing.tsx`**

- Three `FilterPill`s at the top of the right-hand panel: Dine-in, Takeaway,
  Delivery. `FilterPill` already exists in `components/ui.tsx`.
- Render the table chip / table picker only when `orderType === 'dine-in'`.
- Keep the disabled-button reason text honest: for dine-in with no table it
  should say "Pick a table", not "Add an item to bill".

**Decision to make:** delivery has no address field anywhere in the system. Out
of scope as written, but a delivery order the driver cannot deliver is worth
deciding about deliberately rather than discovering later.

---

## 2. Phone lookup — the one piece with a real security question

The requested behaviour: cashier types a phone number, the name auto-fills from
the database.

**This is a PII lookup endpoint, and it needs care.** Anyone with a POS login —
including a cashier on a shared terminal — can type numbers into that box. If
the endpoint answers partial matches, or answers "no match" distinguishably
fast, the POS becomes a reverse phone directory for your customer list.

Mitigations to build in from the start, not later:

1. **Exact full-number match only.** Match on the whole normalised number, never
   a prefix. `Customer.search()` deliberately must NOT be reused here — its
   phone condition is `$regex: ^${digits}`, which is prefix matching.
2. **Minimum length before it fires.** Do not query until the typed number has
   at least the digits a real number needs (the validator's floor is 6).
3. **Return the narrowest useful shape:** `{ found, id, name }`. Not email, not
   notes, not visit history. The billing screen needs a name and an id.
4. **Rate limit per user**, reusing the `express-rate-limit` setup already in
   `middleware/rateLimit.js`. A cashier legitimately does a handful of lookups
   per shift; hundreds is enumeration.
5. **Debounce client-side** (~300ms) so ordinary typing doesn't fire eight
   requests, and abort the in-flight one on each keystroke via the `signal`
   option `api()` already supports.

**New backend work**

- `validators/customers.js` — `lookupSchema`: `{ phone }`, reusing the existing
  `phone` validator.
- `controllers/customerController.js` — `lookupByPhone`: normalise, exact-match
  on `phoneNormalized`, `isActive: true`, return `{ found, id, name }`.
  `phoneNormalized` is `select: false`, so it needs an explicit `.select()`.
- `routes/customers.js` — `GET /api/customers/lookup`, permission
  `CUSTOMER_VIEW`, **declared before `/:id`** or the parameterised route
  swallows it. There is precedent for this ordering mistake being caught by
  tests in `tables.js` and `menu.js`; add the same assertion here.
- `middleware/rateLimit.js` — a lookup limiter.

**New frontend work**

- `lib/customersApi.ts` (new file, following `menuApi.ts`): `lookupByPhone`,
  plus `listCustomers`, `getCustomer`, `updateCustomer`, `deleteCustomer` for
  Phase 5.

---

## 3. Customers save themselves at billing time

**Order of fields:** phone first, then name. Phone is the identity; the name is
a label attached to it.

**Where the upsert happens: server-side, inside the order transaction.** The
alternative — client calls "find or create customer", then calls "create order"
— has a gap between the two calls where the first can succeed and the second
fail, leaving a customer record for an order that was never placed. It also
doubles the round trips on the hottest path in the app.

**Backend**

- `validators/orders.js` — extend `createOrderSchema` with an optional
  `customer: { phone, name? }`. Keep the existing `customerId` for callers that
  already have one; reject both being sent at once rather than picking a winner.
- `controllers/orderController.js`, inside `createOrder`'s existing
  `withTransaction`:
  - normalise the phone, look for a live customer
  - found → use it; if a `name` was supplied and differs, leave the stored name
    alone (a typo at the till should not rename a regular)
  - not found → create, requiring a name. **This is the rule to confirm:** if
    the phone is unknown and no name is given, is that a 400, or do we store
    something like "Guest"? A 400 keeps the data clean; "Guest" keeps the queue
    moving. Recommendation: 400, because a customer list full of Guests is
    worse than a cashier typing four characters.
  - call `recordVisit()` — the fix for §0's bug. Do it on **payment**, not on
    order creation, so an abandoned tab does not count as a visit.

**Frontend**

- Billing panel: phone input first, name second. Name field is read-only-ish
  once auto-filled, with a way to override for a genuine correction.
- `CONFIG.requireCustomerName` becomes "require phone"; `canGenerate` gates on
  phone validity rather than name.
- On a successful lookup show a quiet confirmation ("Returning customer") — the
  cashier needs to know the name came from the database rather than from them.

---

## 4. Remove "Add customer" from the Customers screen

- Delete the add button and the add branch of `openCustModal` / `saveCustomer`
  in `store.tsx`; keep the edit path.
- `components/menuModals.tsx` holds the customer modal — trim it to edit-only.
- Leave `POST /api/customers` on the backend. It is what the order flow uses
  internally, and removing it would only push the same logic somewhere less
  tested.

**Consequence to accept:** a customer can no longer be added without an order.
That is the intent, but it means someone phoning ahead to be recorded for later
cannot be entered until they actually buy something.

---

## 5. Deletion becomes admin-only

Currently `CUSTOMER_DELETE` is granted to **cashier as well as admin**
(`constants/permissions.js`, `CASHIER_PERMISSIONS`). The request is admin-only.

- Remove `P.CUSTOMER_DELETE` from `CASHIER_PERMISSIONS`.
- Update the spec table in `tests/rbac-matrix.test.mjs` —
  `[P.CUSTOMER_DELETE]: [ADMIN]`. That test is an independent statement of
  intent, so changing it is part of the change, not a chore.
- `lib/permissions.ts` on the frontend needs no new string, but the Customers
  screen should hide the delete control behind `can(user.permissions, CUSTOMER_DELETE)`.

**Note there are two levels already.** Soft delete (`customer:delete`) hides the
record; erase (`user:manage`) irreversibly anonymises it for a
DPDP/GDPR request. After this change both are admin-only, which makes the
distinction less visible in the UI — worth labelling them clearly as "Remove"
and "Erase permanently" rather than leaving an admin to guess.

---

## Suggested order of work

1. **Phase 1** — order type pills. Self-contained, frontend only, immediately visible.
2. **Phase 5** — permission change. Two lines plus a test row; get it out of the way.
3. **Phase 2** — lookup endpoint with its guardrails, plus `customersApi.ts`.
4. **Phase 3** — the upsert in `createOrder`, the `recordVisit` fix, billing panel rework. The biggest phase.
5. **Phase 4** — strip the add-customer path once billing genuinely creates customers.

Phase 4 last on purpose: removing the only way to create a customer before the
replacement works would leave a window where no customer can be created at all.

---

## Tests to add

Following the existing style in `tests/` — source assertions plus behavioural
checks, no live database required.

- `lookup` is declared before `/:id` (the route-swallowing bug, third time).
- `lookup` matches the whole number, not a prefix — assert `Customer.search` is
  **not** used in the handler.
- `lookup` returns no email, notes or history.
- `createOrder` rejects `customerId` and `customer` together.
- A dine-in order still requires a table; takeaway still refuses one.
- `recordVisit` is called on payment and not on order creation.
- RBAC matrix: `customer:delete` is admin-only.

---

## Open questions

1. **Unknown phone with no name** — 400, or store a placeholder? (Recommendation: 400.)
2. **Delivery addresses** — genuinely out of scope, or a gap to close now?
3. **Name mismatch on a returning customer** — silently keep the stored name, or
   prompt the cashier to update it? Silently keeping is safer; prompting is more
   honest. Recommendation: keep, and let admins correct names on the Customers screen.
4. **Existing customer records** have `visitCount: 0` from the bug in §0. Leave
   them, or backfill from order history in a one-off script?
