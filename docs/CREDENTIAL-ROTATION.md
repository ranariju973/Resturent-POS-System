# Credential rotation after exposure

The pasted environment credentials must be treated as exposed. This is a runbook, not a record of completed rotation. Do not put replacement values in chat, commits, screenshots, command arguments, application logs or frontend environment variables.

## Prepare recovery and a maintenance window

- Verify an owner can sign in with their own Google account and that this account owns the intended restaurant. Keep account recovery access available while rotating credentials.
- Inventory tenants, staff, manager overrides, terminals and existing shared invoice links. Notify staff that all sessions will end, PINs must be reset and terminals re-linked.
- Back up and test restoration. Backups contain customer records and password hashes; restrict access and encrypt them.
- Stop application writers and old processes. Store newly generated, independent random values in the hosting secret store/password manager. Use at least 32 random bytes for each signing secret and pepper. Never reuse one value across purposes.

## Rotate provider credentials

1. **MongoDB Atlas:** create a replacement database user with only the application's database permissions. Privately update Render's `MONGO_URI`, start a controlled validation instance and confirm database access. Revoke/delete the exposed database user once the replacement works. Review Atlas access controls and available activity logs. Remove old URIs from local backups, CI settings and deployment configuration. Rotating application keys alone does not revoke database access.
2. **Cloudinary:** create/rotate the API credential in the Cloudinary console, update Render and verify one controlled upload/deletion. Revoke the old credential. Keep the cloud name unless deliberately migrating assets; changing an API credential does not require moving existing images. Review available access/activity records.
3. **Google:** the Web client ID is public and is not itself a leaked secret. Keep backend and frontend client IDs equal and restrict authorized JavaScript origins to the exact application origins. This application verifies ID tokens against Google's audience and verified-email claims; it does not use an OAuth client secret. Rotate any separately exposed console/service-account credentials through their own provider controls.

## Invalidate application sessions and credentials together

During maintenance, use a reviewed, tenant-aware maintenance script or a database administration session to perform the following for **every affected tenant/account**, including onboarding accounts where applicable. Do not paste raw new secrets into database fields; use the model credential setters.

| Credential | Required action | Expected consequence |
| --- | --- | --- |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | Replace both with different random values. Increment affected `User.tokenVersion`; revoke live `RefreshToken` records with `revokedAt` and a reason such as `credential-exposure`. Restart every backend process to clear authentication caches. | Existing access, refresh and stream tokens stop working. All users sign in again. |
| `PIN_PEPPER` | Replace the pepper. After restart, reset **every staff PIN** using the employee PIN action (`PATCH /api/employees/:id/pin`) or `User.setPin()` within `runInTenant`. Reset **every manager override PIN** through `User.setOverridePin()` and save. | Old `pinHash`/`pinLookup` and `overridePinHash`/`overridePinLookup` cannot be rehashed without the plaintext PIN. Changing only the environment value locks out PIN users until reset. Use new PINs, not the exposed values. |
| `DEVICE_TOKEN_PEPPER` | Replace it; deactivate old `Device` records (`isActive: false`) and re-link each terminal as its owner. Restart before relinking. | Old terminal cookies no longer resolve. Deactivating old records avoids active-label conflicts during relinking. |
| `INVOICE_TOKEN_PEPPER` | Replace it and unset old `Order.invoiceTokenHash` values for affected orders while preserving financial fields. | Previously shared public invoice links stop resolving. Original raw tokens cannot be recovered. Newly paid bills get new links; historical receipts remain printable from authenticated order details. Do not re-charge a bill to obtain a link. |
| Seeded password / override PIN | Reset the **existing user's stored password** via `User.setPassword()` in a reviewed maintenance script and reset the override through `setOverridePin()`. Increment token versions and revoke sessions. Remove seeding-only credentials from the runtime environment once no longer needed. | Editing `SEED_ADMIN_PASSWORD` or rerunning an idempotent seed does **not** change an existing account. The application has no general owner password-reset UI; use a controlled administrative recovery process. |

Use the new pepper when invoking PIN setters. Never retain an old-pepper fallback for exposed credentials. Revoke sessions again if any recovery action could have issued tokens under the old configuration. Apply tenant context explicitly to scoped model operations; raw collection maintenance must include reviewed tenant/account filters.

## Verify before reopening

- Owner Google/password sign-in succeeds with intended credentials; old credentials and previously captured sessions fail.
- Each staff member's new PIN works only at a terminal linked to their restaurant. New manager overrides work; old ones fail.
- Terminal relinking succeeds and old device cookies fail. Cookies remain Secure/HttpOnly in production.
- Old public invoice links fail; a new test payment generates a working link without exposing customer phone numbers.
- Uploads work with the new Cloudinary credential; the old credential and old database user are revoked.
- Confirm source control, deployment variables, local `.env*` files, backups and provider logs no longer contain active exposed values. Secret ignore rules now cover `.env.*` while allowing `.env.example`; ignore rules do not remove already tracked files or historical commits.

The local inspection found no tracked or historical `.env`/private-key file paths and no current tracked MongoDB-credential/private-key/Google-API-key pattern matches. This limited scan is not proof that all possible secrets are absent from every historical blob. The values shared outside Git still require rotation. If a deeper review finds committed secrets, revoke them first and coordinate history cleanup with collaborators; rewriting history alone cannot revoke a credential.
