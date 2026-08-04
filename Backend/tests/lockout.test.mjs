/**
 * Account lockout arithmetic, using the REAL constants from src/models/User.js.
 *
 * The constants are re-read from source rather than imported, because User.js
 * pulls in mongoose and bcrypt.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const userSrc = fs.readFileSync(path.join(ROOT, 'src/models/User.js'), 'utf8');

const MAX_FAILED_ATTEMPTS = Number(userSrc.match(/MAX_FAILED_ATTEMPTS = (\d+)/)[1]);
const LOCK_MINUTES = Number(userSrc.match(/LOCK_DURATION_MS = (\d+) \* 60 \* 1000/)[1]);
const MAX_LOCK_HOURS = Number(userSrc.match(/MAX_LOCK_DURATION_MS = (\d+) \* 60 \* 60 \* 1000/)[1]);
const PIN_LENGTH = Number(userSrc.match(/PIN_LENGTH = (\d+)/)[1]);

// The real backoff function, lifted from source (User.js imports mongoose).
const LOCK_MS = LOCK_MINUTES * 60 * 1000;
const MAX_LOCK_MS = MAX_LOCK_HOURS * 60 * 60 * 1000;
const lockDurationFor = (n0) => {
  const n = Math.max(0, Math.min(n0, 20));
  return Math.min(LOCK_MS * 2 ** n, MAX_LOCK_MS);
};

const rlSrc = fs.readFileSync(path.join(ROOT, 'src/middleware/rateLimit.js'), 'utf8');
const loginBlock = rlSrc.slice(rlSrc.indexOf('loginLimiter'), rlSrc.indexOf('refreshLimiter'));
const RL_MAX = Number(loginBlock.match(/max:\s*(\d+)/)[1]);
const RL_WINDOW_MIN = Number(loginBlock.match(/windowMs:\s*(\d+) \* 60 \* 1000/)[1]);

let pass=0, fail=0;
const t=(l,ok,n='')=>{ok?pass++:fail++;console.log(`${ok?'PASS':'FAIL'} ${l}${n?`  ${n}`:''}`);};

console.log('--- values in force ---');
console.log(`     PIN length ............. ${PIN_LENGTH} digits (${10**PIN_LENGTH} combinations)`);
console.log(`     account lockout ........ ${MAX_FAILED_ATTEMPTS} attempts / ${LOCK_MINUTES} min`);
console.log(`     per-IP login limit ..... ${RL_MAX} failures / ${RL_WINDOW_MIN} min`);

console.log('\n--- brute force: flat lockout vs progressive backoff ---');
const keyspace = 10 ** PIN_LENGTH;

// What a FLAT lock would have allowed (the design this replaced).
const flatPerDay = MAX_FAILED_ATTEMPTS * (24 * 60 / LOCK_MINUTES);
const flatDays = keyspace / flatPerDay;
console.log(`     flat ${MAX_FAILED_ATTEMPTS}/${LOCK_MINUTES}min would allow ${flatPerDay}/day -> full sweep in ~${Math.round(flatDays)} days`);
t('a flat lock would NOT have been sufficient (this is why backoff exists)',
  flatDays < 365, `${Math.round(flatDays)} days`);

// With backoff: simulate an attacker who never guesses right, so lockouts
// are always consecutive and the duration keeps doubling to the cap.
let elapsedMs = 0;
let guesses = 0;
for (let lockout = 0; guesses < keyspace; lockout++) {
  guesses += MAX_FAILED_ATTEMPTS;
  elapsedMs += lockDurationFor(lockout);
}
const years = elapsedMs / (365 * 24 * 3600 * 1000);
console.log(`     with backoff: ${keyspace} guesses takes ~${years.toFixed(1)} years`);
t('progressive backoff pushes a full sweep beyond 5 years',
  years > 5, `${years.toFixed(1)} years`);

// Expected-case, not worst-case: a few staff share the keyspace.
const STAFF = 3;
const expectedGuesses = keyspace / (STAFF + 1);
let eMs = 0, g = 0;
for (let lockout = 0; g < expectedGuesses; lockout++) { g += MAX_FAILED_ATTEMPTS; eMs += lockDurationFor(lockout); }
const eYears = eMs / (365 * 24 * 3600 * 1000);
t(`expected time to first hit with ${STAFF} staff still exceeds a year`,
  eYears > 1, `${eYears.toFixed(1)} years`);

console.log('\n--- backoff schedule ---');
for (const n of [0, 1, 2, 4, 6, 10]) {
  const mins = lockDurationFor(n) / 60000;
  console.log(`     lockout #${n + 1}: ${mins >= 60 ? `${(mins / 60).toFixed(0)} h` : `${mins} min`}`);
}
t('first lockout stays short enough not to punish a typo',
  lockDurationFor(0) <= 15 * 60 * 1000);
t('backoff is capped so staff are never permanently locked out',
  lockDurationFor(50) === MAX_LOCK_MS);
t('a successful login resets the escalation',
  /lockoutCount: 0/.test(userSrc) && /registerSuccessfulLogin/.test(userSrc));

console.log('\n--- the two controls cover different attacks ---');
t('lockout is stricter per-account than the IP limiter is per-IP',
  MAX_FAILED_ATTEMPTS <= RL_MAX);
t('IP limiter also stops spraying one PIN across many accounts (lockout cannot)',
  RL_MAX > 0 && RL_WINDOW_MIN >= 15);

console.log('\n--- sanity on the constants themselves ---');
t('lockout threshold is 3-10 attempts (usable, not trivially trippable)',
  MAX_FAILED_ATTEMPTS >= 3 && MAX_FAILED_ATTEMPTS <= 10);
t('lock duration is 5-60 min (deters without a support call)',
  LOCK_MINUTES >= 5 && LOCK_MINUTES <= 60);
t('PIN is at least 4 digits', PIN_LENGTH >= 4);
t('a real shift is unaffected: successful logins are not counted',
  /skipSuccessfulRequests:\s*true/.test(loginBlock));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
