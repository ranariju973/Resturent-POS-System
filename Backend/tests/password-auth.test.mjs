/**
 * The email-and-password administrator door.
 *
 * ── Coverage boundary, stated plainly ──────────────────────────────────────
 * No MongoDB is available here, so a real signup followed by a real sign-in is
 * NOT exercised — that belongs in the integration suite. What is exercised,
 * for real:
 *
 *   • the actual zod schemas, imported and run against real inputs
 *   • a structural audit of the two new handlers, checking the properties that
 *     make a password door safe rather than merely present
 *
 * The audit reads source with comments stripped, so a phrase in prose can
 * never satisfy a check.
 */
import fs from 'node:fs';
import path from 'node:path';

process.env.NODE_ENV = 'development';
process.env.PIN_PEPPER = 'c'.repeat(64);

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
/** Source with comments removed, so prose about a guard is not the guard. */
const code = (rel) => read(rel).replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');

const { registerSchema, passwordLoginSchema } = await import('../src/validators/auth.js');

let pass = 0;
let fail = 0;
const t = (label, ok, note = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${note ? `  ${note}` : ''}`);
};

const ok = (schema, input) => schema.safeParse(input).success;
const parsed = (schema, input) => schema.safeParse(input).data;

const VALID = { name: 'Priya Sharma', email: 'priya@restaurant.com', password: 'a'.repeat(12) };

console.log('--- signup schema ---');
t('accepts a well-formed signup', ok(registerSchema, VALID));
t('rejects a missing name', !ok(registerSchema, { ...VALID, name: undefined }));
t('rejects a one-character name', !ok(registerSchema, { ...VALID, name: 'P' }));
t('rejects a name over 80 characters', !ok(registerSchema, { ...VALID, name: 'x'.repeat(81) }));
t('rejects a malformed email', !ok(registerSchema, { ...VALID, email: 'not-an-email' }));
t('rejects an email over 254 characters',
  !ok(registerSchema, { ...VALID, email: `${'x'.repeat(250)}@a.com` }));

console.log('\n--- password bounds ---');
/*
 * The ceiling is the load-bearing one. bcrypt truncates at 72 BYTES and
 * silently ignores the rest, so accepting a longer password would mean two
 * different passphrases sharing a hash while the longer one felt stronger.
 * It is also the CPU-exhaustion guard for an unauthenticated endpoint.
 */
t('rejects a 9-character password at signup', !ok(registerSchema, { ...VALID, password: 'a'.repeat(9) }));
t('accepts exactly 10', ok(registerSchema, { ...VALID, password: 'a'.repeat(10) }));
t('accepts exactly 72', ok(registerSchema, { ...VALID, password: 'a'.repeat(72) }));
t('rejects 73 — past bcrypt truncation', !ok(registerSchema, { ...VALID, password: 'a'.repeat(73) }));
t('does NOT trim the password (leading/trailing spaces are real characters)',
  parsed(registerSchema, { ...VALID, password: `  ${'a'.repeat(12)}  ` })?.password
    === `  ${'a'.repeat(12)}  `);

console.log('\n--- normalisation, so the email is a reliable key ---');
t('lowercases the email', parsed(registerSchema, { ...VALID, email: 'Priya@Restaurant.COM' })?.email
  === 'priya@restaurant.com');
t('trims the email', parsed(registerSchema, { ...VALID, email: '  priya@restaurant.com  ' })?.email
  === 'priya@restaurant.com');
t('trims the name', parsed(registerSchema, { ...VALID, name: '  Priya Sharma  ' })?.name
  === 'Priya Sharma');

console.log('\n--- sign-in schema ---');
t('accepts an email and password', ok(passwordLoginSchema, { email: VALID.email, password: 'x' }));
/*
 * A login form is not the place to publish the policy. Rejecting a short
 * attempt before checking it tells an attacker the floor for free, and it
 * would strand any account whose password predates a change to that floor.
 */
t('does NOT enforce the signup minimum', ok(passwordLoginSchema, { email: VALID.email, password: 'short' }));
t('still enforces the bcrypt ceiling',
  !ok(passwordLoginSchema, { email: VALID.email, password: 'a'.repeat(73) }));
t('rejects an empty password', !ok(passwordLoginSchema, { email: VALID.email, password: '' }));
t('rejects a malformed email', !ok(passwordLoginSchema, { email: 'nope', password: 'x' }));

console.log('\n--- unknown keys are rejected, not ignored ---');
t('signup rejects an extra key', !ok(registerSchema, { ...VALID, role: 'admin' }));
t('signup rejects a smuggled tenantId', !ok(registerSchema, { ...VALID, tenantId: 'x'.repeat(24) }));
t('signup rejects a smuggled passwordHash', !ok(registerSchema, { ...VALID, passwordHash: 'x' }));
t('sign-in rejects an extra key',
  !ok(passwordLoginSchema, { email: VALID.email, password: 'x', allDevices: true }));

console.log('\n--- the handlers defend what they open ---');
{
  const ctl = code('src/controllers/authController.js');
  const model = code('src/models/User.js');

  const loginBlock = ctl.slice(ctl.indexOf('export const loginPassword'), ctl.indexOf('export const loginStaff'));
  const regBlock = ctl.slice(ctl.indexOf('export const registerWithPassword'), ctl.indexOf('export const loginPassword'));

  t('sign-in burns bcrypt time on an unknown email',
    /await burnTiming\(password\)/.test(loginBlock));
  t('an unknown email and a wrong password share one message',
    (loginBlock.match(/ApiError\.unauthorized\(GENERIC_LOGIN_FAILURE\)/g) || []).length >= 3);
  t('a locked account is refused before the hash is compared',
    loginBlock.indexOf('user.isLocked') < loginBlock.indexOf('verifyPassword'));
  t('a wrong password counts toward the lockout',
    /registerFailedLogin\(\)/.test(loginBlock));
  t('hitting the threshold is audited', /AUDIT_ACTION\.ACCOUNT_LOCKED/.test(loginBlock));
  t('the account lookup escapes tenant scoping deliberately',
    /runUnscoped\('password sign-in: email -> account'/.test(loginBlock));
  t('an inactive restaurant cannot be signed into',
    /restaurant-inactive/.test(loginBlock));
  t('an owner mid-onboarding resumes there instead of 500-ing on a scoped query',
    /!user\.tenantId[\s\S]{0,120}completeOnboardingLogin/.test(loginBlock));

  t('signup checks the address across every restaurant',
    /runUnscoped\('signup: email -> existing account'/.test(regBlock));
  t('...and still handles the duplicate-key race',
    /err\?\.code === 11000/.test(regBlock));
  t('the password is hashed before the row is written, never assigned raw',
    /await user\.setPassword\(password\)/.test(regBlock) && !/passwordHash\s*=/.test(regBlock));
  t('a new owner gets no restaurant, so the token can reach almost nothing',
    /tenantId: null/.test(regBlock));
  t('the account is created as an administrator explicitly',
    /role: ROLES\.ADMIN/.test(regBlock));

  t('neither handler interpolates the secret into a log call',
    !/logger\.\w+\([^)]*\bpassword\b\s*[,}]/.test(loginBlock + regBlock));
  t('the audit trail records the email as an identifier, never the password',
    /identifier: email/.test(loginBlock) && !/meta:[\s\S]{0,80}\bpassword\b/.test(loginBlock));

  console.log('\n--- the model admits the second door without widening the first ---');
  t("authProvider knows 'password'", /enum: \['google', 'password', 'pin'\]/.test(model));
  t('an admin with neither credential is still refused at write time',
    /this\.isNew && !this\.googleId && !this\.passwordHash/.test(model));
  t('emailTaken filters by neither role nor isActive (a dormant row still owns the address)',
    /emailTaken[\s\S]{0,220}exists\(\{ email: email\.trim\(\)\.toLowerCase\(\) \}\)/.test(model));
  t('verifyPassword returns false rather than throwing with no hash loaded',
    /!this\.passwordHash[\s\S]{0,60}return false/.test(model));
  t('the login lookup selects the hash it needs to compare',
    /findActiveAdminByEmail[\s\S]{0,400}\+passwordHash/.test(model));

  console.log('\n--- linking a Google identity onto a password account ---');
  const googleBlock = ctl.slice(ctl.indexOf('export const loginGoogle'), ctl.indexOf('export const registerWithPassword'));
  t('links only administrators, never a cashier row carrying an email',
    /User\.findOne\(\{ email: payload\.email, role: ROLES\.ADMIN \}\)/.test(googleBlock));
  t('refuses when the address already answers to a different Google identity',
    /byEmail\?\.googleId && byEmail\.googleId !== payload\.sub/.test(googleBlock));
  t('...with the same generic failure as every other refused sign-in',
    /google-email-claimed[\s\S]{0,200}ApiError\.unauthorized\(GENERIC_LOGIN_FAILURE\)/.test(googleBlock));
  t('the link is persisted, or the next sign-in would repeat the whole lookup',
    /isModified\?\.\(\)[\s\S]{0,160}existing\.save\(\)/.test(googleBlock));

  console.log('\n--- pre-registration hijacking is closed ---');
  /*
   * The attack the retirement exists to stop:
   *
   *   1. Signup cannot verify an address — there is no mail provider — so an
   *      attacker registers victim@example.com with a password of their own.
   *   2. The real owner of that mailbox later signs in with Google.
   *   3. If linking merely ADDED the identity, the victim would land inside the
   *      attacker's account, and the attacker would keep a working password
   *      into the victim's restaurant.
   *
   * A password on this deployment proves nothing about the mailbox; a verified
   * Google token proves everything. So when they meet, the proven credential
   * takes the account and the unproven one is destroyed.
   */
  t('the existing password is read, so the decision is made on fact not assumption',
    /\+tokenVersion \+passwordHash/.test(googleBlock));
  t('...and read BEFORE authProvider is overwritten',
    googleBlock.indexOf('linkRetiredPassword = Boolean(byEmail.passwordHash)')
      < googleBlock.indexOf("byEmail.authProvider = 'google'"));
  t('the unverified password is destroyed, not merely shadowed',
    /\$unset: \{ passwordHash: 1 \}/.test(googleBlock));
  t('...with an explicit update, since a select:false field cannot be unset by save()',
    /User\.updateOne\(\{ _id: existing\._id \}/.test(googleBlock));
  t('every session the old credential opened is revoked too',
    /tokenVersion = \(byEmail\.tokenVersion \?\? 0\) \+ 1/.test(googleBlock));
  t('the destruction is audited under its own action',
    /AUDIT_ACTION\.PASSWORD_RETIRED/.test(googleBlock));
  t('PASSWORD_RETIRED is a declared audit action',
    (await import('../src/constants/enums.js')).AUDIT_ACTION_VALUES
      .includes('auth.password.retired'));
  t('the person is told, rather than discovering it at the next sign-in',
    /notice: linkRetiredPassword \? PASSWORD_RETIRED_NOTICE/.test(googleBlock));
  t('...on both exits — a linked account may still be mid-onboarding',
    (googleBlock.match(/linkRetiredPassword \? PASSWORD_RETIRED_NOTICE/g) || []).length === 2);
  t('the notice never contains the password itself',
    !/PASSWORD_RETIRED_NOTICE[\s\S]{0,200}\$\{/.test(ctl));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
