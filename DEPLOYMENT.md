# Deploying

Two services, one browser origin:

| Piece    | Where                                          |
|----------|------------------------------------------------|
| Frontend | Vercel — `https://pos-resturent-system.vercel.app` |
| Backend  | Render — `https://resturent-pos-system.onrender.com` |
| Database | MongoDB Atlas (must be a replica set — orders are transactional) |

---

## Why the API is proxied through Vercel

`Frontend/vercel.json` rewrites `/api/*` to the Render backend. That rewrite is
not a convenience — the app does not work correctly without it.

The browser has to send two cookies for the POS to function:

- **`vp_rt`** — the refresh token. Without it, a page reload signs the terminal
  out mid-shift.
- **`vp_dev`** — the terminal's restaurant binding. Without it the server cannot
  tell which restaurant a four-digit PIN belongs to, so **staff PIN sign-in
  stops working entirely**.

If the page is on `vercel.app` and the API is on `onrender.com`, both are
*third-party* cookies. Safari has blocked those outright since 2020 and Chrome
is phasing them out, so the failure is not hypothetical and not universal —
it works for some staff and not others, which is the worst kind of bug to be
told about over the phone.

Proxying `/api` through Vercel means the browser only ever talks to one origin,
both cookies are first-party, and CORS stops being involved at all.

**This requires `VITE_API_URL` to be EMPTY on Vercel.** An absolute URL there
bypasses the proxy and points the browser straight back at Render, restoring
the problem. Empty means "call my own origin", which lands on the rewrite.

---

## Environment variables

### Render (backend)

| Variable | Notes |
|---|---|
| `NODE_ENV` | `production` — **not optional**, see below |
| `MONGO_URI` | Atlas connection string, replica set |
| `JWT_ACCESS_SECRET` | 32+ chars |
| `JWT_REFRESH_SECRET` | 32+ chars |
| `PIN_PEPPER` | 32+ chars. **Rotating invalidates every staff PIN.** |
| `INVOICE_TOKEN_PEPPER` | 32+ chars. **Rotating breaks every receipt link already sent.** |
| `DEVICE_TOKEN_PEPPER` | 32+ chars. **Rotating un-links every terminal.** |
| `GOOGLE_CLIENT_ID` | The OAuth *Web* client id, ending `.apps.googleusercontent.com` |
| `CORS_ORIGIN` | `https://pos-resturent-system.vercel.app` |
| `PUBLIC_APP_URL` | `https://pos-resturent-system.vercel.app` |
| `CLOUDINARY_*` | cloud name, api key, api secret |
| `UPLOAD_MAX_BYTES` | Optional. Defaults to `4194304` (4MB) — do not raise it, see below |

Every secret must be a **different** value; the server refuses to start if any
two match. Generate each with:

```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

The server also refuses to start if a required variable is missing, rather than
booting half-configured. On Render that shows up as a crash loop with the
reason printed in the logs — read them before assuming the deploy is broken.

#### `NODE_ENV=production` is what keeps people signed in

The refresh and device cookies take their `Secure` and `SameSite` attributes
from `NODE_ENV` (see `src/utils/jwt.js`). Under any other value they are issued
as `Secure: false; SameSite=Strict`, which a browser will not send back to an
https site. The result is not an error anywhere — sign-in appears to work, and
then **every page refresh silently logs the user out**, because
`POST /api/auth/refresh` never receives the cookie.

The server now refuses to boot in that combination (a development `NODE_ENV`
with an all-https `CORS_ORIGIN`) rather than letting it fail silently. If Render
crash-loops with that message, the fix is `NODE_ENV=production`, not a change to
`CORS_ORIGIN`.

Locally the opposite applies: keep `NODE_ENV=development` and point
`CORS_ORIGIN` at `http://localhost:8080`, so the Vite proxy keeps the cookie
first-party.

#### Why the image limit is 4MB and not larger

Menu image uploads reach the backend through the Vercel rewrite above, and that
proxy caps a request body at roughly 4.5MB. A file over the cap is rejected by
Vercel before it ever reaches Render, and Vercel answers with its own page
rather than this API's JSON envelope — so the client cannot parse a reason and
the admin sees an unexplained failure.

