# API reference

**Generated** by `npm run docs` from `src/routes/`. Do not edit by hand — a
hand-maintained reference is wrong within a month, and a wrong reference is
worse than none because it gets trusted.

92 routes. Every response uses the envelope
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
| POST | `/api/auth/google` | — | — | ✅ |
| POST | `/api/auth/register` | — | — | ✅ |
| POST | `/api/auth/login/password` | — | — | ✅ |
| POST | `/api/auth/login/staff` | — | — | ✅ |
| POST | `/api/auth/refresh` | — | — | — |
| POST | `/api/auth/logout` | — | — | ✅ |
| GET | `/api/auth/me` | ✅ | — | — |

## Restaurant

| Method | Path | Auth | Permission | Validated |
| --- | --- | --- | --- | --- |
| POST | `/api/tenants` | ✅ | — | ✅ |
| GET | `/api/tenants/current` | ✅ | `SETTINGS_MANAGE` | ✅ |
| PUT | `/api/tenants/current` | ✅ | `SETTINGS_MANAGE` | ✅ |

## Terminal

| Method | Path | Auth | Permission | Validated |
| --- | --- | --- | --- | --- |
| GET | `/api/auth/terminal` | — | — | ✅ |

## Terminal management

| Method | Path | Auth | Permission | Validated |
| --- | --- | --- | --- | --- |
| POST | `/api/auth/devices` | ✅ | `USER_MANAGE` | ✅ |
| GET | `/api/auth/devices` | ✅ | `USER_MANAGE` | ✅ |
| POST | `/api/auth/devices/:id/relink` | ✅ | `USER_MANAGE` | ✅ |
| PATCH | `/api/auth/devices/:id` | ✅ | `USER_MANAGE` | ✅ |
| DELETE | `/api/auth/devices/:id` | ✅ | `USER_MANAGE` | ✅ |

## Menu

| Method | Path | Auth | Permission | Validated |
| --- | --- | --- | --- | --- |
| GET | `/api/menu/categories` | ✅ | `MENU_VIEW` | — |
| POST | `/api/menu/categories` | ✅ | `MENU_CREATE` | ✅ |
| PUT | `/api/menu/categories/:id` | ✅ | `MENU_EDIT` | ✅ |
| DELETE | `/api/menu/categories/:id` | ✅ | `MENU_DELETE` | ✅ |
| GET | `/api/menu/items` | ✅ | `MENU_VIEW` | ✅ |
| PATCH | `/api/menu/items/:id/availability` | ✅ | `MENU_TOGGLE_STOCK` | ✅ |
| DELETE | `/api/menu/items/:id/purge` | ✅ | `MENU_DELETE` | ✅ |
| GET | `/api/menu/items/:id` | ✅ | `MENU_VIEW` | ✅ |
| POST | `/api/menu/items` | ✅ | `MENU_CREATE` | ✅ |
| PUT | `/api/menu/items/:id` | ✅ | `MENU_EDIT` | ✅ |
| DELETE | `/api/menu/items/:id` | ✅ | `MENU_DELETE` | ✅ |

## Tables

| Method | Path | Auth | Permission | Validated |
| --- | --- | --- | --- | --- |
| GET | `/api/tables` | ✅ | `TABLE_VIEW` | ✅ |
| GET | `/api/tables/zones` | ✅ | `TABLE_VIEW` | — |
| GET | `/api/tables/:id` | ✅ | `TABLE_VIEW` | ✅ |
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
| DELETE | `/api/orders/:id` | ✅ | `ORDER_DELETE` | ✅ |

## Kitchen

| Method | Path | Auth | Permission | Validated |
| --- | --- | --- | --- | --- |
| GET | `/api/kitchen/stream` | — | — | — |
| GET | `/api/kitchen/board` | ✅ | `KITCHEN_VIEW` | ✅ |
| GET | `/api/kitchen/tickets` | ✅ | `KITCHEN_VIEW` | ✅ |
| GET | `/api/kitchen/tickets/:id` | ✅ | `KITCHEN_VIEW` | ✅ |
| PATCH | `/api/kitchen/tickets/:id/advance` | ✅ | `KITCHEN_ADVANCE_STATUS` | ✅ |
| PATCH | `/api/kitchen/tickets/:id/recall` | ✅ | `KITCHEN_RECALL` | ✅ |
| POST | `/api/kitchen/stream-token` | ✅ | `KITCHEN_VIEW` | — |

## Customers

| Method | Path | Auth | Permission | Validated |
| --- | --- | --- | --- | --- |
| GET | `/api/customers/lookup` | ✅ | `CUSTOMER_VIEW` | ✅ |
| GET | `/api/customers/suggest` | ✅ | `CUSTOMER_VIEW` | ✅ |
| GET | `/api/customers` | ✅ | `CUSTOMER_VIEW` | ✅ |
| POST | `/api/customers` | ✅ | `CUSTOMER_CREATE` | ✅ |
| GET | `/api/customers/:id/history` | ✅ | `CUSTOMER_VIEW` | ✅ |
| GET | `/api/customers/:id` | ✅ | `CUSTOMER_VIEW` | ✅ |
| PUT | `/api/customers/:id` | ✅ | `CUSTOMER_EDIT` | ✅ |
| DELETE | `/api/customers/:id` | ✅ | `CUSTOMER_DELETE` | ✅ |

