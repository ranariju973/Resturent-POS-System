# API reference

**Generated** by `npm run docs` from `src/routes/`. Do not edit by hand — a
hand-maintained reference is wrong within a month, and a wrong reference is
worse than none because it gets trusted.

55 routes. Every response uses the envelope
`{ success, data }` or `{ success: false, error: { message, code?, details? }, requestId }`.

Permission names map to roles in `src/constants/permissions.js`:

| Role | Holds |
| --- | --- |
| `admin` | every permission |
| `cashier` | dashboard (limited), POS, menu view + stock toggle, tables (seating), kitchen, customers |
| `kitchen_staff` | kitchen view + advance, menu view + stock toggle — 4 permissions, nothing else |


## Health

| Method | Path | Auth | Permission | Validated |
| --- | --- | --- | --- | --- |
| GET | `/api/health` | — | — | — |

## Authentication

| Method | Path | Auth | Permission | Validated |
| --- | --- | --- | --- | --- |
| POST | `/api/auth/login/admin` | — | — | ✅ |
| POST | `/api/auth/login/staff` | — | — | ✅ |
| POST | `/api/auth/refresh` | — | — | — |
| POST | `/api/auth/logout` | — | — | ✅ |
| GET | `/api/auth/me` | ✅ | — | — |

## Menu

| Method | Path | Auth | Permission | Validated |
| --- | --- | --- | --- | --- |
| GET | `/api/menu/categories` | ✅ | `MENU_VIEW` | ✅ |
| PUT | `/api/menu/categories/:id` | ✅ | `MENU_EDIT` | ✅ |
| DELETE | `/api/menu/categories/:id` | ✅ | `MENU_DELETE` | ✅ |
| GET | `/api/menu/items` | ✅ | `MENU_VIEW` | ✅ |
| PATCH | `/api/menu/items/:id/availability` | ✅ | `MENU_TOGGLE_STOCK` | ✅ |
| GET | `/api/menu/items/:id` | ✅ | `MENU_VIEW` | ✅ |
| POST | `/api/menu/items` | ✅ | `MENU_CREATE` | ✅ |
| PUT | `/api/menu/items/:id` | ✅ | `MENU_EDIT` | ✅ |
| DELETE | `/api/menu/items/:id` | ✅ | `MENU_DELETE` | ✅ |

## Tables

| Method | Path | Auth | Permission | Validated |
| --- | --- | --- | --- | --- |
| GET | `/api/tables` | ✅ | `TABLE_VIEW` | ✅ |
| GET | `/api/tables/zones` | ✅ | `TABLE_VIEW` | ✅ |
| POST | `/api/tables` | ✅ | `TABLE_CREATE` | ✅ |
| PUT | `/api/tables/:id` | ✅ | `TABLE_EDIT` | ✅ |
| DELETE | `/api/tables/:id` | ✅ | `TABLE_DELETE` | ✅ |
| PATCH | `/api/tables/:id/seat` | ✅ | `TABLE_MANAGE_SEATING` | ✅ |
| PATCH | `/api/tables/:id/reserve` | ✅ | `TABLE_MANAGE_SEATING` | ✅ |
| PATCH | `/api/tables/:id/release` | ✅ | `TABLE_MANAGE_SEATING` | ✅ |
| POST | `/api/tables/:id/transfer` | ✅ | `TABLE_MANAGE_SEATING` | ✅ |
| POST | `/api/tables/:id/merge` | ✅ | `TABLE_MANAGE_SEATING` | ✅ |
| POST | `/api/tables/:id/unmerge` | ✅ | `TABLE_MANAGE_SEATING` | ✅ |
| POST | `/api/tables/:id/split` | ✅ | `TABLE_MANAGE_SEATING` | ✅ |

## POS Billing

| Method | Path | Auth | Permission | Validated |
| --- | --- | --- | --- | --- |
| GET | `/api/orders` | ✅ | `POS_CREATE_ORDER` | ✅ |
| POST | `/api/orders` | ✅ | `POS_CREATE_ORDER` | ✅ |
| GET | `/api/orders/:id` | ✅ | `POS_CREATE_ORDER` | ✅ |
| PATCH | `/api/orders/:id/items` | ✅ | `POS_CREATE_ORDER` | ✅ |
| PATCH | `/api/orders/:id/discount` | ✅ | `POS_APPLY_DISCOUNT` | ✅ |
| POST | `/api/orders/:id/pay` | ✅ | `POS_CREATE_ORDER` | ✅ |
| POST | `/api/orders/:id/void` | ✅ | `POS_CREATE_ORDER` | ✅ |

