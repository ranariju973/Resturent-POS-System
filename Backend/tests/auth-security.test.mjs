/**
 * Static security audit of the Phase 2 auth surface.
 *
 * These assertions read the actual source files and check for the specific
 * properties that make the auth layer safe. They cannot execute the code
 * (jsonwebtoken / bcrypt / mongoose are not installed in every environment),
 * so they verify structure and policy, not runtime behaviour. Runtime coverage
 * comes from the curl checks in the README and the integration tests in
 * Phase 12.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
/** Source with comments removed, so a phrase in prose can't satisfy a check. */
const code = (rel) => read(rel).replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');

let pass = 0;
let fail = 0;
const t = (label, ok, note = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${note ? `  ${note}` : ''}`);
};

const jwtSrc = code('src/utils/jwt.js');
const mwSrc = code('src/middleware/auth.js');
const ctlSrc = code('src/controllers/authController.js');
const routeSrc = code('src/routes/auth.js');
const rlSrc = code('src/middleware/rateLimit.js');
const valSrc = code('src/validators/auth.js');
const rtSrc = code('src/models/RefreshToken.js');

console.log('--- JWT hardening ---');
t('access + refresh signed with different secrets',
  /JWT_ACCESS_SECRET/.test(jwtSrc) && /JWT_REFRESH_SECRET/.test(jwtSrc));
t('algorithm pinned on verify (blocks alg:none / downgrade)',
  (jwtSrc.match(/algorithms:\s*\['HS256'\]/g) || []).length >= 2);
t('token type claim checked on both verifiers',
  (jwtSrc.match(/typ !== TOKEN_TYPE/g) || []).length >= 2);
t('issuer + audience enforced', /issuer: ISSUER/.test(jwtSrc) && /audience: AUDIENCE/.test(jwtSrc));
t('refresh token carries a jti', /jwtid: jti/.test(jwtSrc));
t('no secret literal in source', !/(secret|password)\s*[:=]\s*['"][A-Za-z0-9]{8,}['"]/i.test(jwtSrc));

console.log('\n--- access token payload carries no sensitive data ---');
const accessBody = jwtSrc.slice(jwtSrc.indexOf('signAccessToken'), jwtSrc.indexOf('signRefreshToken'));
for (const forbidden of ['email', 'name', 'pin', 'passwordHash', 'avatarUrl']) {
  t(`payload omits ${forbidden}`, !new RegExp(`\\b${forbidden}\\b`).test(accessBody));
}

console.log('\n--- refresh cookie flags ---');
t('httpOnly', /httpOnly:\s*true/.test(jwtSrc));
t('secure in production', /secure:\s*env\.isProd/.test(jwtSrc));
t('sameSite strict', /sameSite:\s*'strict'/.test(jwtSrc));
t('scoped to /api/auth', /path:\s*'\/api\/auth'/.test(jwtSrc));
t('refresh token never returned in a response body',
  !/sendSuccess\([^)]*refreshToken/.test(ctlSrc) && !/refreshToken:/.test(ctlSrc));

console.log('\n--- authorisation reads the database, not the token ---');
t('requireAuth loads the user', /User\.findById\(payload\.sub\)/.test(mwSrc));
t('req.user.role comes from the document', /role:\s*user\.role/.test(mwSrc));
t('req.user.role is NOT taken from the payload', !/role:\s*payload\.role/.test(mwSrc));
t('deactivated accounts rejected mid-session', /!user\.isActive/.test(mwSrc));
t('stale tokenVersion rejected', /payload\.tv[\s\S]{0,40}user\.tokenVersion/.test(mwSrc));

console.log('\n--- login does not leak which accounts exist ---');
t('single shared failure message', /GENERIC_LOGIN_FAILURE\s*=\s*'Invalid credentials'/.test(ctlSrc));
const failureThrows = ctlSrc.match(/ApiError\.unauthorized\(GENERIC_LOGIN_FAILURE\)/g) || [];
t(`every login failure path uses it (${failureThrows.length} sites)`, failureThrows.length >= 4);
t('unknown account still burns bcrypt time (timing oracle closed)',
  /burnTiming/.test(ctlSrc) && /await burnTiming\(password\)/.test(ctlSrc) && /await burnTiming\(pin\)/.test(ctlSrc));
t('decoy hash uses the real bcrypt cost', /decoyHashPromise[\s\S]{0,120}BCRYPT_COST/.test(ctlSrc));
t('lockout does not confirm the account exists (generic throw after lock)',
  /nowLocked[\s\S]{0,600}ApiError\.unauthorized\(GENERIC_LOGIN_FAILURE\)/.test(ctlSrc));

console.log('\n--- credentials never reach logs or the audit trail ---');
t('no password/pin value interpolated into a log call',
  !/logger\.\w+\([^)]*\b(password|pin)\b\s*[,}]/.test(ctlSrc));
t('audit meta records a reason, not the secret',
  /meta:\s*\{\s*reason/.test(ctlSrc) && !/meta:[\s\S]{0,80}\bpin\b\s*[,}]/.test(ctlSrc));
t("PIN login logs the identifier as the literal 'pin'", /identifier:\s*'pin'/.test(ctlSrc));

console.log('\n--- refresh rotation + reuse detection ---');
t('stored token is hashed, never raw', /tokenHash:\s*hashToken\(token\)/.test(rtSrc));
t('reuse of a revoked token revokes the whole family',
  /stored\.revokedAt[\s\S]{0,200}revokeFamily\(stored\.family,\s*'reuse-detected'\)/.test(ctlSrc));
t('rotation retires the presented token', /revokedReason\s*=\s*'rotated'/.test(ctlSrc));
t('rotation chain recorded via replacedBy', /replacedBy\s*=\s*jti/.test(ctlSrc));
t('presented token re-hashed and compared', /stored\.tokenHash !== hashToken\(raw\)/.test(ctlSrc));
t('expired stored record rejected', /stored\.expiresAt\.getTime\(\) <= Date\.now\(\)/.test(ctlSrc));
t('refresh re-checks user is still active', /!user \|\| !user\.isActive/.test(ctlSrc));
t('TTL index prunes expired records', /expireAfterSeconds:\s*0/.test(rtSrc));

console.log('\n--- logout actually revokes server-side ---');
t('single-session logout revokes the family', /revokeFamily\(stored\.family,\s*'logout'\)/.test(ctlSrc));
t('logout-all revokes every refresh token', /revokeAllForUser\(stored\.user,\s*'logout-all'\)/.test(ctlSrc));
t('logout-all also bumps tokenVersion (kills live access tokens)',
  /allDevices[\s\S]{0,400}revokeTokens\(\)/.test(ctlSrc));
t('cookie cleared with matching attributes', /clearRefreshCookieOptions\(\)/.test(ctlSrc));

console.log('\n--- rate limiting on unauthenticated endpoints ---');
t('login limiter: 5 attempts', /loginLimiter[\s\S]{0,300}max:\s*5/.test(rlSrc));
t('login limiter window is 15 minutes', /loginLimiter[\s\S]{0,300}windowMs:\s*15 \* 60 \* 1000/.test(rlSrc));
t('successful logins do not consume the budget', /skipSuccessfulRequests:\s*true/.test(rlSrc));
t('IPv6 normalised so prefix rotation cannot reset the counter', /ipKeyGenerator/.test(rlSrc));
t('admin login route is limited', /login\/admin',\s*loginLimiter/.test(routeSrc));
t('staff login route is limited', /login\/staff',\s*loginLimiter/.test(routeSrc));
t('refresh route is limited', /refresh',\s*refreshLimiter/.test(routeSrc));

console.log('\n--- input validation ---');
t('every auth schema is .strict() (unknown keys rejected)',
  (valSrc.match(/\.strict\(\)/g) || []).length >= 3);
t('password length capped (bcrypt CPU-exhaustion guard)', /max\(72/.test(valSrc));
t('PIN constrained to exact digit count', /\\\\d\{\$\{PIN_LENGTH\}\}/.test(valSrc) || /PIN_LENGTH/.test(valSrc));
t('all login routes run validate()', (routeSrc.match(/validate\(\{ body:/g) || []).length >= 3);
t('/me is behind requireAuth', /get\('\/me',\s*requireAuth\(\)/.test(routeSrc));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