## Employees

| Method | Path | Auth | Permission | Validated |
| --- | --- | --- | --- | --- |
| GET | `/api/employees` | ✅ | `USER_MANAGE` | ✅ |
| POST | `/api/employees` | ✅ | `USER_MANAGE` | ✅ |
| GET | `/api/employees/:id` | ✅ | `USER_MANAGE` | ✅ |
| PUT | `/api/employees/:id` | ✅ | `USER_MANAGE` | ✅ |
| PATCH | `/api/employees/:id/pin` | ✅ | `USER_MANAGE` | ✅ |
| PATCH | `/api/employees/:id/active` | ✅ | `USER_MANAGE` | ✅ |
| DELETE | `/api/employees/:id` | ✅ | `USER_MANAGE` | ✅ |

## Attendance

| Method | Path | Auth | Permission | Validated |
| --- | --- | --- | --- | --- |
| GET | `/api/attendance` | ✅ | `USER_MANAGE` | ✅ |
| GET | `/api/attendance/day` | ✅ | `USER_MANAGE` | ✅ |
| POST | `/api/attendance/day` | ✅ | `USER_MANAGE` | ✅ |
| PATCH | `/api/attendance/:id` | ✅ | `USER_MANAGE` | ✅ |
| DELETE | `/api/attendance/:id` | ✅ | `USER_MANAGE` | ✅ |

## Payroll

| Method | Path | Auth | Permission | Validated |
| --- | --- | --- | --- | --- |
| GET | `/api/payroll` | ✅ | `USER_MANAGE` | ✅ |
| PATCH | `/api/payroll/:employeeId/:month` | ✅ | `USER_MANAGE` | ✅ |
| POST | `/api/payroll/:employeeId/:month/pay` | ✅ | `USER_MANAGE` | ✅ |
| POST | `/api/payroll/:employeeId/:month/unpay` | ✅ | `USER_MANAGE` | ✅ |

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

## Settings

| Method | Path | Auth | Permission | Validated |
| --- | --- | --- | --- | --- |
| GET | `/api/settings/printer` | ✅ | `SETTINGS_MANAGE` | ✅ |
| PUT | `/api/settings/printer` | ✅ | `SETTINGS_MANAGE` | ✅ |

## Public invoice

| Method | Path | Auth | Permission | Validated |
| --- | --- | --- | --- | --- |
| GET | `/api/invoice/:slug` | — | — | ✅ |

## Audit log

| Method | Path | Auth | Permission | Validated |
| --- | --- | --- | --- | --- |
| GET | `/api/audit-logs/summary` | ✅ | `AUDIT_VIEW` | — |
| GET | `/api/audit-logs` | ✅ | `AUDIT_VIEW` | ✅ |

## Unauthenticated routes

10 of 92, each deliberate. Everything else requires a bearer token.

| Route | Why |
| --- | --- |
| `GET /api/health` | Liveness probe. Reveals nothing about the business |
| `POST /api/auth/google` | Cannot require a session to create one. The Google ID token is verified against Google's published keys, plus an email_verified check. Rate-limited to 5 failures/15min |
| `POST /api/auth/register` | Same. Bounded by a signup limiter that counts successes too, because on a signup endpoint the success is what costs anything |
| `POST /api/auth/login/password` | Same, plus progressive account lockout. Every failure returns one indistinguishable message after an equal-time bcrypt burn |
| `POST /api/auth/login/staff` | Same. The restaurant is resolved from the terminal's device cookie BEFORE the PIN is matched, so a PIN is only ever compared within one restaurant |
| `POST /api/auth/refresh` | Authenticated by the httpOnly refresh cookie |
| `POST /api/auth/logout` | An expired token must not prevent ending a session |
| `GET /api/auth/terminal` | The login screen must name the restaurant before anyone has a session. Reads only the device cookie and returns two names |
| `GET /api/kitchen/stream` | EventSource cannot set headers. Verifies a 60-second single-purpose token in-handler and re-checks `kitchen:view` against the database |
| `GET /api/invoice/:slug` | A customer opening a receipt link has no session and never will. Authenticated by a 192-bit token in the URL, hashed at rest |

## Money

Every monetary value is an **integer in minor units** — `425` means 4.25.
Responses include both: `totalMinor: 1275` alongside `total: 12.75`. Requests
accept major units (`price: 4.25`) and convert at the boundary.

The order endpoints accept **no price field at all** — the client sends item ids
and quantities, and the server prices from the database.