## Kitchen

| Method | Path | Auth | Permission | Validated |
| --- | --- | --- | --- | --- |
| GET | `/api/kitchen/stream` | ✅ | `KITCHEN_VIEW` | ✅ |
| GET | `/api/kitchen/tickets` | ✅ | `KITCHEN_VIEW` | ✅ |
| GET | `/api/kitchen/tickets/:id` | ✅ | `KITCHEN_VIEW` | ✅ |
| PATCH | `/api/kitchen/tickets/:id/advance` | ✅ | `KITCHEN_ADVANCE_STATUS` | ✅ |
| PATCH | `/api/kitchen/tickets/:id/recall` | ✅ | `KITCHEN_RECALL` | ✅ |
| POST | `/api/kitchen/stream-token` | ✅ | `KITCHEN_VIEW` | — |

## Customers

| Method | Path | Auth | Permission | Validated |
| --- | --- | --- | --- | --- |
| GET | `/api/customers` | ✅ | `CUSTOMER_VIEW` | ✅ |
| POST | `/api/customers` | ✅ | `CUSTOMER_CREATE` | ✅ |
| GET | `/api/customers/:id/history` | ✅ | `CUSTOMER_VIEW` | ✅ |
| GET | `/api/customers/:id` | ✅ | `CUSTOMER_VIEW` | ✅ |
| PUT | `/api/customers/:id` | ✅ | `CUSTOMER_EDIT` | ✅ |
| DELETE | `/api/customers/:id` | ✅ | `CUSTOMER_DELETE` | ✅ |

## Dashboard

| Method | Path | Auth | Permission | Validated |
| --- | --- | --- | --- | --- |
| GET | `/api/dashboard` | ✅ | `either dashboard grant` | ✅ |

## Reports

| Method | Path | Auth | Permission | Validated |
| --- | --- | --- | --- | --- |
| GET | `/api/reports/daily` | ✅ | `REPORTS_VIEW` | ✅ |
| GET | `/api/reports/monthly` | ✅ | `REPORTS_VIEW` | ✅ |
| GET | `/api/reports/pnl` | ✅ | `REPORTS_VIEW` | ✅ |
| GET | `/api/reports/expenses` | ✅ | `REPORTS_VIEW` | ✅ |
| POST | `/api/reports/expenses` | ✅ | `REPORTS_VIEW` | ✅ |
| DELETE | `/api/reports/expenses/:id` | ✅ | `REPORTS_VIEW` | ✅ |

## Audit log

| Method | Path | Auth | Permission | Validated |
| --- | --- | --- | --- | --- |
| GET | `/api/audit-logs/summary` | ✅ | `AUDIT_VIEW` | — |
| GET | `/api/audit-logs` | ✅ | `AUDIT_VIEW` | ✅ |

## Unauthenticated routes

These five are deliberate. Everything else requires a bearer token.

| Route | Why |
| --- | --- |
| `GET /api/health` | Liveness probe. Reveals nothing about the business |
| `POST /api/auth/login/admin` | Cannot require a session to create one. Rate-limited to 5 failures/15min |
| `POST /api/auth/login/staff` | Same, plus progressive account lockout |
| `POST /api/auth/refresh` | Authenticated by the httpOnly refresh cookie |
| `POST /api/auth/logout` | An expired token must not prevent ending a session |
| `GET /api/kitchen/stream` | EventSource cannot set headers. Verifies a 60-second single-purpose token in-handler and re-checks `kitchen:view` against the database |

## Money

Every monetary value is an **integer in minor units** — `425` means 4.25.
Responses include both: `totalMinor: 1275` alongside `total: 12.75`. Requests
accept major units (`price: 4.25`) and convert at the boundary.

The order endpoints accept **no price field at all** — the client sends item ids
and quantities, and the server prices from the database.