`UPLOAD_MAX_BYTES` therefore sits *below* the proxy's ceiling, so multer refuses
an oversized image first and returns a clear "Image must be smaller than 4MB".
Raising it past ~4.5MB reintroduces the silent failure; serving larger uploads
means bypassing the proxy, not changing this number.

### Vercel (frontend)

| Variable | Value |
|---|---|
| `VITE_API_URL` | **empty** — see above |
| `VITE_GOOGLE_CLIENT_ID` | the same client id Render verifies against |

Vite inlines `VITE_*` at build time, so changing either one needs a **redeploy**,
not a restart.

---

## Google Cloud console

**APIs & Services → Credentials → your OAuth 2.0 Web client.**

Authorised JavaScript origins — every origin the app is served from:

```
https://pos-resturent-system.vercel.app
http://localhost:8080
```

Authorised redirect URIs: **leave empty.** Google Identity Services returns the
token to the page; there is no redirect. The client *secret* is not used
anywhere in this project and does not need to be stored.

While the consent screen is in **Testing**, only accounts listed under *Test
users* can sign in. Publishing is instant for the scopes used here
(`email`, `profile`, `openid`) — no Google review.

The dev server port is pinned to 8080 in `vite.config.ts` precisely because
this list is exact: Vite's default of drifting to the next free port produces
an origin Google refuses.

---

## First run on a fresh database

There is no admin seed and no password. The first person to sign in with
Google is asked to name a restaurant, and becomes its administrator.

1. Open the app. It reports that the terminal is not set up.
2. **Sign in with Google.** Name the restaurant.
3. **Employees → Set up terminal.** Name the machine and link it. This is what
   makes staff PIN sign-in work, and it is per browser — repeat on every till.
4. Add staff and set their PINs.

Steps 3 and 4 are not optional: a PIN cannot resolve a restaurant on an
unlinked terminal, and the login screen says so rather than rejecting the PIN.

---

## Backend operations

`Backend/DEPLOYMENT.md` covers the backend in operational detail — replica-set
requirements, index building, TLS, rate-limit and cache scaling limits, and
what has to change before a second instance runs.

One item from it matters enough to repeat here, because skipping it silently
un-fixes the headline feature:

```bash
MONGO_URI="<production uri>" npm --prefix Backend run sync-indexes
```

`autoIndex` is off in production, so declared indexes do not exist until this
runs. On an upgrade it also **drops the old global unique indexes** on
`pinLookup` and `email` — until it does, two restaurants still cannot issue the
same staff PIN.

---

## Upgrading an existing deployment

The multi-tenant release changes the schema. Documents written before it have
no `tenantId`, and every query filters on one — so the old data is invisible
rather than wrong. The menu, tables, customers and order history are all still
there and none of it renders.

Rather than rebuild a menu by hand, adopt the existing records into the
restaurant you create:

```bash
# 1. Deploy, then sign in with Google and name the restaurant. It has to exist
#    before anything can be adopted into it.

# 2. Look first. Dry run is the default; nothing is written.
MONGO_URI="<production uri>" npm --prefix Backend run adopt-legacy

# 3. Apply.
MONGO_URI="<production uri>" npm --prefix Backend run adopt-legacy -- --apply

# 4. Rebuild the indexes, which also drops the old GLOBAL unique ones on
#    pinLookup and email. Until this runs, two restaurants still cannot issue
#    the same staff PIN.
MONGO_URI="<production uri>" npm --prefix Backend run sync-indexes
```

`adopt-legacy` only touches documents with **no** `tenantId`, so it is safe to
re-run and it leaves a part-way-through-onboarding account (`tenantId: null`)
alone. With more than one restaurant it refuses to guess and asks for
`--tenant=<slug>`.

Two things it reports rather than changes:

- A legacy admin holding only a password has no way in, since administrators
  now sign in with Google. The row is left in place — it is the record of who
  had access — so deactivate it from the Employees screen if it should not be
  on the roster.
- Staff accounts keep their existing PINs, which work again once a terminal is
  linked. Set fresh ones from Employees if nobody remembers them.
